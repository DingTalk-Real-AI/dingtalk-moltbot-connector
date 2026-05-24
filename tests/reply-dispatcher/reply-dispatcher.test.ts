import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateReplyDispatcherWithTyping = vi.hoisted(() => vi.fn());
const mockResolveDingtalkAccount = vi.hoisted(() => vi.fn());
const mockGetDingtalkRuntime = vi.hoisted(() => vi.fn());
const mockCreateAICardForTarget = vi.hoisted(() => vi.fn());
const mockStreamAICard = vi.hoisted(() => vi.fn());
const mockFinishAICard = vi.hoisted(() => vi.fn());
const mockIsQpsLimitError = vi.hoisted(() => vi.fn());
const mockSendMessage = vi.hoisted(() => vi.fn());
const mockSendTextMessage = vi.hoisted(() => vi.fn());
const mockSendMarkdownMessage = vi.hoisted(() => vi.fn());
const mockGetOapiAccessToken = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk", () => ({
  createReplyPrefixOptions: vi.fn(() => ({
    onModelSelected: vi.fn(),
  })),
  createTypingCallbacks: vi.fn(() => ({
    onActive: vi.fn(),
    onIdle: vi.fn(),
    onCleanup: vi.fn(),
  })),
  logTypingFailure: vi.fn(),
}));

vi.mock("../../src/config/accounts.ts", () => ({
  resolveDingtalkAccount: mockResolveDingtalkAccount,
}));

vi.mock("../../src/runtime.ts", () => ({
  getDingtalkRuntime: mockGetDingtalkRuntime,
}));

vi.mock("../../src/services/messaging/card.ts", () => ({
  createAICardForTarget: mockCreateAICardForTarget,
  streamAICard: mockStreamAICard,
  finishAICard: mockFinishAICard,
  isQpsLimitError: mockIsQpsLimitError,
}));

vi.mock("../../src/services/messaging.ts", () => ({
  sendMessage: mockSendMessage,
  sendTextMessage: mockSendTextMessage,
  sendMarkdownMessage: mockSendMarkdownMessage,
}));

vi.mock("../../src/services/media/image.ts", () => ({
  processLocalImages: vi.fn(async (s: string) => s),
}));

vi.mock("../../src/services/media/video.ts", () => ({
  processVideoMarkers: vi.fn(async (s: string) => s),
}));

vi.mock("../../src/services/media/audio.ts", () => ({
  processAudioMarkers: vi.fn(async (s: string) => s),
}));

vi.mock("../../src/services/media/file.ts", () => ({
  uploadAndReplaceFileMarkers: vi.fn(async (s: string) => s),
}));

vi.mock("../../src/utils/token.ts", () => ({
  getAccessToken: vi.fn(),
  getOapiAccessToken: mockGetOapiAccessToken,
}));

