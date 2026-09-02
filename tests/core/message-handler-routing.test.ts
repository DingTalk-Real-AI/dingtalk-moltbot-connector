import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  dispatch: vi.fn(),
  lowLevelDispatch: vi.fn(),
  workspace: vi.fn((_cfg: unknown, id: string) => `/workspaces/${id}`),
  send: vi.fn(async () => undefined),
  recall: vi.fn(async () => undefined),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/utils-legacy.ts", async () => ({
  ...(await import("../../src/utils/session.ts")),
  getAccessToken: vi.fn(async () => "test-token"),
  getOapiAccessToken: vi.fn(async () => null),
  DINGTALK_API: "https://api.dingtalk.com",
  DINGTALK_OAPI: "https://oapi.dingtalk.com",
  addEmotionReply: vi.fn(async () => undefined),
  recallEmotionReply: state.recall,
}));
vi.mock("../../src/utils/index.ts", () => ({ createLoggerFromConfig: () => state.log }));
vi.mock("../../src/services/media/index.ts", () => ({}));
vi.mock("../../src/services/messaging/index.ts", () => ({ sendProactive: state.send }));
vi.mock("../../src/services/messaging/card.ts", () => ({
  createAICardForTarget: vi.fn(async () => null),
  streamAICard: vi.fn(async () => undefined),
}));
vi.mock("../../src/game-xiyou/index.ts", () => ({ isGamificationCommand: () => false }));
vi.mock("../../src/reply-dispatcher.ts", () => ({
  createDingtalkReplyDispatcher: () => ({
    dispatcherOptions: {}, replyOptions: {}, getAsyncModeResponse: () => "",
  }),
}));
vi.mock("../../src/runtime.ts", async () => {
  const routing = await import("openclaw/plugin-sdk/routing");
  return { getDingtalkRuntime: () => ({
    agent: { resolveAgentWorkspaceDir: state.workspace },
    channel: {
      routing,
      reply: {
        resolveEnvelopeFormatOptions: () => ({}),
        formatAgentEnvelope: ({ body }: { body: string }) => body,
        finalizeInboundContext: (ctx: unknown) => ctx,
        dispatchReplyWithBufferedBlockDispatcher: state.dispatch,
        dispatchReplyFromConfig: state.lowLevelDispatch,
      },
    },
  }) };
});

import { handleDingTalkMessage } from "../../src/core/message-handler.ts";

type Params = Parameters<typeof handleDingTalkMessage>[0];
function message(overrides: Partial<Params> = {}): Params {
  return {
    accountId: "TeamBot",
    config: { groupReplyMode: "text" },
    data: {
      msgtype: "text", text: { content: "hello" }, conversationType: "2",
      conversationId: "group-1", senderStaffId: "user-1", senderNick: "User",
    },
    sessionWebhook: "https://example.invalid/hook",
    runtime: {}, log: state.log,
    cfg: { agents: { entries: { support: {} } } },
    ...overrides,
  };
}
const binding = (agentId: string, accountId?: string, peerId?: string) => ({
  agentId,
  match: {
    channel: "dingtalk-connector",
    ...(accountId ? { accountId } : {}),
    ...(peerId ? { peer: { kind: "group" as const, id: peerId } } : {}),
  },
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function processed(count: number) {
  await vi.waitFor(() => expect(state.recall).toHaveBeenCalledTimes(count));
  await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalledTimes(count));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.send.mockResolvedValue(undefined);
  state.dispatch.mockResolvedValue({ queuedFinal: false, counts: { final: 0 } });
});
afterEach(() => vi.useRealTimers());

