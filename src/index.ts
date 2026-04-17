import * as core from '@actions/core';
import * as github from '@actions/github';
import { jules } from '@google/jules-sdk';
import { buildReviewPrompt } from './prompt.js';

type FailOn = 'never' | 'blocking' | 'any';
type Verdict = 'approve' | 'comment' | 'block';

const COMMENT_MARKER = '<!-- jules-pr-reviewer -->';
const VALID_FAIL_ON: FailOn[] = ['never', 'blocking', 'any'];

async function run(): Promise<void> {
  const apiKey = core.getInput('jules_api_key', { required: true });
  core.setSecret(apiKey);

  const token = core.getInput('github_token', { required: true });
  const failOnRaw = core.getInput('fail_on');
  if (!VALID_FAIL_ON.includes(failOnRaw as FailOn)) {
    core.setFailed(`Invalid fail_on: "${failOnRaw}". Must be one of: ${VALID_FAIL_ON.join(', ')}.`);
    return;
  }
  const failOn = failOnRaw as FailOn;
  const skipDrafts = core.getBooleanInput('skip_drafts');
  const skipForks = core.getBooleanInput('skip_forks');
  const bypassLabel = core.getInput('bypass_label');
  const statusContext = core.getInput('status_context');
  const extraInstructions = core.getInput('extra_instructions');
  const rulesFilePath = core.getInput('rules_file');

  const ctx = github.context;
  if (ctx.eventName === 'pull_request_target') {
    core.setFailed(
      'pull_request_target is not supported — it runs with base-repo write tokens and exposes the action to prompt-injection via attacker-controlled diffs. Use on: pull_request instead.',
    );
    return;
  }
  if (ctx.eventName !== 'pull_request') {
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
  const baseSha: string = pr.base.sha;
  const isDraft: boolean = !!pr.draft;
  const isFork: boolean = pr.head.repo?.full_name !== `${owner}/${repo}`;
  const labels: string[] = (pr.labels || []).map((l: any) => l.name);

  const octokit = github.getOctokit(token);

  if (isDraft && skipDrafts) { core.info('Skipping draft PR.'); return; }
  if (isFork && skipForks) { core.info('Skipping fork PR (skip_forks=true).'); return; }
  if (labels.includes(bypassLabel)) {
    core.info(`Bypass label "${bypassLabel}" present — skipping review.`);
    return;
  }

  let commentId: number | undefined;

  try {
    try {
      await octokit.rest.repos.createCommitStatus({
        owner, repo, sha: headSha, state: 'pending', context: statusContext,
        description: 'Jules is reviewing this PR…',
      });
    } catch (err) {
      throw wrapPermissionError(err, 'statuses:write', 'createCommitStatus');
    }

    const inProgressBody =
      `${COMMENT_MARKER}\n🤖 **Jules is reviewing this PR.** Results will appear here shortly (typically 2–5 minutes).`;

    let createdId: number;
    try {
      const created = await octokit.rest.issues.createComment({
        owner, repo, issue_number: prNumber, body: inProgressBody,
      });
      createdId = created.data.id;
    } catch (err) {
      throw wrapPermissionError(err, 'pull-requests:write', 'createComment');
    }
    commentId = createdId;

    const diff = await fetchDiff(octokit, owner, repo, pr);

    let rulesFromFile: string | undefined;
    if (rulesFilePath) {
      rulesFromFile = await loadRulesFromBase(octokit, owner, repo, rulesFilePath, baseSha);
    }

    const { text: diffText, truncatedNote } = truncateDiff(diff, 80_000);

    const prompt = buildReviewPrompt({
      repoFullName: `${owner}/${repo}`,
      prNumber,
      prTitle: pr.title || '',
      prBody: pr.body || '',
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      diff: diffText,
      diffTruncatedNote: truncatedNote,
      extraInstructions: extraInstructions || undefined,
      rulesFromFile,
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
      await markCommentFailed(
        octokit, owner, repo, commentId,
        `Jules did not return a review within 15 minutes. Session: \`${session.id}\`. Re-run the workflow or check the Jules dashboard.`,
      );
      await setStatus(octokit, owner, repo, headSha, statusContext, 'error', 'Jules did not return a review');
      core.setFailed('Jules returned no review message.');
      return;
    }

    const verdict = parseVerdict(reviewMessage);

    const finalBody =
      `${COMMENT_MARKER}\n## 🤖 Jules Review\n\n${reviewMessage}\n\n---\n_Session: \`${session.id}\`_`;
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body: finalBody });

    const { state, description } = statusFromVerdict(verdict, failOn);
    await setStatus(octokit, owner, repo, headSha, statusContext, state, description);

    core.info(`Verdict: ${verdict}. Status check: ${state}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.error(`Review failed: ${msg}`);

    if (commentId !== undefined) {
      await markCommentFailed(octokit, owner, repo, commentId, msg).catch(() => {});
    }
    await setStatus(octokit, owner, repo, headSha, statusContext, 'error', truncate(msg, 140))
      .catch(() => {});
    core.setFailed(`Jules PR review failed: ${msg}`);
  }
}

async function fetchDiff(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string, repo: string, pr: any,
): Promise<string> {
  try {
    const res = await octokit.rest.pulls.get({
      owner, repo, pull_number: pr.number, mediaType: { format: 'diff' },
    });
    const data = res.data as unknown;
    if (typeof data === 'string') return data;
  } catch (err) {
    core.warning(`pulls.get diff failed, falling back to compare: ${String(err)}`);
  }
  const compare = await octokit.rest.repos.compareCommitsWithBasehead({
    owner, repo,
    basehead: `${pr.base.sha}...${pr.head.sha}`,
    mediaType: { format: 'diff' },
  });
  const data = compare.data as unknown;
  if (typeof data !== 'string') {
    throw new Error(
      'GitHub returned no diff text (PR may be too large or comparison refused). ' +
      'Action cannot review this PR.',
    );
  }
  return data;
}

async function loadRulesFromBase(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string, repo: string, path: string, baseSha: string,
): Promise<string | undefined> {
  try {
    const file = await octokit.rest.repos.getContent({ owner, repo, path, ref: baseSha });
    if ('content' in file.data && typeof file.data.content === 'string') {
      const content = Buffer.from(file.data.content, 'base64').toString('utf8');
      core.info(`Loaded ${content.length} chars from ${path} at base SHA`);
      return content;
    }
    core.warning(`${path} is not a regular file.`);
    return undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('404') || msg.includes('Not Found')) return undefined;
    core.warning(`Could not load ${path} at base SHA: ${msg}`);
    return undefined;
  }
}

async function setStatus(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string, repo: string, sha: string, context: string,
  state: 'pending' | 'success' | 'failure' | 'error',
  description: string,
): Promise<void> {
  await octokit.rest.repos.createCommitStatus({
    owner, repo, sha, state, context, description,
  });
}

async function markCommentFailed(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string, repo: string, commentId: number, reason: string,
): Promise<void> {
  const body = `${COMMENT_MARKER}\n⚠️ **Jules PR review failed to complete.**\n\n\`\`\`\n${truncate(reason, 500)}\n\`\`\`\n\nSee the [workflow logs](${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}) for details.`;
  await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body });
}

