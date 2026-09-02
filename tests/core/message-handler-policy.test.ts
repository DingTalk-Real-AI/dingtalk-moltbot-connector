import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendProactive = vi.hoisted(() => vi.fn());
const mockDispatchReply = vi.hoisted(() => vi.fn(async () => ({ queuedFinal: false, counts: { final: 0 } })));

vi.mock("../../src/utils/utils-legacy.ts", () => ({
  isMessageProcessed: vi.fn(() => false),
  markMessageProcessed: vi.fn(),
  buildSessionContext: vi.fn(() => ({
    sessionPeerId: "u1",
    peerId: "u1",
    chatType: "direct",
  })),
  getAccessToken: vi.fn(async () => "tk"),
  getOapiAccessToken: vi.fn(async () => null),
  DINGTALK_API: "https://api.dingtalk.com",
  DINGTALK_OAPI: "https://oapi.dingtalk.com",
  addEmotionReply: vi.fn(async () => undefined),
  recallEmotionReply: vi.fn(async () => undefined),
}));

vi.mock("../../src/services/media/index.ts", () => ({
  processLocalImages: vi.fn(async (s: string) => s),
  processVideoMarkers: vi.fn(async (s: string) => s),
  processAudioMarkers: vi.fn(async (s: string) => s),
  uploadAndReplaceFileMarkers: vi.fn(async (s: string) => s),
  uploadMediaToDingTalk: vi.fn(async () => null),
  toLocalPath: vi.fn((s: string) => s),
  FILE_MARKER_PATTERN: /\[DINGTALK_FILE\](.*?)\[\/DINGTALK_FILE\]/gs,
  VIDEO_MARKER_PATTERN: /\[DINGTALK_VIDEO\](.*?)\[\/DINGTALK_VIDEO\]/gs,
  AUDIO_MARKER_PATTERN: /\[DINGTALK_AUDIO\](.*?)\[\/DINGTALK_AUDIO\]/gs,
}));

vi.mock("../../src/services/messaging/index.ts", () => ({
  sendProactive: mockSendProactive,
}));

vi.mock("../../src/reply-dispatcher.ts", () => ({
  createDingtalkReplyDispatcher: vi.fn(() => ({
    dispatcherOptions: {},
    replyOptions: {},
    getAsyncModeResponse: vi.fn(() => ""),
  })),
  normalizeSlashCommand: vi.fn((s: string) => s),
}));

vi.mock("../../src/runtime.ts", () => ({
  getDingtalkRuntime: vi.fn(() => ({
    agent: { resolveAgentWorkspaceDir: vi.fn(() => "/tmp/dingtalk-test-workspace") },
    channel: {
      reply: {
        resolveEnvelopeFormatOptions: vi.fn(() => ({})),
        formatAgentEnvelope: vi.fn(() => "body"),
        dispatchReplyWithBufferedBlockDispatcher: mockDispatchReply,
      },
      routing: {
        buildAgentSessionKey: vi.fn(() => "session"),
      },
    },
  })),
}));

