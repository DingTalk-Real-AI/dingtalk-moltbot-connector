import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendText = vi.hoisted(() => vi.fn());
const mockSendMedia = vi.hoisted(() => vi.fn());
const mockProbe = vi.hoisted(() => vi.fn());
const mockResolveAccount = vi.hoisted(() => vi.fn());
const mockMonitorProvider = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/messaging/index.ts", () => ({
  sendTextToDingTalk: mockSendText,
  sendMediaToDingTalk: mockSendMedia,
}));

vi.mock("../../src/probe.ts", () => ({
  probeDingtalk: mockProbe,
}));

vi.mock("../../src/config/accounts.ts", () => ({
  resolveDingtalkAccount: mockResolveAccount,
  resolveDingtalkCredentials: vi.fn(),
  listDingtalkAccountIds: vi.fn().mockReturnValue(["main"]),
  resolveDefaultDingtalkAccountId: vi.fn().mockReturnValue("main"),
}));

vi.mock("../../src/core/provider.ts", () => ({
  monitorDingtalkProvider: mockMonitorProvider,
}));

describe("channel plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccount.mockReturnValue({
      accountId: "main",
      enabled: true,
      configured: true,
      clientId: "id",
      clientSecret: "secret",
      config: { debug: false, allowFrom: ["user1"], groupPolicy: "open" },
    });
    mockSendText.mockResolvedValue({ ok: true, processQueryKey: "pqk-1" });
    mockSendMedia.mockResolvedValue({ ok: true, processQueryKey: "pqk-media" });
    mockProbe.mockResolvedValue({ ok: true, botName: "bot-1" });
    mockMonitorProvider.mockResolvedValue(undefined);
  });

  it("loads plugin metadata and base capabilities", async () => {
    const { dingtalkPlugin } = await import("../../src/channel");
    const plugin = dingtalkPlugin as any;
    expect(plugin.id).toBe("dingtalk-connector");
    expect(plugin.capabilities.media).toBe(true);
    expect(plugin.meta.label).toBe("DingTalk");
    expect(plugin.secrets.secretTargetRegistryEntries.map((entry: any) => entry.pathPattern)).toEqual([
      "channels.dingtalk-connector.accounts.*.clientSecret",
      "channels.dingtalk-connector.clientSecret",
    ]);
    expect(plugin.secrets.collectRuntimeConfigAssignments).toBeTypeOf("function");
  });

  it("config helpers update account flags", async () => {
    const { dingtalkPlugin } = await import("../../src/channel");
    const plugin = dingtalkPlugin as any;
    const cfg = { channels: { "dingtalk-connector": { accounts: { a1: {} } } } } as any;

    const updatedDefault = plugin.config.setAccountEnabled({
      cfg,
      accountId: "__default__",
      enabled: false,
    });
    const updatedDefaultChannel = updatedDefault.channels["dingtalk-connector"] as any;
    const defaultEnabled =
      updatedDefaultChannel.enabled ??
      updatedDefaultChannel.accounts?.["__default__"]?.enabled;
    expect(defaultEnabled).toBe(false);

    const updatedNamed = plugin.config.setAccountEnabled({
      cfg,
      accountId: "a1",
      enabled: true,
    });
    expect(updatedNamed.channels["dingtalk-connector"].accounts.a1.enabled).toBe(true);
  });

  it("outbound chunker and sendText/sendMedia work", async () => {
    const { dingtalkPlugin } = await import("../../src/channel");
    const plugin = dingtalkPlugin as any;
    const chunks = plugin.outbound.chunker("a\nbb\nccc", 4);
    expect(chunks).toEqual(["a\nbb", "ccc"]);

    const textRes = await plugin.outbound.sendText({
      cfg: {} as any,
      to: "user1",
      text: "hello",
      accountId: "main",
    } as any);
    expect(textRes.messageId).toBe("pqk-1");
    expect(textRes.target).toEqual({ kind: "conversation", id: "user1" });

    const mediaRes = await plugin.outbound.sendMedia({
      cfg: {} as any,
      to: "user1",
      mediaUrl: "/tmp/a.png",
      text: "hello",
      accountId: "main",
    } as any);
    expect(mediaRes.messageId).toBe("pqk-media");
    expect(mediaRes.target).toEqual({ kind: "conversation", id: "user1" });
  });

  it.each(["default", "named"])("setup contract enables the %s account", async (accountId) => {
    const { dingtalkPlugin } = await import("../../src/channel");
    const cfg = { channels: { "dingtalk-connector": { enabled: false } } };
    const resolvedAccountId = accountId === "default"
      ? dingtalkPlugin.setupContract!.resolveAccountId!({ cfg, input: {} })
      : accountId;
    const updated = dingtalkPlugin.setupContract!.applyAccountConfig({ cfg, accountId: resolvedAccountId, input: {} });
    const channel = updated.channels!["dingtalk-connector"] as any;
    expect(accountId === "default" ? channel.enabled : channel.accounts.named.enabled).toBe(true);
    expect(cfg.channels["dingtalk-connector"].enabled).toBe(false);
  });

  it.each(["sendText", "sendMedia"])("%s rejects failed sends instead of returning a receipt", async (method) => {
    const { dingtalkPlugin } = await import("../../src/channel");
    mockSendText.mockResolvedValue({ ok: false, error: "send rejected" });
    mockSendMedia.mockResolvedValue({ ok: false, error: "send rejected" });
    await expect((dingtalkPlugin.outbound as any)[method]({
      cfg: {}, to: "user1", text: "hello", mediaUrl: "/tmp/a.png", accountId: "main",
    })).rejects.toThrow("send rejected");
  });

  it("sendMedia validates required parameters", async () => {
    const { dingtalkPlugin } = await import("../../src/channel");
    const plugin = dingtalkPlugin as any;
    await expect(
      plugin.outbound.sendMedia({
        cfg: {} as any,
        to: "" as any,
        mediaUrl: "/tmp/a.png",
        accountId: "main",
      } as any),
    ).rejects.toThrow("Invalid 'to' parameter");

    await expect(
      plugin.outbound.sendMedia({
        cfg: {} as any,
        to: "user1",
        mediaUrl: "" as any,
        accountId: "main",
      } as any),
    ).rejects.toThrow("Invalid 'mediaUrl' parameter");
  });

  it("gateway.startAccount delegates to monitor provider", async () => {
    const { dingtalkPlugin } = await import("../../src/channel");
    const plugin = dingtalkPlugin as any;
    const ctx = {
      cfg: {},
      accountId: "main",
      runtime: { log: { info: vi.fn() } },
      abortSignal: new AbortController().signal,
      setStatus: vi.fn(),
      log: { info: vi.fn(), error: vi.fn() },
    } as any;

    await plugin.gateway.startAccount(ctx);
    expect(mockMonitorProvider).toHaveBeenCalledTimes(1);
    expect(ctx.setStatus).toHaveBeenCalled();
  });

  it("status.probeAccount delegates to probeDingtalk", async () => {
    const { dingtalkPlugin } = await import("../../src/channel");
    const plugin = dingtalkPlugin as any;
    await plugin.status.probeAccount({
      account: { accountId: "main", clientId: "id", clientSecret: "secret" },
    } as any);
    expect(mockProbe).toHaveBeenCalledWith({
      clientId: "id",
      clientSecret: "secret",
      accountId: "main",
    });
  });
});