describe("DingTalk host-owned routing", () => {
  it("uses a sole non-main agent for workspace and dispatch", async () => {
    await handleDingTalkMessage(message());
    await processed(1);
    expect(state.workspace).toHaveBeenCalledWith(expect.anything(), "support");
    expect(state.dispatch.mock.calls[0][0].dispatchReplyFromConfig).toBe(state.lowLevelDispatch);
    expect(state.dispatch.mock.calls[0][0].ctx).toMatchObject({
      SessionKey: "agent:support:dingtalk-connector:group:group-1", AccountId: "TeamBot",
    });
  });

  it("prefers an exact peer over an earlier account fallback", async () => {
    await handleDingTalkMessage(message({ cfg: {
      agents: { entries: { fallback: {}, peer: {} }, ownership: "explicit" },
      bindings: [binding("fallback", "TeamBot"), binding("peer", "TeamBot", "group-1")],
    } }));
    await processed(1);
    expect(state.dispatch.mock.calls[0][0].ctx.SessionKey).toContain("agent:peer:");
  });

  it.each([undefined, "default", "__default__"])("matches the default account selector %s", async (selector) => {
    await handleDingTalkMessage(message({ accountId: "__default__", cfg: {
      agents: { entries: { support: {}, other: {} }, ownership: "explicit" },
      bindings: [binding("support", selector)],
    } }));
    await processed(1);
    expect(state.dispatch.mock.calls[0][0].ctx).toMatchObject({
      SessionKey: "agent:support:dingtalk-connector:group:group-1", AccountId: "__default__",
    });
  });

  it("keeps differently-cased account bindings distinct and honors the wildcard", async () => {
    const cfg: Params["cfg"] = {
      agents: { entries: { lower: {}, upper: {}, fallback: {} }, ownership: "explicit" },
      bindings: [binding("lower", "teambot"), binding("upper", "TeamBot"), binding("fallback", "*")],
    };
    for (const accountId of ["TeamBot", "teambot", "OtherBot"]) {
      await handleDingTalkMessage(message({ accountId, cfg }));
    }
    await processed(3);
    expect(state.dispatch.mock.calls.map(([{ ctx }]) => [ctx.AccountId, ctx.SessionKey])).toEqual([
      ["TeamBot", "agent:upper:dingtalk-connector:group:group-1"],
      ["teambot", "agent:lower:dingtalk-connector:group:group-1"],
      ["OtherBot", "agent:fallback:dingtalk-connector:group:group-1"],
    ]);
  });

  it("reports an unbound explicit roster without dispatching or choosing a workspace", async () => {
    await handleDingTalkMessage(message({ cfg: {
      agents: { entries: { support: {}, other: {} }, ownership: "explicit" },
    } }));
    expect(state.dispatch).not.toHaveBeenCalled();
    expect(state.workspace).not.toHaveBeenCalled();
    expect(state.send).toHaveBeenCalledWith(expect.anything(), { openConversationId: "group-1" },
      expect.stringContaining("bindings"), expect.anything());
  });

  it("binds group_sender sessions using the real group while preserving separate histories", async () => {
    const base = message({ config: { groupSessionScope: "group_sender", groupReplyMode: "text" }, cfg: {
      agents: { entries: { support: {}, other: {} }, ownership: "explicit" },
      bindings: [binding("support", "TeamBot", "group-1")],
    } });
    await handleDingTalkMessage(base);
    await handleDingTalkMessage({ ...base, data: { ...base.data, senderStaffId: "user-2" } });
    await processed(2);
    expect(state.dispatch.mock.calls.map(([{ ctx }]) => ctx.SessionKey)).toEqual([
      "agent:support:dingtalk-connector:group:group-1:user-1",
      "agent:support:dingtalk-connector:group:group-1:user-2",
    ]);
  });

  it("dispatches concurrent arrivals through the host without a connector ACK queue", async () => {
    const first = deferred();
    state.dispatch.mockImplementationOnce(async () => {
      await first.promise;
      return { queuedFinal: false, counts: { final: 0 } };
    });
    const base = message();
    const firstCall = handleDingTalkMessage(base);
    await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalledTimes(1));
    const secondCall = handleDingTalkMessage({
      ...base,
      data: { ...base.data, text: { content: "second" } },
    });
    const thirdCall = handleDingTalkMessage({
      ...base,
      data: { ...base.data, text: { content: "third" } },
    });
    await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalledTimes(3));
    expect(state.send).not.toHaveBeenCalled();
    base.cfg.bindings = [binding("other", "TeamBot")];
    first.resolve();
    await Promise.all([firstCall, secondCall, thirdCall]);
    await processed(3);
    expect(state.dispatch.mock.calls.map(([{ ctx }]) => [ctx.CommandBody, ctx.SessionKey])).toEqual([
      ["hello", "agent:support:dingtalk-connector:group:group-1"],
      ["second", "agent:support:dingtalk-connector:group:group-1"],
      ["third", "agent:support:dingtalk-connector:group:group-1"],
    ]);
  });
});

describe("DingTalk session projection", () => {
  it("preserves the direct per-peer default", async () => {
    const base = message();
    await handleDingTalkMessage({ ...base, data: { ...base.data, conversationType: "1" } });
    await processed(1);
    expect(state.dispatch.mock.calls[0][0].ctx.SessionKey).toBe("agent:support:dingtalk-connector:direct:user-1");
  });

  it("routes shared-memory groups by their original peer", async () => {
    const base = message({ config: { sharedMemoryAcrossConversations: true }, cfg: {
      agents: { entries: { first: {}, second: {} }, ownership: "explicit" },
      bindings: [binding("first", "TeamBot", "group-1"), binding("second", "TeamBot", "group-2")],
    } });
    await handleDingTalkMessage(base);
    await handleDingTalkMessage({ ...base, data: { ...base.data, conversationId: "group-2" } });
    await processed(2);
    expect(state.dispatch.mock.calls.map(([{ ctx }]) => ctx.SessionKey)).toEqual([
      "agent:first:dingtalk-connector:group:teambot",
      "agent:second:dingtalk-connector:group:teambot",
    ]);
  });

  it("accepts normalized channel and wildcard binding selectors", async () => {
    await handleDingTalkMessage(message({ cfg: {
      agents: { entries: { support: {}, other: {} }, ownership: "explicit" },
      bindings: [{ agentId: "support", match: { channel: " DingTalk-Connector ", accountId: " * " } }],
    } }));
    await processed(1);
    expect(state.dispatch.mock.calls[0][0].ctx.SessionKey).toContain("agent:support:");
  });
});
