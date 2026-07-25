export type FailOn = "never" | "blocking" | "any";
export type Verdict = "approve" | "comment" | "block";

export interface OpenThread {
  index: number;
  threadId: string;
  path: string;
  line: number;
  body: string;
}

export interface PromptArgs {
  repoFullName: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  diff: string;
  diffTruncatedNote?: string;
  extraInstructions?: string;
  rulesFromFile?: string;
  openThreads: OpenThread[];
}

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
}
