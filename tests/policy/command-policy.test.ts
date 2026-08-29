import { describe, expect, it } from "vitest";
import {
  checkCommandPolicy,
  CommandPolicy,
} from "../../src/policy";
import {
  DEFAULT_COMMAND_BLOCK_MESSAGE,
} from "../../src/utils/constants";

describe("checkCommandPolicy", () => {
  describe("open mode (default)", () => {
    it("should allow all commands when mode is open", () => {
      const policy: CommandPolicy = { mode: "open" };
      const result = checkCommandPolicy("/any-command", policy);
      expect(result.isAllowed).toBe(true);
    });

    it("should allow all commands when policy is undefined", () => {
      const result = checkCommandPolicy("/any-command", undefined);
      expect(result.isAllowed).toBe(true);
    });

    it("should allow non-command messages", () => {
      const policy: CommandPolicy = { mode: "open" };
      const result = checkCommandPolicy("你好，世界", policy);
      expect(result.isAllowed).toBe(true);
    });
  });

  describe("allowlist mode", () => {
    it("should allow commands in allowlist", () => {
      const policy: CommandPolicy = {
        mode: "allowlist",
        allow: ["/new", "/reset", "/clear"],
      };
      const result = checkCommandPolicy("/new", policy);
      expect(result.isAllowed).toBe(true);
    });

    it("should block commands not in allowlist", () => {
      const policy: CommandPolicy = {
        mode: "allowlist",
        allow: ["/new", "/reset", "/clear"],
      };
      const result = checkCommandPolicy("/tools", policy);
      expect(result.isAllowed).toBe(false);
      expect(result.blockMessage).toBe(DEFAULT_COMMAND_BLOCK_MESSAGE);
    });

    it("should use custom blockMessage when provided", () => {
      const customMessage = "自定义拦截消息";
      const policy: CommandPolicy = {
        mode: "allowlist",
        allow: ["/new"],
        blockMessage: customMessage,
      };
      const result = checkCommandPolicy("/tools", policy);
      expect(result.isAllowed).toBe(false);
      expect(result.blockMessage).toBe(customMessage);
    });

    it("should be case-insensitive for command comparison", () => {
      const policy: CommandPolicy = {
        mode: "allowlist",
        allow: ["/NEW", "/Reset"],
      };
      expect(checkCommandPolicy("/new", policy).isAllowed).toBe(true);
      expect(checkCommandPolicy("/RESET", policy).isAllowed).toBe(true);
    });

    it("should allow non-command messages even in allowlist mode", () => {
      const policy: CommandPolicy = {
        mode: "allowlist",
        allow: ["/new"],
      };
      const result = checkCommandPolicy("普通消息", policy);
      expect(result.isAllowed).toBe(true);
    });

    it("should handle empty allow list with default commands", () => {
      const policy: CommandPolicy = {
        mode: "allowlist",
        allow: [],
      };
      // Should use default allowed commands
      expect(checkCommandPolicy("/new", policy).isAllowed).toBe(true);
      expect(checkCommandPolicy("/tools", policy).isAllowed).toBe(false);
    });
  });

  describe("denylist mode", () => {
    it("should block commands in denylist", () => {
      const policy: CommandPolicy = {
        mode: "denylist",
        deny: ["/tools", "/admin"],
      };
      const result = checkCommandPolicy("/tools", policy);
      expect(result.isAllowed).toBe(false);
    });

    it("should allow commands not in denylist", () => {
      const policy: CommandPolicy = {
        mode: "denylist",
        deny: ["/tools", "/admin"],
      };
      const result = checkCommandPolicy("/new", policy);
      expect(result.isAllowed).toBe(true);
    });

    it("should use custom blockMessage when provided", () => {
      const customMessage = "该命令已被禁用";
      const policy: CommandPolicy = {
        mode: "denylist",
        deny: ["/tools"],
        blockMessage: customMessage,
      };
      const result = checkCommandPolicy("/tools", policy);
      expect(result.isAllowed).toBe(false);
      expect(result.blockMessage).toBe(customMessage);
    });

    it("should be case-insensitive for command comparison", () => {
      const policy: CommandPolicy = {
        mode: "denylist",
        deny: ["/TOOLS"],
      };
      expect(checkCommandPolicy("/tools", policy).isAllowed).toBe(false);
      expect(checkCommandPolicy("/Tools", policy).isAllowed).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle empty messages", () => {
      const policy: CommandPolicy = { mode: "allowlist", allow: ["/new"] };
      expect(checkCommandPolicy("", policy).isAllowed).toBe(true);
      expect(checkCommandPolicy("   ", policy).isAllowed).toBe(true);
    });

    it("should handle messages with whitespace", () => {
      const policy: CommandPolicy = {
        mode: "allowlist",
        allow: ["/new"],
      };
      expect(checkCommandPolicy("  /new  ", policy).isAllowed).toBe(true);
      expect(checkCommandPolicy("  /tools  ", policy).isAllowed).toBe(false);
    });

    it("should only filter commands starting with /", () => {
      const policy: CommandPolicy = {
        mode: "allowlist",
        allow: ["/new"],
      };
      // Messages not starting with / should be allowed
      expect(checkCommandPolicy("new", policy).isAllowed).toBe(true);
      expect(checkCommandPolicy("tools", policy).isAllowed).toBe(true);
    });
  });
});