describe("reply-dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveDingtalkAccount.mockReturnValue({
      accountId: "acc-1",
      config: { debug: false, streaming: true },
    });
    mockGetOapiAccessToken.mockResolvedValue(null);
    mockCreateAICardForTarget.mockResolvedValue({
      cardInstanceId: "c1",
      accessToken: "tk",
      inputingStarted: false,
    });
    mockStreamAICard.mockResolvedValue(undefined);
    mockFinishAICard.mockResolvedValue(undefined);
    mockSendMessage.mockResolvedValue({ ok: true });
    mockSendTextMessage.mockResolvedValue({ ok: true });
    mockSendMarkdownMessage.mockResolvedValue({ ok: true });
    // Default: treat 403 + code containing "QpsLimit" as QPS error
    mockIsQpsLimitError.mockImplementation((err: any) => {
      const code = err?.response?.data?.code;
      return (
        err?.response?.status === 403 &&
        typeof code === "string" &&
        code.includes("QpsLimit")
      );
    });
    mockCreateReplyDispatcherWithTyping.mockImplementation((args: any) => {
      (globalThis as any).__dispatcherArgs = args;
      return { dispatcher: {}, replyOptions: {}, markDispatchIdle: vi.fn() };
    });
    mockGetDingtalkRuntime.mockReturnValue({
      channel: {
        text: {
          resolveTextChunkLimit: () => 4000,
          resolveChunkMode: () => "markdown",
          chunkTextWithMode: (text: string) => [text],
        },
        reply: {
          resolveHumanDelayConfig: () => ({ enabled: false }),
          createReplyDispatcherWithTyping: mockCreateReplyDispatcherWithTyping,
        },
      },
    });
  });

  it("normalizes slash commands", async () => {
    const { normalizeSlashCommand } = await import("../../src/utils/session");
    expect(normalizeSlashCommand("/reset")).toBe("/new");
    expect(normalizeSlashCommand("新会话")).toBe("/new");
    expect(normalizeSlashCommand("hello")).toBe("hello");
  });

  it("creates dispatcher and runs streaming lifecycle callbacks", async () => {
    const { createDingtalkReplyDispatcher } = await import("../../src/reply-dispatcher");
    const runtime = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const result = createDingtalkReplyDispatcher({
      cfg: {} as any,
      agentId: "a1",
      runtime: runtime as any,
      conversationId: "conv-1",
      senderId: "user-1",
      isDirect: true,
      sessionWebhook: "http://webhook",
    });

    const args = (globalThis as any).__dispatcherArgs;
    expect(args).toBeTruthy();

    await args.onReplyStart();
    expect(mockCreateAICardForTarget).toHaveBeenCalledTimes(1);

    await args.deliver({ text: "part-1" }, { kind: "block" });
    expect(mockStreamAICard).toHaveBeenCalled();

    await args.deliver({ text: "final-1" }, { kind: "final" });
    expect(mockFinishAICard).toHaveBeenCalled();

    await args.onError(new Error("x"), { kind: "final" });
    await args.onIdle();
    args.onCleanup();

    await result.replyOptions.onPartialReply?.({ text: "partial-2" });
    expect(typeof result.getAsyncModeResponse()).toBe("string");
  });

  it("waits for pending AI Card creation before closing on idle", async () => {
    const { createDingtalkReplyDispatcher } = await import("../../src/reply-dispatcher");
    const runtime = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    let resolveCard!: (card: any) => void;
    const pendingCard = new Promise<any>((resolve) => {
      resolveCard = resolve;
    });
    mockCreateAICardForTarget.mockReturnValueOnce(pendingCard);

    createDingtalkReplyDispatcher({
      cfg: {} as any,
      agentId: "a1",
      runtime: runtime as any,
      conversationId: "conv-1",
      senderId: "user-1",
      isDirect: true,
      sessionWebhook: "http://webhook",
    });

    const args = (globalThis as any).__dispatcherArgs;
    args.onReplyStart();

    const idlePromise = args.onIdle();
    await Promise.resolve();

    expect(mockFinishAICard).not.toHaveBeenCalled();

    resolveCard({
      cardInstanceId: "slow-card",
      accessToken: "tk",
      inputingStarted: false,
    });
    await idlePromise;

    expect(mockFinishAICard).toHaveBeenCalledTimes(1);
    expect(mockFinishAICard.mock.calls[0]?.[0]?.cardInstanceId).toBe("slow-card");
  });

  it("asyncMode accumulates final response without streaming", async () => {
    const { createDingtalkReplyDispatcher } = await import("../../src/reply-dispatcher");
    const runtime = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const result = createDingtalkReplyDispatcher({
      cfg: {} as any,
      agentId: "a1",
      runtime: runtime as any,
      conversationId: "conv-1",
      senderId: "user-1",
      isDirect: true,
      sessionWebhook: "http://webhook",
      asyncMode: true,
    });
    await result.replyOptions.onPartialReply?.({ text: "async-text" });
    expect(result.getAsyncModeResponse()).toBe("async-text");
  });

  // 回归测试 (issue #510)：onPartialReply 里 streamAICard 抛出 QPS 限流错误时，
  // 不应发送 "⚠️ 消息发送失败，请稍后重试" 兜底消息——该错误是瞬时的，
  // streamAICard 内部已退避重试，下一次 partial 更新会覆盖补齐内容。
  it("does NOT send fallback error message when streamAICard throws QPS limit error", async () => {
    const { createDingtalkReplyDispatcher } = await import(
      "../../src/reply-dispatcher"
    );
    const runtime = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const result = createDingtalkReplyDispatcher({
      cfg: {} as any,
      agentId: "a1",
      runtime: runtime as any,
      conversationId: "conv-1",
      senderId: "user-1",
      isDirect: true,
      sessionWebhook: "http://webhook",
    });

    const qpsError: any = new Error("Request failed with status code 403");
    qpsError.response = {
      status: 403,
      data: { code: "QpsLimit.ExceedRealQps", message: "qps exceed" },
    };
    mockStreamAICard.mockRejectedValueOnce(qpsError);

    // 触发 onReplyStart 来预创建 AI Card，保证 onPartialReply 里
    // currentCardTarget 存在、会真的走到 streamAICard 调用。
    const args = (globalThis as any).__dispatcherArgs;
    await args.onReplyStart();

    await result.replyOptions.onPartialReply?.({ text: "partial-qps-content" });

    // streamAICard 被调用一次并抛 QPS 错误
    expect(mockStreamAICard).toHaveBeenCalledTimes(1);
    // 关键断言：QPS 错误路径下不应发送任何兜底消息
    expect(mockSendMessage).not.toHaveBeenCalled();
    // 且错误判别函数确实被调用过
    expect(mockIsQpsLimitError).toHaveBeenCalledWith(qpsError);
  });

  // 回归测试：非 QPS 错误路径保持原有行为——发送兜底消息，
  // 避免 QPS 修复过程中误伤了真正的错误兜底逻辑。
  it("DOES send fallback error message when streamAICard throws a non-QPS error", async () => {
    const { createDingtalkReplyDispatcher } = await import(
      "../../src/reply-dispatcher"
    );
    const runtime = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const result = createDingtalkReplyDispatcher({
      cfg: {} as any,
      agentId: "a1",
      runtime: runtime as any,
      conversationId: "conv-1",
      senderId: "user-1",
      isDirect: true,
      sessionWebhook: "http://webhook",
    });

    const otherError: any = new Error("Some unexpected error");
    // 无 response.status，isQpsLimitError 返回 false
    mockStreamAICard.mockRejectedValueOnce(otherError);

    const args = (globalThis as any).__dispatcherArgs;
    await args.onReplyStart();

    await result.replyOptions.onPartialReply?.({ text: "partial-other" });

    expect(mockStreamAICard).toHaveBeenCalledTimes(1);
    // 非 QPS 错误路径：fallback 消息应被发送
    expect(mockSendMessage).toHaveBeenCalled();
    const [, , fallbackText] = mockSendMessage.mock.calls[0];
    expect(fallbackText).toMatch(/消息发送失败/);
  });

  it("onIdle sends group visibleReplies hint when no outbound and cfg lacks automatic", async () => {
    mockResolveDingtalkAccount.mockReturnValue({
      accountId: "acc-1",
      config: { debug: false, streaming: true, groupReplyMode: "markdown" },
    });
    const { createDingtalkReplyDispatcher } = await import(
      "../../src/reply-dispatcher"
    );
    const runtime = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    createDingtalkReplyDispatcher({
      cfg: {} as any,
      agentId: "a1",
      runtime: runtime as any,
      conversationId: "conv-1",
      senderId: "user-1",
      isDirect: false,
      sessionWebhook: "http://webhook",
    });

    const args = (globalThis as any).__dispatcherArgs;
    await args.onReplyStart();
    await args.onIdle();

    expect(mockSendMarkdownMessage).toHaveBeenCalled();
    const contentArg = mockSendMarkdownMessage.mock.calls[0]?.[3];
    expect(String(contentArg)).toContain("visibleReplies");
    expect(String(contentArg)).toContain("automatic");
  });

  it("does not send idle visibleReplies hint when openclaw.json sets automatic", async () => {
    mockResolveDingtalkAccount.mockReturnValue({
      accountId: "acc-1",
      config: { debug: false, streaming: true, groupReplyMode: "markdown" },
    });
    const { createDingtalkReplyDispatcher } = await import(
      "../../src/reply-dispatcher"
    );
    const runtime = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    mockSendMarkdownMessage.mockClear();
    createDingtalkReplyDispatcher({
      cfg: {
        messages: { groupChat: { visibleReplies: "automatic" } },
      } as any,
      agentId: "a1",
      runtime: runtime as any,
      conversationId: "conv-1",
      senderId: "user-1",
      isDirect: false,
      sessionWebhook: "http://webhook",
    });

    const args = (globalThis as any).__dispatcherArgs;
    await args.onReplyStart();
    await args.onIdle();

    expect(mockSendMarkdownMessage).not.toHaveBeenCalled();
  });
});
