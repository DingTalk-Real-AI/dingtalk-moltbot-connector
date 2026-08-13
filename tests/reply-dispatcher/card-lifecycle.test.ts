/**
 * AI Card 生命周期回归测试（openclaw >=2026.5.x 兼容性）
 *
 * 背景：openclaw 2026.5.x 引入 source-reply delivery mode（message_tool_only）
 * 与 steer/followup 认领机制后，存在大量「deliver(kind:"final") 永远不会到达」
 * 的回合。此时唯一的关卡路径是 onIdle → closeStreaming：
 *
 * 1. closeStreaming 必须等待仍在途的 AI Card 创建完成，否则快照为 null 直接
 *    跳过，卡片随后才创建成功，永远停在 INPUTING（转圈）状态；
 * 2. 回合 settle（onIdle）之后到达的迟到回调（partial / block）不得再创建
 *    新卡片——新卡片没有任何收口方，必然变成孤儿转圈卡；
 * 3. 迟到 block 携带的文本（steer/followup 认领回合的实际回复）应降级为
 *    普通消息发出，而不是丢弃或写进孤儿卡片；
 * 4. wrapper 需向 message-handler 透传 SDK 的 markRunComplete，以满足
 *    2026.7.x 的通道契约（markRunComplete + markDispatchIdle 成对调用）。
 */
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

const CARD = {
  cardInstanceId: "card-1",
  accessToken: "tk",
  inputingStarted: false,
};

