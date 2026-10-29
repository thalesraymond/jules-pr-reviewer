import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@actions/core";
import { executeReview } from "../src/executeReview.js";
import type { ReusableSession } from "../src/sessionReuse.js";

const { createSession } = vi.hoisted(() => ({ createSession: vi.fn() }));

vi.mock("@actions/core");
vi.mock("@google/jules-sdk", () => ({
  jules: { with: vi.fn(() => ({ session: createSession })) },
}));

const config = {
  diffMode: "prompt" as const,
  dedupe: true,
  strictness: "chill" as const,
  largePrThreshold: 80_000,
  largePrStrategy: "prioritize" as const,
  timeoutMinutes: 1,
};

function makeSession(
  id: string,
  message = '{"summary":"ok","verdict":"approve"}'
) {
  return {
    id,
    info: vi.fn().mockResolvedValue({}),
    hydrate: vi.fn().mockResolvedValue(1),
    archive: vi.fn().mockResolvedValue(undefined),
    history: async function* () {
      if (message) yield { type: "agentMessaged", message };
    },
  };
}

function run(
  diffMode: "prompt" | "agentic" = "prompt",
  reusableSession?: ReusableSession
) {
  return executeReview(
    "api-key",
    42,
    { head: { ref: "feature" }, base: { ref: "main" } },
    {
      diff: "diff --git a/src/a.ts b/src/a.ts\n+change\n",
      changedFiles: ["src/a.ts"],
      perPathRules: [],
      openThreads: [],
    },
    "owner/repo",
    "baseSHA",
    "headSHA",
    { ...config, diffMode, reusableSession }
  );
}

function expectCompletion(success: boolean, duration: number) {
  const events = vi
    .mocked(core.info)
    .mock.calls.map(([message]) => message)
    .filter((message) => message.includes('"event":"jules_api_called"'));
  expect(events).toHaveLength(1);
  const completion: unknown = JSON.parse(
    events[0].slice("::structured:: ".length)
  );
  expect(completion).toMatchObject({ payload: { success, duration } });
}