describe("handleDingTalkMessage policy guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callHandle(params: {
    config: any;
    data: any;
  }) {
    const { handleDingTalkMessage } = await import("../../src/core/message-handler");
    await handleDingTalkMessage({
      accountId: "acc-1",
      config: params.config,
      data: params.data,
      sessionWebhook: "http://webhook",
      runtime: { log: vi.fn() } as any,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      cfg: {} as any,
    });
  }

  it("returns early when message content is empty", async () => {
    await callHandle({
      config: {},
      data: { msgtype: "text", text: { content: "" }, conversationType: "1" },
    });
    expect(mockSendProactive).not.toHaveBeenCalled();
  });

  it("dispatches admitted text with the bot context added during ingress", async () => {
    await callHandle({
      config: { dmPolicy: "open", clientId: "bot-for-this-turn" },
      data: {
        msgId: "message-1", msgtype: "text", text: { content: "hello" },
        conversationType: "1", senderStaffId: "u1", conversationId: "cid1",
      },
    });
    expect(mockDispatchReply).toHaveBeenCalledWith(expect.objectContaining({
      ctx: expect.objectContaining({
        BodyForAgent: expect.stringContaining("Current bot clientId: bot-for-this-turn"),
        rawText: "hello", CommandBody: "hello",
        SessionKey: "session", AccountId: "acc-1", MessageSid: "message-1",
      }),
      dispatcherOptions: expect.any(Object),
    }));
  });

  it("blocks DM when allowlist empty", async () => {
    await callHandle({
      config: { dmPolicy: "allowlist", allowFrom: [] },
      data: {
        msgtype: "text",
        text: { content: "hi" },
        conversationType: "1",
        senderStaffId: "u1",
      },
    });
    expect(mockSendProactive).toHaveBeenCalledTimes(1);
  });

  it("blocks DM when sender not in allowlist", async () => {
    await callHandle({
      config: { dmPolicy: "allowlist", allowFrom: ["u2"] },
      data: {
        msgtype: "text",
        text: { content: "hi" },
        conversationType: "1",
        senderStaffId: "u1",
      },
    });
    expect(mockSendProactive).toHaveBeenCalledTimes(1);
  });

  it("blocks group when policy disabled", async () => {
    await callHandle({
      config: { groupPolicy: "disabled" },
      data: {
        msgtype: "text",
        text: { content: "hi" },
        conversationType: "2",
        conversationId: "cid1",
        senderStaffId: "u1",
      },
    });
    expect(mockSendProactive).toHaveBeenCalledTimes(1);
  });

  it("blocks group allowlist when list empty", async () => {
    await callHandle({
      config: { groupPolicy: "allowlist", groupAllowFrom: [] },
      data: {
        msgtype: "text",
        text: { content: "hi" },
        conversationType: "2",
        conversationId: "cid1",
        senderStaffId: "u1",
      },
    });
    expect(mockSendProactive).toHaveBeenCalledTimes(1);
  });

  it("blocks group allowlist when conversation not in list", async () => {
    await callHandle({
      config: { groupPolicy: "allowlist", groupAllowFrom: ["cid2"] },
      data: {
        msgtype: "text",
        text: { content: "hi" },
        conversationType: "2",
        conversationId: "cid1",
        senderStaffId: "u1",
      },
    });
    expect(mockSendProactive).toHaveBeenCalledTimes(1);
  });

  it("hands concurrent messages to OpenClaw queue resolution without connector serialization", async () => {
    let releaseFirst!: () => void;
    const firstDispatch = new Promise<{ queuedFinal: false; counts: { final: 0 } }>((resolve) => {
      releaseFirst = () => resolve({ queuedFinal: false, counts: { final: 0 } });
    });
    mockDispatchReply
      .mockImplementationOnce(async () => await firstDispatch)
      .mockResolvedValue({ queuedFinal: false, counts: { final: 0 } });

    const data = {
      msgtype: "text",
      text: { content: "hi" },
      conversationType: "1",
      conversationId: "cid1",
      senderStaffId: "u1",
      msgId: "msg-1",
    };
    const first = callHandle({ config: { dmPolicy: "open" }, data });
    await vi.waitFor(() => expect(mockDispatchReply).toHaveBeenCalledTimes(1));

    const second = callHandle({
      config: { dmPolicy: "open" },
      data: { ...data, msgId: "msg-2", text: { content: "pause" } },
    });
    try {
      await vi.waitFor(() => expect(mockDispatchReply).toHaveBeenCalledTimes(2));
      expect(
        mockDispatchReply.mock.calls.every(
          ([request]) => request.replyOptions.allowActiveQueueResolution === true,
        ),
      ).toBe(true);
    } finally {
      releaseFirst();
      await Promise.all([first, second]);
    }
  });
});
