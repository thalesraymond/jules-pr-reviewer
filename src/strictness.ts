import { ReviewComment, Strictness } from "./types.js";
import { filterCommentsBySeverity } from "./severity.js";

const MIN_SURFACING_SEVERITY: Record<Strictness, ReviewComment["severity"]> = {
  quiet: "High",
  chill: "Info",
  assertive: "Info",
};

export function filterCommentsByStrictness(
  comments: ReviewComment[],
  strictness: Strictness
): ReviewComment[] {
  return filterCommentsBySeverity(comments, MIN_SURFACING_SEVERITY[strictness]);
}
