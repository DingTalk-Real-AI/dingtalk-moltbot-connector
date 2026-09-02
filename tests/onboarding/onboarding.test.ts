import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPromptSingleChannelSecretInput = vi.hoisted(() => vi.fn());
const mockResolveDingtalkCredentials = vi.hoisted(() => vi.fn());
const mockResolveDingtalkAccount = vi.hoisted(() => vi.fn());
const mockProbeDingtalk = vi.hoisted(() => vi.fn());
const mockHasConfiguredSecretInput = vi.hoisted(() => vi.fn());
const mockAddWildcardAllowFrom = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/setup", () => ({
  promptSingleChannelSecretInput: mockPromptSingleChannelSecretInput,
}));

vi.mock("../../src/config/accounts.ts", () => ({
  resolveDingtalkCredentials: mockResolveDingtalkCredentials,
  resolveDingtalkAccount: mockResolveDingtalkAccount,
}));

vi.mock("../../src/probe.ts", () => ({
  probeDingtalk: mockProbeDingtalk,
}));

vi.mock("../../src/sdk/helpers.ts", () => ({
  DEFAULT_ACCOUNT_ID: "__default__",
  formatDocsLink: vi.fn(() => "https://docs.example/dingtalk"),
  hasConfiguredSecretInput: mockHasConfiguredSecretInput,
  addWildcardAllowFrom: mockAddWildcardAllowFrom,
}));

describe("dingtalkOnboardingAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveDingtalkCredentials.mockReturnValue(null);
    // Default: not configured (no credentials resolved)
    mockResolveDingtalkAccount.mockReturnValue({
      accountId: "__default__",
      configured: false,
      enabled: true,
      clientId: undefined,
      clientSecret: undefined,
      config: {},
    });
    mockProbeDingtalk.mockResolvedValue({ ok: true, botName: "bot-a" });
    mockHasConfiguredSecretInput.mockReturnValue(false);
    mockAddWildcardAllowFrom.mockImplementation((arr: any[] = []) =>
      Array.from(new Set([...(arr || []), "*"])),
    );
    delete process.env.DINGTALK_CLIENT_ID;
    delete process.env.DINGTALK_CLIENT_SECRET;
    delete process.env.TEST_ENV_CLIENT_ID;
  });

  function createPrompter(overrides?: Partial<any>) {
    return {
      note: vi.fn(async () => undefined),
      text: vi.fn(async () => "user1,user2"),
      select: vi.fn(async () => "open"),
      confirm: vi.fn(async () => true),
      ...overrides,
    };
  }

  it("getStatus returns needs creds when not configured", async () => {
    const { dingtalkOnboardingAdapter } = await import("../../src/onboarding");
    const out = await (dingtalkOnboardingAdapter as any).getStatus({
      cfg: {} as any,
      accountOverrides: undefined,
    });
    expect(out.configured).toBe(false);
    expect(out.statusLines[0]).toContain("needs app credentials");
  });

  it("getStatus returns connected when configured and probe ok", async () => {
    // Simulate a fully configured account (e.g. multi-account mode with account-level credentials)
    mockResolveDingtalkAccount.mockReturnValue({
      accountId: "__default__",
      configured: true,
      enabled: true,
      clientId: "id",
      clientSecret: "secret",
      config: { clientId: "id", clientSecret: "secret" },
    });
    mockProbeDingtalk.mockResolvedValue({ ok: true, botName: "DingBot" });

    const { dingtalkOnboardingAdapter } = await import("../../src/onboarding");
    const cfg = {
      channels: {
        "dingtalk-connector": {
          accounts: {
            mybot: { enabled: true, clientId: "id", clientSecret: "secret" },
          },
        },
      },
    } as any;
    const out = await (dingtalkOnboardingAdapter as any).getStatus({
      cfg,
      accountOverrides: undefined,
    });
    expect(out.configured).toBe(true);
    expect(out.statusLines[0]).toContain("connected as DingBot");
  });

  it("configure supports use-env + allowlist group config", async () => {
    process.env.DINGTALK_CLIENT_ID = "env-id";
    process.env.DINGTALK_CLIENT_SECRET = "env-secret";
    mockPromptSingleChannelSecretInput.mockResolvedValue({ action: "use-env" });

    const prompter = createPrompter({
      select: vi.fn(async () => "allowlist"),
      text: vi
        .fn()
        .mockResolvedValueOnce("cid1,cid2"), // group allowlist
    });
    const { dingtalkOnboardingAdapter } = await import("../../src/onboarding");
    const result = await (dingtalkOnboardingAdapter as any).configure({
      cfg: { channels: {} } as any,
      prompter: prompter as any,
    });
    const channels = (result.cfg as any).channels;

    expect(result.accountId).toBe("__default__");
    expect(channels["dingtalk-connector"].enabled).toBe(true);
    expect(channels["dingtalk-connector"].groupPolicy).toBe("allowlist");
    expect(channels["dingtalk-connector"].groupAllowFrom).toEqual(["cid1", "cid2"]);
  });

  it("configure supports set-secret flow and probe failure note", async () => {
    mockPromptSingleChannelSecretInput.mockResolvedValue({
      action: "set",
      value: "secret-value",
      resolvedValue: "secret-value",
    });
    mockProbeDingtalk.mockResolvedValue({ ok: false, error: "bad credentials" });

    const prompter = createPrompter({
      text: vi
        .fn()
        .mockResolvedValueOnce("client-id") // prompt client id
        .mockResolvedValueOnce(""), // group allowlist skipped by policy=open
      select: vi.fn(async () => "open"),
    });

    const { dingtalkOnboardingAdapter } = await import("../../src/onboarding");
    const out = await (dingtalkOnboardingAdapter as any).configure({
      cfg: { channels: {} } as any,
      prompter: prompter as any,
    });
    const channels = (out.cfg as any).channels;

    expect(channels["dingtalk-connector"].clientId).toBe("client-id");
    expect(channels["dingtalk-connector"].clientSecret).toBe("secret-value");
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Connection failed"),
      "DingTalk connection test",
    );
  });

  it("dmPolicy helpers support get/set/prompt", async () => {
    const { dingtalkOnboardingAdapter } = await import("../../src/onboarding");
    const dmPolicy = dingtalkOnboardingAdapter.dmPolicy as any;
    const current = dmPolicy.getCurrent({ channels: {} });
    expect(current).toBe("open");

    const cfg1 = dmPolicy.setPolicy(
      { channels: { "dingtalk-connector": { allowFrom: ["u1"] } } },
      "open",
    );
    expect(cfg1.channels["dingtalk-connector"].allowFrom).toContain("*");

    const prompter = createPrompter({
      text: vi
        .fn()
        .mockResolvedValueOnce("   ")
        .mockResolvedValueOnce("u2, u3"),
    });
    const cfg2 = await dmPolicy.promptAllowFrom({
      cfg: { channels: { "dingtalk-connector": { allowFrom: ["u1"] } } },
      prompter,
    });
    expect(cfg2.channels["dingtalk-connector"].allowFrom).toEqual(["u1", "u2", "u3"]);
  });

  it("disable marks channel disabled", async () => {
    const { dingtalkOnboardingAdapter } = await import("../../src/onboarding");
    const out = (dingtalkOnboardingAdapter as any).disable({
      channels: { "dingtalk-connector": {} },
    } as any);
    expect((out as any).channels["dingtalk-connector"].enabled).toBe(false);
  });
});
