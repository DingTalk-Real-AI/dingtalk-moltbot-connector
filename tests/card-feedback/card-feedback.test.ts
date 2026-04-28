import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// mock node:os 的 homedir，后续通过 _fakeHome 动态修改返回值
let _fakeHome = "/tmp";
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => _fakeHome,
  };
});

import {
  registerCardSession,
  lookupCardSession,
  cleanupExpiredCardSessions,
  recordFeedbackToSession,
  _getRegistryForTesting,
  CARD_SESSION_TTL,
} from "../../src/services/card-session-registry";

describe("card-session-registry", () => {
  beforeEach(() => {
    _getRegistryForTesting().clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===== registerCardSession / lookupCardSession =====

  describe("registerCardSession / lookupCardSession", () => {
    it("注册后能查到映射", async () => {
      registerCardSession("card-001", {
        sessionKey: "agent:admin:dingtalk-connector:direct:100",
        agentId: "admin",
        createdAt: Date.now(),
      });

      const info = await lookupCardSession("card-001");
      expect(info).not.toBeNull();
      expect(info!.sessionKey).toBe("agent:admin:dingtalk-connector:direct:100");
      expect(info!.agentId).toBe("admin");
    });

    it("未注册的 cardInstanceId 返回 null", async () => {
      expect(await lookupCardSession("nonexistent")).toBeNull();
    });

    it("同一 cardInstanceId 注册多次覆盖旧值", async () => {
      registerCardSession("card-001", {
        sessionKey: "key-old",
        agentId: "admin",
        createdAt: Date.now(),
      });
      registerCardSession("card-001", {
        sessionKey: "key-new",
        agentId: "admin",
        createdAt: Date.now(),
      });
      expect((await lookupCardSession("card-001"))!.sessionKey).toBe("key-new");
    });
  });

  // ===== cleanupExpiredCardSessions =====

  describe("cleanupExpiredCardSessions", () => {
    it("清理过期的条目，保留未过期的", async () => {
      const now = Date.now();
      registerCardSession("expired-1", {
        sessionKey: "key-1",
        agentId: "admin",
        createdAt: now - CARD_SESSION_TTL - 1000,
      });
      registerCardSession("fresh-1", {
        sessionKey: "key-2",
        agentId: "admin",
        createdAt: now,
      });

      const removed = cleanupExpiredCardSessions();
      expect(removed).toBe(1);
      expect(await lookupCardSession("expired-1")).toBeNull();
      expect(await lookupCardSession("fresh-1")).not.toBeNull();
    });

    it("全部未过期时返回 0", () => {
      registerCardSession("card-a", {
        sessionKey: "key-a",
        agentId: "admin",
        createdAt: Date.now(),
      });
      expect(cleanupExpiredCardSessions()).toBe(0);
    });
  });

  // ===== recordFeedbackToSession =====

  describe("recordFeedbackToSession", () => {
    let tmpDir: string;
    const agentId = "test-agent";
    const sessionKey = "agent:test-agent:dingtalk:direct:999";
    const sessionId = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";

    beforeEach(() => {
      // 创建临时目录模拟 ~/.openclaw/agents/{agentId}/sessions/
      tmpDir = fs.mkdtempSync(path.join("/tmp", "card-feedback-test-"));
      const sessionsDir = path.join(tmpDir, ".openclaw", "agents", agentId, "sessions");
      fs.mkdirSync(sessionsDir, { recursive: true });

      // 创建 session 文件
      const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
      fs.writeFileSync(sessionFile, JSON.stringify({ type: "session", id: "s1" }));

      // 创建 sessions.json
      const sessionsJson: Record<string, any> = {};
      sessionsJson[sessionKey] = { sessionId, sessionFile };
      fs.writeFileSync(
        path.join(sessionsDir, "sessions.json"),
        JSON.stringify(sessionsJson)
      );

      // 设置 fakeHome 使 homedir() 返回 tmpDir
      _fakeHome = tmpDir;

      // 注册卡片映射
      registerCardSession("card-feedback-test", {
        sessionKey,
        agentId,
        createdAt: Date.now(),
      });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("点赞反馈成功写入 session 文件", async () => {
      const result = await recordFeedbackToSession({
        outTrackId: "card-feedback-test",
        like: 1,
        userId: "user-001",
      });
      expect(result).toBe(true);

      // 读取文件验证
      const sessionFile = path.join(
        tmpDir, ".openclaw", "agents", agentId, "sessions", `${sessionId}.jsonl`
      );
      const lines = fs.readFileSync(sessionFile, "utf-8").split("\n").filter(Boolean);
      expect(lines.length).toBe(2); // 原始 session 行 + 反馈行

      const feedbackEntry = JSON.parse(lines[1]);
      expect(feedbackEntry.type).toBe("custom");
      expect(feedbackEntry.customType).toBe("user-feedback");
      expect(feedbackEntry.data.like).toBe(1);
      expect(feedbackEntry.data.userId).toBe("user-001");
      expect(feedbackEntry.data.source).toBe("dingtalk-card");
      expect(feedbackEntry.id).toBeTruthy();
      expect(feedbackEntry.timestamp).toBeTruthy();
    });

    it("点踩反馈包含原因信息", async () => {
      const result = await recordFeedbackToSession({
        outTrackId: "card-feedback-test",
        like: -1,
        userId: "user-002",
        dislikeReasons: ["回答不准确", "太啰嗦"],
        customDislikeReason: "没有给出具体代码",
      });
      expect(result).toBe(true);

      const sessionFile = path.join(
        tmpDir, ".openclaw", "agents", agentId, "sessions", `${sessionId}.jsonl`
      );
      const lines = fs.readFileSync(sessionFile, "utf-8").split("\n").filter(Boolean);
      const feedbackEntry = JSON.parse(lines[1]);

      expect(feedbackEntry.data.like).toBe(-1);
      expect(feedbackEntry.data.dislikeReasons).toEqual(["回答不准确", "太啰嗦"]);
      expect(feedbackEntry.data.customDislikeReason).toBe("没有给出具体代码");
    });

    it("点赞反馈不包含 dislikeReasons 字段", async () => {
      await recordFeedbackToSession({
        outTrackId: "card-feedback-test",
        like: 1,
        userId: "user-003",
      });

      const sessionFile = path.join(
        tmpDir, ".openclaw", "agents", agentId, "sessions", `${sessionId}.jsonl`
      );
      const lines = fs.readFileSync(sessionFile, "utf-8").split("\n").filter(Boolean);
      const feedbackEntry = JSON.parse(lines[1]);

      expect(feedbackEntry.data.dislikeReasons).toBeUndefined();
      expect(feedbackEntry.data.customDislikeReason).toBeUndefined();
    });

    it("outTrackId 为空时返回 false", async () => {
      const result = await recordFeedbackToSession({
        outTrackId: "",
        like: 1,
        userId: "user-001",
      });
      expect(result).toBe(false);
    });

    it("找不到卡片映射时返回 false", async () => {
      const result = await recordFeedbackToSession({
        outTrackId: "unknown-card",
        like: 1,
        userId: "user-001",
      });
      expect(result).toBe(false);
    });

    it("sessions.json 不存在时返回 false", async () => {
      // 注册一个指向不存在 agentId 目录的卡片
      registerCardSession("card-no-agent", {
        sessionKey: "agent:ghost:dingtalk:direct:1",
        agentId: "ghost",
        createdAt: Date.now(),
      });

      const result = await recordFeedbackToSession({
        outTrackId: "card-no-agent",
        like: 1,
        userId: "user-001",
      });
      expect(result).toBe(false);
    });

    it("sessionKey 在 sessions.json 中不存在时返回 false", async () => {
      registerCardSession("card-wrong-key", {
        sessionKey: "agent:test-agent:dingtalk:direct:nonexistent",
        agentId,
        createdAt: Date.now(),
      });

      const result = await recordFeedbackToSession({
        outTrackId: "card-wrong-key",
        like: -1,
        userId: "user-001",
      });
      expect(result).toBe(false);
    });

    it("sessionFile 路径在 sessions.json 中存在但实际文件已删除时返回 false", async () => {
      // 删除 session 文件模拟文件被清理的场景
      const sessionFile = path.join(
        tmpDir, ".openclaw", "agents", agentId, "sessions", `${sessionId}.jsonl`
      );
      fs.unlinkSync(sessionFile);

      const result = await recordFeedbackToSession({
        outTrackId: "card-feedback-test",
        like: 1,
        userId: "user-001",
      });
      expect(result).toBe(false);
    });
  });
});
