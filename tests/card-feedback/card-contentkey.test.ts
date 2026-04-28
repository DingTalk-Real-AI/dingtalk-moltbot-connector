/**
 * card.ts 自定义 contentKey 替换路径单元测试
 *
 * 验证 streamAICard / finishAICard 在默认模板和自定义模板下：
 * - 正确使用 contentKey
 * - 默认模板写入 staticMsgContent: ""
 * - 自定义模板不写入 staticMsgContent
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dingtalkHttp 以拦截 API 调用
const mockPut = vi.fn();
const mockPost = vi.fn();
vi.mock("../../src/utils/http-client", () => ({
  dingtalkHttp: {
    put: (...args: any[]) => mockPut(...args),
    post: (...args: any[]) => mockPost(...args),
  },
}));

vi.mock("../../src/utils/token", () => ({
  DINGTALK_API: "https://api.dingtalk.com",
  getAccessToken: vi.fn().mockResolvedValue("mock-token"),
}));

import { streamAICard, finishAICard, type AICardInstance } from "../../src/services/messaging/card";
import type { DingtalkConfig } from "../../src/types/index";

describe("card.ts contentKey 路径", () => {
  let mockCard: AICardInstance;
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    mockCard = {
      cardInstanceId: "card_test_001",
      accessToken: "mock-token",
      tokenExpireTime: Date.now() + 3600000,
      inputingStarted: false,
    };
    mockPut.mockReset();
    mockPut.mockResolvedValue({ status: 200 });
    mockPost.mockReset();
    mockPost.mockResolvedValue({ status: 200, data: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===== streamAICard =====

  describe("streamAICard - 默认模板", () => {
    it("使用默认 contentKey='msgContent' 且包含 staticMsgContent", async () => {
      const config = { clientId: "test" } as DingtalkConfig;

      await streamAICard(mockCard, "Hello world", false, config, mockLog);

      // 第一次调用是 INPUTING 状态切换 (PUT /card/instances)
      const inputingCall = mockPut.mock.calls[0];
      const inputingBody = inputingCall[1];

      expect(inputingBody.cardData.cardParamMap.msgContent).toBeDefined();
      expect(inputingBody.cardData.cardParamMap.staticMsgContent).toBe("");
      // sys_full_json_obj 中的 order 应包含 msgContent
      const sysJson = JSON.parse(inputingBody.cardData.cardParamMap.sys_full_json_obj);
      expect(sysJson.order).toContain("msgContent");
    });
  });

  describe("streamAICard - 自定义模板", () => {
    it("使用自定义 contentKey 且不包含 staticMsgContent", async () => {
      const config = {
        clientId: "test",
        cardTemplateKey: "customContent",
      } as unknown as DingtalkConfig;

      await streamAICard(mockCard, "Hello custom", false, config, mockLog);

      // INPUTING 状态切换
      const inputingCall = mockPut.mock.calls[0];
      const inputingBody = inputingCall[1];

      // 应使用自定义 key
      expect(inputingBody.cardData.cardParamMap.customContent).toBeDefined();
      // 不应包含 msgContent
      expect(inputingBody.cardData.cardParamMap.msgContent).toBeUndefined();
      // 不应包含 staticMsgContent（避免污染自定义字段）
      expect(inputingBody.cardData.cardParamMap.staticMsgContent).toBeUndefined();
      // sys_full_json_obj 中的 order 应包含自定义 key
      const sysJson = JSON.parse(inputingBody.cardData.cardParamMap.sys_full_json_obj);
      expect(sysJson.order).toContain("customContent");
    });
  });

  // ===== finishAICard =====

  describe("finishAICard - 默认模板", () => {
    it("FINISHED 状态包含 staticMsgContent: ''", async () => {
      const config = { clientId: "test" } as DingtalkConfig;
      // 需要先让 inputingStarted = true 以跳过 INPUTING
      mockCard.inputingStarted = true;

      await finishAICard(mockCard, "Final content", config, mockLog);

      // finishAICard 内部先调 streamAICard (isFinalize=true) 再调 PUT /card/instances (FINISHED)
      // 找到 FINISHED 的调用（cardData 包含 flowStatus=3）
      const finishedCall = mockPut.mock.calls.find((call: any) => {
        const body = call[1];
        return body.cardData?.cardParamMap?.flowStatus === "3";
      });

      expect(finishedCall).toBeDefined();
      const finishedBody = finishedCall![1];
      expect(finishedBody.cardData.cardParamMap.msgContent).toBeDefined();
      expect(finishedBody.cardData.cardParamMap.staticMsgContent).toBe("");
    });
  });

  describe("finishAICard - 自定义模板", () => {
    it("FINISHED 状态不包含 staticMsgContent", async () => {
      const config = {
        clientId: "test",
        cardTemplateKey: "myContent",
      } as unknown as DingtalkConfig;
      mockCard.inputingStarted = true;

      await finishAICard(mockCard, "Final custom content", config, mockLog);

      const finishedCall = mockPut.mock.calls.find((call: any) => {
        const body = call[1];
        return body.cardData?.cardParamMap?.flowStatus === "3";
      });

      expect(finishedCall).toBeDefined();
      const finishedBody = finishedCall![1];
      expect(finishedBody.cardData.cardParamMap.myContent).toBeDefined();
      expect(finishedBody.cardData.cardParamMap.msgContent).toBeUndefined();
      expect(finishedBody.cardData.cardParamMap.staticMsgContent).toBeUndefined();
    });
  });
});
