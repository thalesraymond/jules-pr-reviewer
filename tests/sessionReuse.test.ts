import { describe, expect, it, vi } from "vitest";
import { getOctokit } from "@actions/github";
import { findReusableSession } from "../src/sessionReuse.js";

function setup(bodies: Array<{ body: string; login: string }>) {
  const octokit = getOctokit("token");
  vi.spyOn(octokit, "graphql").mockResolvedValue({
    viewer: { login: "github-actions[bot]" },
  });
  vi.spyOn(octokit, "paginate").mockResolvedValue(
    bodies.map((review, id) => ({
      id,
      body: review.body,
      user: { login: review.login },
      state: "COMMENTED",
    }))
  );
  return octokit;
}

const body = (id: string, count: number, mode = "prompt") =>
  `<!-- jules-pr-reviewer -->\n<!-- jules-session: ${id} followups: ${count} mode: ${mode} -->\n## Review`;

describe("PR session storage", () => {
  it("loads the latest review from the authenticated author, not a forged marker", async () => {
    const octokit = setup([
      { body: body("older", 0), login: "github-actions[bot]" },
      { body: body("latest", 2), login: "github-actions[bot]" },
      { body: body("forged", 0), login: "attacker" },
    ]);
    expect(
      await findReusableSession(octokit, "owner", "repo", 42, "prompt", 5)
    ).toEqual({ sessionId: "latest", followups: 2 });
    expect(octokit.paginate).toHaveBeenCalledWith(
      octokit.rest.pulls.listReviews,
      { owner: "owner", repo: "repo", pull_number: 42, per_page: 100 }
    );
  });

  it.each([
    body("latest", 5),
    body("latest", 0, "agentic"),
    "<!-- jules-pr-reviewer -->\nMalformed",
    body("bad/id", 0),
    body("latest", 9007199254740992),
  ])(
    "does not resurrect an older session when the newest review is ineligible",
    async (latest) => {
      const octokit = setup([
        { body: body("older", 0), login: "github-actions[bot]" },
        { body: latest, login: "github-actions[bot]" },
      ]);
      expect(
        await findReusableSession(octokit, "o", "r", 1, "prompt", 5)
      ).toBeUndefined();
    }
  );

  it("starts fresh on lookup failure or absent markers", async () => {
    const octokit = setup([]);
    expect(
      await findReusableSession(octokit, "o", "r", 1, "prompt", 5)
    ).toBeUndefined();
    vi.mocked(octokit.graphql).mockRejectedValue(new Error("unavailable"));
    expect(
      await findReusableSession(octokit, "o", "r", 1, "prompt", 5)
    ).toBeUndefined();
  });
});
