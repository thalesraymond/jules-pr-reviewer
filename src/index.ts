import * as core from '@actions/core';
import * as github from '@actions/github';
import { jules } from '@google/jules-sdk';
import { buildReviewPrompt } from './prompt.js';

type FailOn = 'never' | 'blocking' | 'any';
type Verdict = 'approve' | 'comment' | 'block';

const IN_PROGRESS_MARKER = '<!-- jules-pr-reviewer:in-progress -->';

async function run(): Promise<void> {
  const apiKey = core.getInput('jules_api_key', { required: true });
  const token = core.getInput('github_token', { required: true });
  const failOn = core.getInput('fail_on') as FailOn;
  const skipDrafts = core.getBooleanInput('skip_drafts');
  const skipForks = core.getBooleanInput('skip_forks');
  const bypassLabel = core.getInput('bypass_label');
  const statusContext = core.getInput('status_context');

  const ctx = github.context;
  if (ctx.eventName !== 'pull_request' && ctx.eventName !== 'pull_request_target') {
    core.setFailed(`Unsupported event: ${ctx.eventName}. Use on: pull_request.`);
    return;
  }

  const pr = ctx.payload.pull_request;
  if (!pr) {
    core.setFailed('No pull_request payload found.');
    return;
  }

  const owner = ctx.repo.owner;
  const repo = ctx.repo.repo;
  const prNumber = pr.number;
  const headSha: string = pr.head.sha;
  const isDraft: boolean = !!pr.draft;
  const isFork: boolean = pr.head.repo?.full_name !== `${owner}/${repo}`;
  const labels: string[] = (pr.labels || []).map((l: any) => l.name);

  const octokit = github.getOctokit(token);

  if (isDraft && skipDrafts) {
    core.info('Skipping draft PR.');
    return;
  }
  if (isFork && skipForks) {
    core.info('Skipping fork PR (skip_forks=true).');
    return;
  }
  if (labels.includes(bypassLabel)) {
    core.info(`Bypass label "${bypassLabel}" present — skipping review.`);
    return;
  }

  await octokit.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state: 'pending',
    context: statusContext,
    description: 'Jules is reviewing this PR…',
  });

  const inProgressBody =
    `${IN_PROGRESS_MARKER}\n🤖 **Jules is reviewing this PR.** Results will appear here shortly (typically 2–5 minutes).`;

  const existing = await octokit.rest.issues.listComments({
    owner, repo, issue_number: prNumber, per_page: 100,
  });
  const prior = existing.data.find(c => c.body?.includes(IN_PROGRESS_MARKER));

  let commentId: number;
  if (prior) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: prior.id, body: inProgressBody });
    commentId = prior.id;
  } else {
    const created = await octokit.rest.issues.createComment({
      owner, repo, issue_number: prNumber, body: inProgressBody,
    });
    commentId = created.data.id;
  }

  const compare = await octokit.rest.repos.compareCommitsWithBasehead({
    owner, repo,
    basehead: `${pr.base.sha}...${pr.head.sha}`,
    mediaType: { format: 'diff' },
  });
  const diff = compare.data as unknown as string;

  const prompt = buildReviewPrompt({
    repoFullName: `${owner}/${repo}`,
    prNumber,
    prTitle: pr.title || '',
    prBody: pr.body || '',
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    diff: truncateDiff(diff, 80_000),
  });

  const customJules = jules.with({ apiKey });

  core.info('Creating Jules review session…');
  const session = await customJules.session({
    prompt,
    source: { github: `${owner}/${repo}`, baseBranch: pr.base.ref },
    requireApproval: false,
    autoPr: false,
  });
  core.info(`Jules session: ${session.id}`);

  await waitUntilSessionReady(session);

  const reviewMessage = await pollForReview(session as any, 15 * 60 * 1000);
  core.info(`Collected review (${reviewMessage.length} chars)`);

  if (!reviewMessage) {
    const failBody = `${IN_PROGRESS_MARKER}\n⚠️ **Jules did not return a review.** Session: \`${session.id}\`. Check Jules dashboard or re-run the workflow.`;
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body: failBody });
    await octokit.rest.repos.createCommitStatus({
      owner, repo, sha: headSha,
      state: 'error',
      context: statusContext,
      description: 'Jules did not return a review',
    });
    core.setFailed('Jules returned no review message.');
    return;
  }

  const verdict = parseVerdict(reviewMessage);

  const finalBody = `${IN_PROGRESS_MARKER}\n## 🤖 Jules Review\n\n${reviewMessage}\n\n---\n_Session: \`${session.id}\`_`;
  await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body: finalBody });

  const { state, description } = statusFromVerdict(verdict, failOn);
  await octokit.rest.repos.createCommitStatus({
    owner, repo, sha: headSha, state, context: statusContext, description,
  });

  core.info(`Verdict: ${verdict}. Status: ${state}.`);

  if (state === 'failure') {
    core.setFailed(`Jules review verdict: ${verdict}`);
  }
}

async function pollForReview(
  session: { id: string; hydrate: () => Promise<number>; history: () => AsyncIterable<any> },
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      await session.hydrate();
      let last = '';
      for await (const a of session.history()) {
        if (a.type === 'agentMessaged') last = a.message;
      }
      if (last) {
        core.info(`Got agentMessaged on attempt ${attempt}.`);
        return last;
      }
      core.info(`No agentMessaged yet (attempt ${attempt})…`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      core.info(`hydrate/history error (attempt ${attempt}): ${msg}`);
    }
    await new Promise(r => setTimeout(r, 20_000));
  }
  return '';
}

async function waitUntilSessionReady(session: { id: string; info: () => Promise<unknown> }): Promise<void> {
  const maxAttempts = 20;
  let delay = 2000;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await session.info();
      core.info(`Session ${session.id} is ready after ${i + 1} attempt(s).`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('404')) {
        core.warning(`info() threw non-404: ${msg}`);
        return;
      }
      core.info(`Session not yet ready (attempt ${i + 1}/${maxAttempts})…`);
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 15000);
    }
  }
  core.warning('Session readiness check exhausted attempts; trying to stream anyway.');
}

function truncateDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) return diff;
  return diff.slice(0, maxChars) + `\n\n…[truncated — diff is ${diff.length} chars, keeping first ${maxChars}]`;
}

function parseVerdict(message: string): Verdict {
  const match = message.match(/VERDICT:\s*(approve|comment|block)/i);
  if (match) return match[1].toLowerCase() as Verdict;
  if (/\[BLOCKING\]/.test(message)) return 'block';
  return 'comment';
}

function statusFromVerdict(
  verdict: Verdict,
  failOn: FailOn,
): { state: 'success' | 'failure'; description: string } {
  if (failOn === 'never') {
    return { state: 'success', description: `Review complete (verdict: ${verdict})` };
  }
  if (failOn === 'any') {
    return verdict === 'approve'
      ? { state: 'success', description: 'Approved' }
      : { state: 'failure', description: `Review verdict: ${verdict}` };
  }
  return verdict === 'block'
    ? { state: 'failure', description: 'Blocking issues found' }
    : { state: 'success', description: `Review complete (verdict: ${verdict})` };
}

run().catch(err => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
