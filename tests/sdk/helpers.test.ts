import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  isSecretInputRef,
  normalizeSecretInputString,
  resolveSecretInputValue,
  hasConfiguredSecretInput,
  normalizeResolvedSecretInputString,
  resolveDefaultGroupPolicy,
  resolveAllowlistProviderRuntimeGroupPolicy,
  createDefaultChannelRuntimeState,
  buildBaseChannelStatusSummary,
  addWildcardAllowFrom,
  formatDocsLink,
  normalizeString,
  parseAllowFromInput,
} from "../../src/sdk/helpers";

describe("sdk/helpers", () => {
  beforeEach(() => {
    delete process.env.TEST_SECRET_VAR;
  });

  describe("normalizeAccountId", () => {
    it("normalizes default and empty to DEFAULT_ACCOUNT_ID", () => {
      expect(normalizeAccountId("default")).toBe(DEFAULT_ACCOUNT_ID);
      expect(normalizeAccountId("  DEFAULT  ")).toBe(DEFAULT_ACCOUNT_ID);
      expect(normalizeAccountId("")).toBe(DEFAULT_ACCOUNT_ID);
    });

    it("trims non-default ids (preserves original case)", () => {
      expect(normalizeAccountId("  MyAccount  ")).toBe("MyAccount");
    });
  });

  describe("isSecretInputRef", () => {
    it("returns true for valid ref", () => {
      expect(isSecretInputRef({ source: "env", provider: "system", id: "KEY" })).toBe(true);
      expect(isSecretInputRef({ source: "file", provider: "p", id: "value" })).toBe(true);
      expect(isSecretInputRef({ source: "store", provider: "default", id: "KEY" })).toBe(true);
    });

    it("returns false for invalid values", () => {
      expect(isSecretInputRef(null)).toBe(false);
      expect(isSecretInputRef("str")).toBe(false);
      expect(isSecretInputRef({ source: "env" })).toBe(false);
      expect(isSecretInputRef({ source: "env", provider: "", id: "x" })).toBe(false);
      expect(isSecretInputRef({ source: "store", provider: "Default", id: "KEY" })).toBe(false);
      expect(isSecretInputRef({ source: "store", provider: "default", id: "bad-id" })).toBe(false);
    });
  });

  describe("normalizeSecretInputString", () => {
    it("handles strings, refs, and unknown", () => {
      expect(normalizeSecretInputString("  abc  ")).toBe("abc");
      expect(normalizeSecretInputString("")).toBeUndefined();
      expect(normalizeSecretInputString({ source: "env", provider: "p", id: "KEY" })).toBe("<env:p:KEY>");
      expect(normalizeSecretInputString(42)).toBeUndefined();
    });
  });

  describe("resolveSecretInputValue", () => {
    it("resolves plain string", () => {
      expect(resolveSecretInputValue("val")).toBe("val");
      expect(resolveSecretInputValue("  ")).toBeUndefined();
    });

    it("resolves env ref when allowed", () => {
      process.env.TEST_SECRET_VAR = "secret_val";
      const ref = { source: "env", provider: "system", id: "TEST_SECRET_VAR" };
      expect(resolveSecretInputValue(ref, { allowEnvRead: true })).toBe("secret_val");
      expect(resolveSecretInputValue(ref)).toBe("<env:system:TEST_SECRET_VAR>");
    });

    it("returns ref string for file/exec", () => {
      expect(resolveSecretInputValue({ source: "file", provider: "p", id: "value" })).toBe("<file:p:value>");
    });

    it("returns undefined for non-matching", () => {
      expect(resolveSecretInputValue(123)).toBeUndefined();
    });
  });

  describe("hasConfiguredSecretInput", () => {
    it("checks string", () => {
      expect(hasConfiguredSecretInput("abc")).toBe(true);
      expect(hasConfiguredSecretInput("  ")).toBe(false);
    });

    it("checks env ref", () => {
      process.env.TEST_SECRET_VAR = "val";
      expect(hasConfiguredSecretInput({ source: "env", provider: "p", id: "TEST_SECRET_VAR" })).toBe(true);
      delete process.env.TEST_SECRET_VAR;
      expect(hasConfiguredSecretInput({ source: "env", provider: "p", id: "TEST_SECRET_VAR" })).toBe(false);
    });

    it("file/exec always configured", () => {
      expect(hasConfiguredSecretInput({ source: "file", provider: "p", id: "value" })).toBe(true);
    });

    it("returns false for unknown", () => {
      expect(hasConfiguredSecretInput(null)).toBe(false);
    });
  });

  describe("normalizeResolvedSecretInputString", () => {
    it("resolves string value", () => {
      expect(normalizeResolvedSecretInputString({ value: "abc", path: "p" })).toBe("abc");
    });

    it("throws for empty string", () => {
      expect(() => normalizeResolvedSecretInputString({ value: "  ", path: "p" })).toThrow("non-empty");
    });

    it("rejects an unresolved env ref in the strict path", () => {
      expect(() =>
        normalizeResolvedSecretInputString({
          value: { source: "env", provider: "p", id: "TEST_SECRET_VAR" },
          path: "p",
        }),
      ).toThrow("must be resolved by OpenClaw");
    });

    it("rejects unresolved non-env refs", () => {
      expect(() =>
        normalizeResolvedSecretInputString({
          value: { source: "store", provider: "default", id: "KEY" },
          path: "p",
        }),
      ).toThrow("must be resolved by OpenClaw");
    });

    it("throws for non-string non-ref", () => {
      expect(() => normalizeResolvedSecretInputString({ value: 42, path: "p" })).toThrow(
        "must be a string or SecretInput",
      );
    });
  });

  describe("group policy helpers", () => {
    it("resolveDefaultGroupPolicy reads from config", () => {
      expect(resolveDefaultGroupPolicy({})).toBe("open");
      expect(
        resolveDefaultGroupPolicy({
          channels: { "dingtalk-connector": { groupPolicy: "allowlist" } },
        }),
      ).toBe("allowlist");
    });

    it("resolveAllowlistProviderRuntimeGroupPolicy follows priority", () => {
      expect(
        resolveAllowlistProviderRuntimeGroupPolicy({
          providerConfigPresent: true,
          groupPolicy: "allowlist",
          defaultGroupPolicy: "open",
        }),
      ).toEqual({ groupPolicy: "allowlist" });

      expect(
        resolveAllowlistProviderRuntimeGroupPolicy({
          providerConfigPresent: true,
          defaultGroupPolicy: "open",
        }),
      ).toEqual({ groupPolicy: "open" });

      expect(
        resolveAllowlistProviderRuntimeGroupPolicy({
          providerConfigPresent: false,
          defaultGroupPolicy: "open",
        }),
      ).toEqual({ groupPolicy: "disabled" });
    });
  });

  describe("channel state helpers", () => {
    it("createDefaultChannelRuntimeState", () => {
      const s = createDefaultChannelRuntimeState("acc-1", { port: 8080 });
      expect(s.accountId).toBe("acc-1");
      expect(s.running).toBe(false);
      expect((s as any).port).toBe(8080);
    });

    it("buildBaseChannelStatusSummary fills defaults", () => {
      const s = buildBaseChannelStatusSummary({
        accountId: "a",
        enabled: true,
        configured: true,
      });
      expect(s.running).toBe(false);
      expect(s.lastStartAt).toBeNull();
    });
  });

  describe("misc helpers", () => {
    it("addWildcardAllowFrom", () => {
      expect(addWildcardAllowFrom()).toEqual(["*"]);
      expect(addWildcardAllowFrom(["u1"])).toEqual(["u1", "*"]);
      expect(addWildcardAllowFrom(["u1", "*"])).toEqual(["u1", "*"]);
    });

    it("formatDocsLink", () => {
      expect(formatDocsLink("/test", "label")).toContain("/test");
    });

    it("normalizeString", () => {
      expect(normalizeString("  a  ")).toBe("a");
      expect(normalizeString("")).toBeUndefined();
      expect(normalizeString(123)).toBeUndefined();
    });

    it("parseAllowFromInput", () => {
      expect(parseAllowFromInput("a, b; c\nd")).toEqual(["a", "b", "c", "d"]);
    });
  });
});
