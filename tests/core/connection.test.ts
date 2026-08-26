import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckAndMarkDingtalkMessage = vi.hoisted(() => vi.fn());
const mockLoggerInfo = vi.hoisted(() => vi.fn());
const mockLoggerDebug = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());

class FakeSocket extends EventEmitter {
  readyState = 1;
  ping = vi.fn();
}

class FakeDWClient extends EventEmitter {
  static nextConnectError: any = null;
  static latestInstance: FakeDWClient | null = null;
  socket = new FakeSocket();
  callback: ((res: any) => Promise<void>) | null = null;
  disconnect = vi.fn(async () => undefined);
  connect = vi.fn(async () => {
    if (FakeDWClient.nextConnectError) {
      const err = FakeDWClient.nextConnectError;
      FakeDWClient.nextConnectError = null;
      throw err;
    }
    return undefined;
  });
  socketCallBackResponse = vi.fn();
  registerCallbackListener = vi.fn((_: string, cb: any) => {
    this.callback = cb;
  });
  constructor(_: any) {
    super();
    FakeDWClient.latestInstance = this;
  }
}

vi.mock("dingtalk-stream", () => ({
  DWClient: FakeDWClient,
  TOPIC_ROBOT: "topic_robot",
}));

vi.mock("../../src/utils/utils-legacy.ts", () => ({
  checkAndMarkDingtalkMessage: mockCheckAndMarkDingtalkMessage,
}));

vi.mock("../../src/utils/logger.ts", () => ({
  createLoggerFromConfig: () => ({
    info: mockLoggerInfo,
    debug: mockLoggerDebug,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  }),
}));

describe("core/connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeDWClient.nextConnectError = null;
    FakeDWClient.latestInstance = null;
    // 默认首次处理：返回 false（未重复）
    mockCheckAndMarkDingtalkMessage.mockReturnValue(false);
  });

  function createOpts(overrides?: Partial<any>) {
    const account = {
      accountId: "acc-1",
      clientId: "1234567890",
      clientSecret: "abcdefghij",
      config: { debug: false },
    };
    return {
      cfg: {} as any,
      account: { ...account, ...(overrides?.account ?? {}) },
      runtime: {
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      abortSignal: overrides?.abortSignal,
      messageHandler: overrides?.messageHandler ?? vi.fn(async () => undefined),
    };
  }

  it("throws when credentials are missing", async () => {
    const { monitorSingleAccount } = await import("../../src/core/connection");
    await expect(
      monitorSingleAccount(
        createOpts({
          account: { clientId: "", clientSecret: "" },
        }),
      ),
    ).rejects.toThrow("Missing credentials");
  });

  it("throws when credentials format is too short", async () => {
    const { monitorSingleAccount } = await import("../../src/core/connection");
    await expect(
      monitorSingleAccount(
        createOpts({
          account: { clientId: "123", clientSecret: "456" },
        }),
      ),
    ).rejects.toThrow("Invalid credentials format");
  });

  it("handles message callback and resolves on abort", async () => {
    const { monitorSingleAccount } = await import("../../src/core/connection");
    const controller = new AbortController();
    const messageHandler = vi.fn(async () => undefined);

    const running = monitorSingleAccount(
      createOpts({
        abortSignal: controller.signal,
        messageHandler,
      }),
    );

    // DWClient is imported dynamically in connection.ts; allow a few ticks for instantiation.
    let client: FakeDWClient | null = null;
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      client = FakeDWClient.latestInstance;
      if (client) break;
    }
    expect(client).toBeTruthy();

    await client!.callback?.({
      headers: { messageId: "m1" },
      data: JSON.stringify({
        conversationType: "1",
        senderNick: "u",
        senderStaffId: "u1",
        conversationId: "c1",
        msgId: "m1",
        sessionWebhook: "http://webhook",
        text: { content: "hello" },
      }),
    });

    expect(client!.socketCallBackResponse).toHaveBeenCalledWith("m1", { success: true });
    // 协议层去重：首次消息时 checkAndMarkDingtalkMessage 应被调用（传入 accountId + messageId，返回 false）
    expect(mockCheckAndMarkDingtalkMessage).toHaveBeenCalledWith("acc-1", "m1", undefined);    expect(messageHandler).toHaveBeenCalledTimes(1);

    // 模拟重复消息：checkAndMarkDingtalkMessage 返回 true，应跳过处理
    mockCheckAndMarkDingtalkMessage.mockReturnValue(true);
    await client!.callback?.({
      headers: { messageId: "m1" },
      data: JSON.stringify({ sessionWebhook: "http://webhook" }),
    });
    expect(messageHandler).toHaveBeenCalledTimes(1);

    controller.abort();
    await running;
    expect(client!.disconnect).toHaveBeenCalled();
  });

  it("keeps the processing heartbeat active until all concurrent messages settle", async () => {
    const realSetInterval = globalThis.setInterval;
    const processingTicks: Array<() => void> = [];
    const intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(((handler: TimerHandler, timeout?: number, ...args: any[]) => {
        if (timeout === 15_000 && typeof handler === "function") {
          processingTicks.push(() => handler(...args));
          return { unref: vi.fn() } as unknown as NodeJS.Timeout;
        }
        return realSetInterval(handler, timeout, ...args);
      }) as typeof globalThis.setInterval);
    const controller = new AbortController();
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let handled = 0;
    const messageHandler = vi.fn(async () => {
      handled += 1;
      if (handled === 1) {
        markFirstStarted();
        await firstPending;
      }
    });

    try {
      const { monitorSingleAccount } = await import("../../src/core/connection");
      const running = monitorSingleAccount(
        createOpts({ abortSignal: controller.signal, messageHandler }),
      );
      await vi.waitFor(() => expect(FakeDWClient.latestInstance).toBeTruthy());
      const client = FakeDWClient.latestInstance!;
      const event = (id: string) => ({
        headers: { messageId: id },
        data: JSON.stringify({
          conversationType: "1",
          senderStaffId: "u1",
          conversationId: "c1",
          msgId: id,
          sessionWebhook: "http://webhook",
          text: { content: id },
        }),
      });

      const first = client.callback!(event("m-concurrent-1"));
      await firstStarted;
      await client.callback!(event("m-concurrent-2"));

      mockLoggerDebug.mockClear();
      expect(processingTicks.length).toBeGreaterThan(0);
      processingTicks.at(-1)!();
      expect(mockLoggerDebug).toHaveBeenCalledWith("📝 消息处理中，更新 socket 可用时间");

      releaseFirst();
      await first;
      controller.abort();
      await running;
    } finally {
      releaseFirst?.();
      controller.abort();
      intervalSpy.mockRestore();
    }
  });

  it("rejects (not unhandled) when connect() fails", async () => {
    const { monitorSingleAccount } = await import("../../src/core/connection");
    FakeDWClient.nextConnectError = new Error("connection refused");

    await expect(
      monitorSingleAccount(createOpts()),
    ).rejects.toThrow("Failed to connect to DingTalk Stream: connection refused");
  });

  it("rejects with 400 message when connect() fails with status 400", async () => {
    const { monitorSingleAccount } = await import("../../src/core/connection");
    const err = new Error("Request failed with status code 400");
    (err as any).response = { status: 400, data: { message: "invalid_client" } };
    FakeDWClient.nextConnectError = err;

    await expect(
      monitorSingleAccount(createOpts()),
    ).rejects.toThrow("Bad Request (400)");
  });
});