describe("review execution through the Jules SDK seam", () => {
  it("refreshes the checkout before an agentic follow-up", async () => {
    const session = {
      ...makeSession("existing"),
      info: vi.fn().mockResolvedValue({ state: "completed" }),
      unarchive: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    };
    let sent = false;
    session.send.mockImplementation(async () => {
      sent = true;
    });
    session.history = async function* () {
      if (sent)
        yield {
          type: "agentMessaged",
          message: '{"summary":"fresh","verdict":"approve"}',
        };
    };
    createSession.mockReturnValue(session);
    await run("agentic", { sessionId: "existing", followups: 0 });
    expect(session.send).toHaveBeenCalledWith(
      expect.stringContaining("git fetch origin")
    );
    expect(session.send).toHaveBeenCalledWith(
      expect.stringContaining("git checkout --detach headSHA")
    );
  });

  it.each(["missing", "busy", "parse", "timeout", "send"])(
    "starts one fresh prompt session after failed reuse (%s)",
    async (failure) => {
      let sent = false;
      const previous = {
        ...makeSession("existing"),
        info: vi.fn().mockResolvedValue({
          state: failure === "busy" ? "inProgress" : "completed",
        }),
        unarchive: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockImplementation(async () => {
          sent = true;
        }),
        history: async function* () {
          yield {
            id: "old",
            type: "agentMessaged",
            message: '{"summary":"stale","verdict":"block"}',
          };
          if (sent && failure === "parse")
            yield { id: "bad", type: "agentMessaged", message: "invalid" };
        },
      };
      if (failure === "missing")
        previous.info.mockRejectedValue(new Error("404"));
      if (failure === "send") previous.send.mockRejectedValue(new Error("503"));
      const fresh = makeSession("fresh");
      createSession.mockReturnValueOnce(previous).mockResolvedValueOnce(fresh);
      const execution = run("prompt", { sessionId: "existing", followups: 2 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await execution).toMatchObject({
        sessionId: "fresh",
        reviewResult: { summary: "ok" },
      });
      expect((await execution).sessionFollowups).toBeUndefined();
      expect(createSession).toHaveBeenCalledTimes(2);
      if (failure === "busy" || failure === "missing")
        expect(previous.archive).not.toHaveBeenCalled();
      else expect(previous.archive).toHaveBeenCalledOnce();
      expect(fresh.archive).toHaveBeenCalledOnce();
    }
  );

  it.each(["429", "401"])(
    "does not create a new session after send fails with %s",
    async (status) => {
      const previous = {
        ...makeSession("existing", ""),
        info: vi.fn().mockResolvedValue({ state: "completed" }),
        unarchive: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockRejectedValue(new Error(`status code ${status}`)),
      };
      createSession.mockReturnValue(previous);
      await expect(
        run("agentic", { sessionId: "existing", followups: 0 })
      ).rejects.toThrow(status === "429" ? "quota" : "rejected");
      expect(createSession).toHaveBeenCalledExactlyOnceWith("existing");
      expect(previous.archive).toHaveBeenCalledOnce();
    }
  );

  it.each(["parse", "timeout", "missing"])(
    "bounds agentic reuse recovery to one fresh prompt session (%s)",
    async (failure) => {
      let sent = false;
      const previous = {
        ...makeSession("existing", ""),
        info: vi.fn().mockResolvedValue({ state: "completed" }),
        unarchive: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockImplementation(async () => {
          sent = true;
        }),
        history: async function* () {
          if (sent && failure === "parse")
            yield { id: "new", type: "agentMessaged", message: "invalid" };
        },
      };
      if (failure === "missing")
        previous.info.mockRejectedValue(new Error("404"));
      const fresh = makeSession("fresh", "");
      createSession.mockReturnValueOnce(previous).mockResolvedValueOnce(fresh);
      const execution = run("agentic", { sessionId: "existing", followups: 2 });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await execution).toMatchObject({
        sessionId: "fresh",
        reviewResult: null,
        sessionMode: "prompt",
      });
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(createSession.mock.calls[1][0]).toMatchObject({
        title: "Code Review",
      });
      if (failure === "missing")
        expect(previous.archive).not.toHaveBeenCalled();
      else expect(previous.archive).toHaveBeenCalledOnce();
      expect(fresh.archive).toHaveBeenCalledOnce();
    }
  );
  it("reuses an archived session and ignores its old review", async () => {
    let sent = false;
    const session = {
      ...makeSession("existing"),
      info: vi.fn().mockResolvedValue({ state: "completed" }),
      unarchive: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockImplementation(async () => {
        sent = true;
      }),
      history: async function* () {
        yield {
          id: "old",
          type: "agentMessaged",
          message: '{"summary":"stale","verdict":"block"}',
        };
        if (sent)
          yield {
            id: "new",
            type: "agentMessaged",
            message: '{"summary":"current","verdict":"approve"}',
          };
      },
    };
    createSession.mockReturnValue(session);
    const result = await run("prompt", { sessionId: "existing", followups: 2 });
    expect(result).toMatchObject({
      sessionId: "existing",
      sessionFollowups: 3,
      reviewResult: { summary: "current" },
    });
    expect(createSession).toHaveBeenCalledExactlyOnceWith("existing");
    expect(session.send).toHaveBeenCalledWith(
      expect.stringContaining("from scratch")
    );
    expect(session.send).toHaveBeenCalledWith(
      expect.stringContaining("src/a.ts")
    );
    expect(session.unarchive).toHaveBeenCalledOnce();
    expect(session.archive).toHaveBeenCalledOnce();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    createSession.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports one completion for an agentic review after cleanup", async () => {
    const session = makeSession("agentic");
    session.archive.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    createSession.mockResolvedValue(session);

    const execution = run("agentic");
    await vi.advanceTimersByTimeAsync(200);
    const result = await execution;

    expect(result.sessionId).toBe("agentic");
    expect(result.reviewResult?.verdict).toBe("approve");
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(session.archive).toHaveBeenCalledOnce();
    expectCompletion(true, 200);
  });

  it("archives every session across agentic fallback and a fresh prompt retry", async () => {
    const agentic = makeSession("agentic", "");
    const firstPrompt = makeSession("prompt-first", "");
    const secondPrompt = makeSession("prompt-second");
    createSession
      .mockResolvedValueOnce(agentic)
      .mockResolvedValueOnce(firstPrompt)
      .mockResolvedValueOnce(secondPrompt);

    const execution = run("agentic");
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await execution;

    expect(result.sessionId).toBe("prompt-second");
    expect(result.reviewResult?.verdict).toBe("approve");
    expect(createSession).toHaveBeenCalledTimes(3);
    expect(createSession.mock.calls[0][0]).toMatchObject({
      title: "Code Review (Agentic)",
      source: { baseBranch: "feature" },
    });
    expect(createSession.mock.calls[1]).toEqual(createSession.mock.calls[2]);
    expect(createSession.mock.calls[1][0]).toMatchObject({
      title: "Code Review",
      source: { baseBranch: "main" },
      prompt: expect.stringContaining("src/a.ts"),
    });
    for (const session of [agentic, firstPrompt, secondPrompt]) {
      expect(session.archive).toHaveBeenCalledOnce();
    }
    expectCompletion(true, 120_000);
  });

  it("archives both exhausted prompt attempts and reports one failed completion", async () => {
    const first = makeSession("first", "");
    const second = makeSession("second", "");
    createSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const execution = run();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await execution).toMatchObject({
      reviewResult: null,
      sessionId: "second",
    });

    expect(first.archive).toHaveBeenCalledOnce();
    expect(second.archive).toHaveBeenCalledOnce();
    expectCompletion(false, 120_000);
  });

  it("keeps an invalid response as a fallback review without another session", async () => {
    const session = makeSession("invalid", "not JSON");
    createSession.mockResolvedValue(session);

    expect((await run()).reviewResult).toMatchObject({
      verdict: "block",
      unparseable: true,
    });
    expect(createSession).toHaveBeenCalledOnce();
    expect(session.archive).toHaveBeenCalledOnce();
    expectCompletion(false, 0);
  });

  it("archives and propagates readiness auth failure without fallback", async () => {
    const session = makeSession("unauthorized");
    session.info.mockRejectedValue(new Error("status code 401"));
    createSession.mockResolvedValue(session);

    await expect(run("agentic")).rejects.toThrow("Jules API rejected request");
    expect(createSession).toHaveBeenCalledOnce();
    expect(session.archive).toHaveBeenCalledOnce();
    expectCompletion(false, 0);
  });
});