function wrapPermissionError(err: unknown, needed: string, op: string): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('403') || msg.includes('Resource not accessible')) {
    return new Error(
      `${op} failed with 403. The github_token likely lacks ${needed}. Add to your workflow:\n` +
      `    permissions:\n      pull-requests: write\n      contents: read\n      statuses: write\n` +
      `(original: ${msg})`,
    );
  }
  return err instanceof Error ? err : new Error(msg);
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
      if (msg.includes('401') || msg.includes('403')) {
        throw new Error(`Jules API rejected request (${msg}). Check JULES_API_KEY is valid.`);
      }
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
      if (msg.includes('401') || msg.includes('403')) {
        throw new Error(`Jules API rejected request (${msg}). Check JULES_API_KEY is valid.`);
      }
      if (!msg.includes('404')) {
        throw new Error(`Jules session.info() failed: ${msg}`);
      }
      core.info(`Session not yet ready (attempt ${i + 1}/${maxAttempts})…`);
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 15000);
    }
  }
  throw new Error('Session did not become ready within timeout.');
}

function truncateDiff(diff: string, maxChars: number): { text: string; truncatedNote?: string } {
  if (diff.length <= maxChars) return { text: diff };
  const text = diff.slice(0, maxChars);
  return {
    text,
    truncatedNote: `The diff was truncated: original ${diff.length} chars, kept first ${maxChars}. Some changes are not visible in the diff above; your review of the visible portion should state this caveat.`,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
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
