export type FailOn = "never" | "blocking" | "any";
export type Verdict = "approve" | "comment" | "block";
export type DiffMode = "prompt" | "agentic";

export interface OpenThread {
  index: number;
  threadId: string;
  path: string;
  line: number;
  body: string;
}

export interface CommonPromptArgs {
  repoFullName: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  extraInstructions?: string;
  rulesFromFile?: string;
  openThreads: OpenThread[];
  dedupe?: boolean;
}

export interface InlineDiffModeArgs extends CommonPromptArgs {
  mode: "prompt";
  diff: string;
  diffTruncatedNote?: string;
}

export interface AgenticDiffModeArgs extends CommonPromptArgs {
  mode: "agentic";
  baseSha: string;
  headSha: string;
  ignoredPaths?: string;
  fileCount: number;
}

export type ReviewPromptArgs = InlineDiffModeArgs | AgenticDiffModeArgs;

export interface ReviewComment {
  file: string;
  line: number;
  severity: "Info" | "Warning" | "High";
  confidence: "Low" | "Medium" | "High";
  message: string;
  promptForAgents: string;
  suggestion?: string;
  startLine?: number;
}

export interface ReviewResult {
  summary: string;
  verdict: Verdict;
  resolvedCommentIds: number[];
  newComments: ReviewComment[];
  changedFiles?: string[];
}

export type StructuredLogEvent =
  | "review_started"
  | "review_completed"
  | "review_failed"
  | "jules_api_called"
  | "review_submitted"
  | "agentic_fallback"
  | "verification_mismatch";

export interface StructuredLogEntry {
  event: StructuredLogEvent;
  timestamp: string;
  payload: unknown;
}

export interface CheckRunAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: "notice" | "warning" | "failure";
  message: string;
  title?: string;
}

export interface ReviewOutputs {
  verdict: "approve" | "comment" | "block" | "skipped";
  issues_count: number;
  high_issues_count: number;
  warning_issues_count: number;
  info_issues_count: number;
  session_id?: string;
}