// DM Command Policy specific tests
describe("DM Command Policy Scenarios", () => {
  it("should block /tools in DM when allowlist only allows /new", () => {
    const dmCommandPolicy: CommandPolicy = {
      mode: "allowlist",
      allow: ["/new", "/reset", "/clear"],
      blockMessage: "抱歉，我目前仅支持以下会话管理命令：\n/new、/reset、/clear\n如需其他帮助，请联系管理员。",
    };

    // Allowed commands
    expect(checkCommandPolicy("/new", dmCommandPolicy).isAllowed).toBe(true);
    expect(checkCommandPolicy("/reset", dmCommandPolicy).isAllowed).toBe(true);
    expect(checkCommandPolicy("/clear", dmCommandPolicy).isAllowed).toBe(true);

    // Blocked commands
    const toolsResult = checkCommandPolicy("/tools", dmCommandPolicy);
    expect(toolsResult.isAllowed).toBe(false);
    expect(toolsResult.blockMessage).toBe(dmCommandPolicy.blockMessage);

    const adminResult = checkCommandPolicy("/admin", dmCommandPolicy);
    expect(adminResult.isAllowed).toBe(false);

    // /stop is not supported (requires immediate termination semantics)
    const stopResult = checkCommandPolicy("/stop", dmCommandPolicy);
    expect(stopResult.isAllowed).toBe(false);
  });

  it("should allow normal messages in DM regardless of command policy", () => {
    const dmCommandPolicy: CommandPolicy = {
      mode: "allowlist",
      allow: ["/new"],
    };

    // Normal messages should pass through
    expect(checkCommandPolicy("你好", dmCommandPolicy).isAllowed).toBe(true);
    expect(checkCommandPolicy("开场白", dmCommandPolicy).isAllowed).toBe(true);
    expect(checkCommandPolicy("帮助", dmCommandPolicy).isAllowed).toBe(true);
  });

  it("should handle dmCommandAllowlist bypass scenario", () => {
    // This test documents the expected behavior:
    // When a user is in dmCommandAllowlist, command policy check should be skipped
    // This is implemented in message-handler.ts, not in checkCommandPolicy itself
    const dmCommandPolicy: CommandPolicy = {
      mode: "allowlist",
      allow: ["/new"],
    };

    // Without allowlist bypass, /tools should be blocked
    const result = checkCommandPolicy("/tools", dmCommandPolicy);
    expect(result.isAllowed).toBe(false);
  });
});
