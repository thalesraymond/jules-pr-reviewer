export function shouldIgnoreTitle(
  title: string,
  keywords: string[] | undefined
): boolean {
  if (!title || !keywords || keywords.length === 0) {
    return false;
  }
  const lowered = title.toLowerCase();
  return keywords.some((k) => lowered.includes(k.toLowerCase()));
}

export function shouldIgnoreAuthor(
  login: string | undefined,
  authors: string[] | undefined
): boolean {
  if (!login || !authors || authors.length === 0) {
    return false;
  }
  const lowered = login.toLowerCase();
  return authors.some((a) => a.toLowerCase() === lowered);
}

export interface LabelPolicyResult {
  /** False when no filter is configured or the payload carried no label data. */
  evaluable: boolean;
  skip: boolean;
  reason?: string;
}

export function evaluateLabelPolicy(
  prLabels: { name: string }[] | null | undefined,
  configuredLabels: string[] | null | undefined
): LabelPolicyResult {
  if (!configuredLabels || configuredLabels.length === 0) {
    return { evaluable: false, skip: false };
  }

  if (!Array.isArray(prLabels)) {
    return {
      evaluable: false,
      skip: false,
      reason:
        "review_labels cannot be evaluated: the event payload did not include PR labels (labels are not guaranteed in pull_request payloads). Continuing the review.",
    };
  }

  const denyLabels = configuredLabels
    .filter((l) => l.startsWith("-"))
    .map((l) => l.slice(1).toLowerCase())
    .filter((l) => l.length > 0);
  const allowLabels = configuredLabels
    .filter((l) => !l.startsWith("-"))
    .map((l) => l.toLowerCase())
    .filter((l) => l.length > 0);
  // ⚡ Bolt: Use .some() directly on prLabels to avoid intermediate array allocation
  // and enable early termination on finding a match, rather than mapping the entire array first.
  const denied = denyLabels.find((denyLabel) =>
    prLabels.some((prLabel) => prLabel.name.toLowerCase() === denyLabel)
  );
  if (denied) {
    return {
      evaluable: true,
      skip: true,
      reason: `PR has label "${denied}" which is denied by review_labels — skipping review.`,
    };
  }

  if (
    allowLabels.length > 0 &&
    !allowLabels.some((allowLabel) =>
      prLabels.some((prLabel) => prLabel.name.toLowerCase() === allowLabel)
    )
  ) {
    return {
      evaluable: true,
      skip: true,
      reason: `PR has none of the allowed review_labels (allowed: ${allowLabels.join(", ")}) — skipping review.`,
    };
  }

  return { evaluable: true, skip: false };
}