function makeRuntime() {
  return {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

async function makeDispatcher(overrides: Record<string, unknown> = {}) {
  const { createDingtalkReplyDispatcher } = await import("../../src/reply-dispatcher");
  const result = createDingtalkReplyDispatcher({
    cfg: {} as any,
    agentId: "a1",
    runtime: makeRuntime() as any,
    conversationId: "conv-1",
    senderId: "user-1",
    isDirect: true,
    sessionWebhook: "http://webhook",
    ...overrides,
  } as any);
  const args = (globalThis as any).__dispatcherArgs;
  return { result, args };
}

describe("reply-dispatcher AI card lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveDingtalkAccount.mockReturnValue({
      accountId: "acc-1",
      config: { debug: false, streaming: true },
    });
    mockGetOapiAccessToken.mockResolvedValue(null);
    mockCreateAICardForTarget.mockResolvedValue(CARD);
    mockStreamAICard.mockResolvedValue(undefined);
    mockFinishAICard.mockResolvedValue(undefined);
    mockSendMessage.mockResolvedValue({ ok: true });
    mockSendTextMessage.mockResolvedValue({ ok: true });
    mockSendMarkdownMessage.mockResolvedValue({ ok: true });
    mockIsQpsLimitError.mockReturnValue(false);
    mockCreateReplyDispatcherWithTyping.mockImplementation((args: any) => {
      (globalThis as any).__dispatcherArgs = args;
      return {
        dispatcher: {},
        replyOptions: {},
        markDispatchIdle: vi.fn(),
        markRunComplete: vi.fn(),
      };
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

  // 竞态修复：final 被上游抑制（message_tool_only / steer 认领）时，
  // onIdle 是唯一收口。若 onIdle 在 AI Card 创建 HTTP 返回前执行，
  // 旧实现快照 currentCardTarget 为 null 直接跳过 → 卡片永远转圈。
  it("closes the AI card even when onIdle fires before card creation completes", async () => {
    let resolveCard!: (card: typeof CARD) => void;
    mockCreateAICardForTarget.mockImplementation(
      () => new Promise((resolve) => {
        resolveCard = resolve;
      }),
    );

    const { args } = await makeDispatcher();

    // onReplyStart 触发 fire-and-forget 的卡片创建（HTTP 仍在途）
    args.onReplyStart();
    expect(mockCreateAICardForTarget).toHaveBeenCalledTimes(1);

    // final 被上游抑制，onIdle 先于创建完成到达
    const idlePromise = args.onIdle();

    // 给 closeStreaming 一个 tick 抵达它的快照/等待点，再让创建完成
    await new Promise((resolve) => setTimeout(resolve, 10));
    resolveCard(CARD);

    await idlePromise;
    // 允许收口用的微任务全部落地
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 卡片必须被 finishAICard 收口，不能留在 INPUTING 转圈状态
    expect(mockFinishAICard).toHaveBeenCalledTimes(1);
  });

  // 密封修复：settle 后到达的迟到 onPartialReply 不得再创建新卡片。
  // 新卡片没有任何收口方（本轮 dispatcher 已 settle），必然孤儿转圈。
  it("does not create a new AI card when onPartialReply arrives after the turn settled", async () => {
    const { result, args } = await makeDispatcher();

    args.onReplyStart();
    await args.deliver({ text: "final-1" }, { kind: "final" });
    await args.onIdle();

    mockCreateAICardForTarget.mockClear();
    mockStreamAICard.mockClear();

    await result.replyOptions.onPartialReply?.({ text: "late-partial" });

    expect(mockCreateAICardForTarget).not.toHaveBeenCalled();
    expect(mockStreamAICard).not.toHaveBeenCalled();
  });

  // 密封修复 + 内容保全：settle 后经旧 dispatcher 送达的 block
  // （steer/followup 认领回合的实际回复）应降级为普通消息，
  // 而不是写进一张永远不会被关闭的新卡片。
  it("delivers a late block as a plain message instead of opening a new card", async () => {
    const { args } = await makeDispatcher();

    args.onReplyStart();
    await args.deliver({ text: "final-1" }, { kind: "final" });
    await args.onIdle();

    mockCreateAICardForTarget.mockClear();

    await args.deliver({ text: "late-followup-reply" }, { kind: "block" });

    expect(mockCreateAICardForTarget).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalled();
    const sentText = mockSendMessage.mock.calls.at(-1)?.[2];
    expect(String(sentText)).toContain("late-followup-reply");
  });

  // 守护超时：settle 可能永远不来（上游 run 挂死 / 收口链中无超时的调用挂住），
  // 此时 onIdle 收口路径完全失效。watchdog 到期必须强制 finishAICard 并密封，
  // 之后迟到的 final 降级为普通消息发出，内容不丢失。
  it("force-finishes a stale card via watchdog and degrades a late final to a plain message", async () => {
    vi.useFakeTimers();
    try {
      const { args } = await makeDispatcher();

      args.onReplyStart();
      await vi.advanceTimersByTimeAsync(0);
      expect(mockCreateAICardForTarget).toHaveBeenCalledTimes(1);

      // 模拟挂死：没有 deliver、没有 onIdle，只有时间流逝
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);

      // watchdog 强制收口，卡片不再永久转圈
      expect(mockFinishAICard).toHaveBeenCalledTimes(1);

      // 挂死解除后迟到的 final：不得重新开卡，降级为普通消息，内容保全
      mockSendMessage.mockClear();
      mockCreateAICardForTarget.mockClear();
      await args.deliver({ text: "late-final-after-watchdog" }, { kind: "final" });
      expect(mockCreateAICardForTarget).not.toHaveBeenCalled();
      expect(mockFinishAICard).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalled();
      const sentText = mockSendMessage.mock.calls.at(-1)?.[2];
      expect(String(sentText)).toContain("late-final-after-watchdog");
    } finally {
      vi.useRealTimers();
    }
  });

  // 守护超时的边界：正常收口后 watchdog 必须被清除，不得二次 finish。
  it("watchdog does not double-finish a card that closed normally", async () => {
    vi.useFakeTimers();
    try {
      const { args } = await makeDispatcher();

      args.onReplyStart();
      await vi.advanceTimersByTimeAsync(0);
      await args.deliver({ text: "final-1" }, { kind: "final" });
      expect(mockFinishAICard).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(mockFinishAICard).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Blocking-1（reviewer #645）：onError 必须与 onIdle 对称先密封再收口。
  // 若只 close 不 seal，错误收口后到达的迟到 onReplyStart / onPartialReply
  // 仍会走 startStreaming 创建一张新的孤儿卡片，永远转圈。
  it("seals streaming on onError so late callbacks cannot create an orphan card", async () => {
    const { result, args } = await makeDispatcher();

    args.onReplyStart();
    await args.deliver({ text: "partial-1" }, { kind: "block" });

    // 触发一次错误收口
    await args.onError(new Error("boom"), { kind: "final" });

    mockCreateAICardForTarget.mockClear();
    mockStreamAICard.mockClear();

    // 错误收口之后，模拟上游继续送达的迟到回调
    args.onReplyStart();
    await result.replyOptions.onPartialReply?.({ text: "late-partial" });
    await args.deliver({ text: "late-block" }, { kind: "block" });

    expect(mockCreateAICardForTarget).not.toHaveBeenCalled();
    expect(mockStreamAICard).not.toHaveBeenCalled();
    // 迟到 block 的内容仍以普通消息送达，不丢失
    const sentTexts = mockSendMessage.mock.calls.map((c) => String(c[2] ?? ""));
    expect(sentTexts.some((t) => t.includes("late-block"))).toBe(true);
  });

  // Blocking-2（reviewer #645）：watchdog 与 closeStreaming 不能双 finish。
  // 让卡片创建 HTTP 慢返回，onIdle 触发 closeStreaming 进入 await
  // cardCreationPromise 的等待窗口；同时把 watchdog 到期时间推过——
  // 若入口未清理 watchdog，就会看到两次 finishAICard 调用。
  it("does not double-finish when watchdog fires while closeStreaming is awaiting card creation", async () => {
    vi.useFakeTimers();
    try {
      let resolveCard!: (card: typeof CARD) => void;
      mockCreateAICardForTarget.mockImplementation(
        () => new Promise((resolve) => {
          resolveCard = resolve;
        }),
      );

      const { args } = await makeDispatcher();

      args.onReplyStart();
      // 让 startStreaming 里的 armCardWatchdog 拿到 preCreatedCard 之外的路径
      // （即真实创建路径）。这里 card 创建 Promise 尚未 resolve。
      await vi.advanceTimersByTimeAsync(0);
      expect(mockCreateAICardForTarget).toHaveBeenCalledTimes(1);

      // onIdle 进入 closeStreaming：应先 clearCardWatchdog，再 await 创建完成
      const idlePromise = args.onIdle();

      // 推过 watchdog 的到期时间；若入口没清理 timer，此时 timer 会触发
      // forceFinishStaleCard，与稍后的 closeStreaming 各调一次 finishAICard。
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);

      // 让 card 创建完成，closeStreaming 继续执行 finishAICard
      resolveCard(CARD);
      await vi.advanceTimersByTimeAsync(0);
      await idlePromise;
      await vi.advanceTimersByTimeAsync(0);

      // 只允许一次 finish：入口 clearCardWatchdog 生效
      expect(mockFinishAICard).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // M1 回归：cardCreationPromise 生命周期。
  // 旧实现只在内部 try/finally 清空 cardCreationPromise，但 asyncMode /
  // !streamingEnabled / preCreatedCard 三条 early-return 路径不进入 try，
  // 导致 cardCreationPromise 永远指向 stale Promise。此处用 preCreatedCard
  // 路径验证：IIFE settle 后 gate 被清空，第二次 startStreaming 调用
  // 走 currentCardTarget 快捷路径而非复用 stale Promise。
  it("clears cardCreationPromise after preCreatedCard early return so next startStreaming uses currentCardTarget shortcut", async () => {
    const preCreated = { ...CARD, cardInstanceId: "pre-created" };
    const { args } = await makeDispatcher({ preCreatedCard: preCreated });

    // onReplyStart → startStreaming → preCreatedCard early return
    args.onReplyStart();
    // 让 IIFE 完全 settle（.finally() 清空 gate）
    await new Promise((r) => setTimeout(r, 0));
    expect(mockCreateAICardForTarget).not.toHaveBeenCalled();

    // closeStreaming 收口
    await args.deliver({ text: "final-1" }, { kind: "final" });
    await args.onIdle();
    expect(mockFinishAICard).toHaveBeenCalledTimes(1);
  });

  // M1 回归：card 创建同步成功（quick settle）后 closeStreaming 仍能收口。
  // 旧实现 finally 在 IIFE settle 前清空了 cardCreationPromise，但
  // currentCardTarget 在 finally 之前已设好，所以快路径也能过。
  // 此测试确认 .finally() 重构后快路径不被破坏。
  it("closes the AI card when card creation settles before onIdle (quick settle)", async () => {
    mockCreateAICardForTarget.mockResolvedValue(CARD);

    const { args } = await makeDispatcher();

    args.onReplyStart();
    // 让 card 创建 IIFE 完全 settle（mockResolvedValue 同步 resolve）
    await new Promise((r) => setTimeout(r, 0));

    // 此时 cardCreationPromise 已被 .finally() 清空，currentCardTarget 已设好
    await args.onIdle();

    expect(mockFinishAICard).toHaveBeenCalledTimes(1);
  });

  // 契约修复：2026.7.x 通道契约要求在 settle 时成对调用
  // markRunComplete() + markDispatchIdle()（参照 core dispatch.ts:695-696
  // 与 Feishu comment-handler.ts:324-330）。wrapper 需要把 SDK 返回的
  // markRunComplete 透传给 message-handler。
  it("exposes markRunComplete from the underlying SDK dispatcher", async () => {
    const sdkMarkRunComplete = vi.fn();
    mockCreateReplyDispatcherWithTyping.mockImplementation((args: any) => {
      (globalThis as any).__dispatcherArgs = args;
      return {
        dispatcher: {},
        replyOptions: {},
        markDispatchIdle: vi.fn(),
        markRunComplete: sdkMarkRunComplete,
      };
    });

    const { result } = await makeDispatcher();

    expect(typeof result.markRunComplete).toBe("function");
    result.markRunComplete();
    expect(sdkMarkRunComplete).toHaveBeenCalledTimes(1);
  });
});
