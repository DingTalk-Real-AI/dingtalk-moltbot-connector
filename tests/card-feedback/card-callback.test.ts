/**
 * TOPIC_CARD 回调处理器单元测试
 *
 * 通过模拟 DingTalk Stream client 和 connection.ts 中 TOPIC_CARD 回调逻辑，
 * 验证 actionId 解析、自定义 actionId 生效、点踩原因提取等核心路径。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============ 模拟 TOPIC_CARD 回调处理逻辑（从 connection.ts 提取核心逻辑） ============

interface CardCallbackConfig {
  cardLikeActionId?: string;
  cardDislikeActionId?: string;
  cardFeedbackStatusKey?: string;
}

/**
 * 模拟 TOPIC_CARD 回调处理器的核心逻辑，
 * 与 connection.ts 中的实现保持一致。
 */
function processCardCallback(
  rawData: string,
  config: CardCallbackConfig = {},
): {
  response: Record<string, any>;
  parseFailed: boolean;
  actionType: "like" | "dislike" | "unknown" | "parse_error";
  dislikeReasons?: string[];
  customDislikeReason?: string;
} {
  // 1. 解析回调数据
  let callbackData: any = {};
  try {
    callbackData = JSON.parse(rawData);
  } catch {
    return {
      response: { success: false },
      parseFailed: true,
      actionType: "parse_error",
    };
  }

  // 2. 二次解析 content
  let parsedContent: any = {};
  try {
    const rawContent = callbackData?.content;
    parsedContent =
      typeof rawContent === "string"
        ? JSON.parse(rawContent)
        : (rawContent ?? {});
  } catch {
    parsedContent = {};
  }

  const actionIds: string[] = Array.isArray(
    parsedContent?.cardPrivateData?.actionIds,
  )
    ? parsedContent.cardPrivateData.actionIds
    : [];
  const params = parsedContent?.cardPrivateData?.params ?? {};

  // 3. 从配置读取
  const likeActionId = config.cardLikeActionId || "ai_res_like";
  const dislikeActionId = config.cardDislikeActionId || "ai_res_dislike";
  const likeVar = config.cardFeedbackStatusKey || "like";

  // 4. 构造响应
  const response: Record<string, any> = {
    cardUpdateOptions: {
      updateCardDataByKey: true,
      updatePrivateDataByKey: true,
    },
    cardData: { cardParamMap: {} },
    userPrivateData: { cardParamMap: {} },
  };

  let actionType: "like" | "dislike" | "unknown" = "unknown";
  let dislikeReasons: string[] | undefined;
  let customDislikeReason: string | undefined;

  if (actionIds.includes(likeActionId)) {
    response.cardData.cardParamMap[likeVar] = 1;
    actionType = "like";
  } else if (actionIds.includes(dislikeActionId)) {
    response.cardData.cardParamMap[likeVar] = -1;
    response.cardData.cardParamMap.submitted = "true";
    actionType = "dislike";
    dislikeReasons = Array.isArray(params.dislike_reason)
      ? params.dislike_reason
      : [];
    customDislikeReason = params.custom_dislike_reason ?? undefined;
  }

  return { response, parseFailed: false, actionType, dislikeReasons, customDislikeReason };
}

// ============ 测试用例 ============

describe("TOPIC_CARD callback handler", () => {
  // ----- actionId 解析 -----

  describe("actionId 解析", () => {
    it("默认 actionId 点赞: ai_res_like", () => {
      const data = JSON.stringify({
        outTrackId: "card_001",
        userId: "user1",
        content: JSON.stringify({
          cardPrivateData: {
            actionIds: ["ai_res_like"],
            params: {},
          },
        }),
      });

      const result = processCardCallback(data);
      expect(result.actionType).toBe("like");
      expect(result.response.cardData.cardParamMap.like).toBe(1);
    });

    it("默认 actionId 点踩: ai_res_dislike", () => {
      const data = JSON.stringify({
        outTrackId: "card_002",
        userId: "user2",
        content: JSON.stringify({
          cardPrivateData: {
            actionIds: ["ai_res_dislike"],
            params: {
              dislike_reason: ["回答不准确", "内容过长"],
              custom_dislike_reason: "缺少代码示例",
            },
          },
        }),
      });

      const result = processCardCallback(data);
      expect(result.actionType).toBe("dislike");
      expect(result.response.cardData.cardParamMap.like).toBe(-1);
      expect(result.response.cardData.cardParamMap.submitted).toBe("true");
      expect(result.dislikeReasons).toEqual(["回答不准确", "内容过长"]);
      expect(result.customDislikeReason).toBe("缺少代码示例");
    });

    it("未知 actionId 按默认处理", () => {
      const data = JSON.stringify({
        outTrackId: "card_003",
        userId: "user3",
        content: JSON.stringify({
          cardPrivateData: {
            actionIds: ["some_unknown_action"],
            params: {},
          },
        }),
      });

      const result = processCardCallback(data);
      expect(result.actionType).toBe("unknown");
      expect(result.response.cardData.cardParamMap).toEqual({});
    });

    it("空 actionIds 数组按默认处理", () => {
      const data = JSON.stringify({
        outTrackId: "card_004",
        userId: "user4",
        content: JSON.stringify({
          cardPrivateData: {
            actionIds: [],
            params: {},
          },
        }),
      });

      const result = processCardCallback(data);
      expect(result.actionType).toBe("unknown");
    });
  });

  // ----- 自定义 actionId 生效 -----

  describe("自定义 actionId 生效", () => {
    it("自定义 cardLikeActionId 生效", () => {
      const data = JSON.stringify({
        outTrackId: "card_custom_1",
        userId: "user5",
        content: JSON.stringify({
          cardPrivateData: {
            actionIds: ["thumbs_up"],
            params: {},
          },
        }),
      });

      const result = processCardCallback(data, {
        cardLikeActionId: "thumbs_up",
        cardDislikeActionId: "thumbs_down",
      });
      expect(result.actionType).toBe("like");
    });

    it("自定义 cardDislikeActionId 生效", () => {
      const data = JSON.stringify({
        outTrackId: "card_custom_2",
        userId: "user6",
        content: JSON.stringify({
          cardPrivateData: {
            actionIds: ["thumbs_down"],
            params: {},
          },
        }),
      });

      const result = processCardCallback(data, {
        cardLikeActionId: "thumbs_up",
        cardDislikeActionId: "thumbs_down",
      });
      expect(result.actionType).toBe("dislike");
    });

    it("自定义 cardFeedbackStatusKey 生效", () => {
      const data = JSON.stringify({
        outTrackId: "card_custom_3",
        userId: "user7",
        content: JSON.stringify({
          cardPrivateData: {
            actionIds: ["ai_res_like"],
            params: {},
          },
        }),
      });

      const result = processCardCallback(data, {
        cardFeedbackStatusKey: "feedbackStatus",
      });
      expect(result.actionType).toBe("like");
      expect(result.response.cardData.cardParamMap.feedbackStatus).toBe(1);
      // 确保旧的 "like" key 不存在
      expect(result.response.cardData.cardParamMap.like).toBeUndefined();
    });
  });

  // ----- 点踩原因 -----

  describe("点踩原因解析", () => {
    it("点踩包含多个原因", () => {
      const data = JSON.stringify({
        outTrackId: "card_reason_1",
        userId: "user8",
        content: JSON.stringify({
          cardPrivateData: {
            actionIds: ["ai_res_dislike"],
            params: {
              dislike_reason: ["太长了", "不相关", "有错误"],
            },
          },
        }),
      });

      const result = processCardCallback(data);
      expect(result.dislikeReasons).toEqual(["太长了", "不相关", "有错误"]);
      expect(result.customDislikeReason).toBeUndefined();
    });

    it("点踩只有自定义原因", () => {
      const data = JSON.stringify({
        outTrackId: "card_reason_2",
        userId: "user9",
        content: JSON.stringify({
          cardPrivateData: {
            actionIds: ["ai_res_dislike"],
            params: {
              custom_dislike_reason: "回答完全错误",
            },
          },
        }),
      });

      const result = processCardCallback(data);
      expect(result.dislikeReasons).toEqual([]);
      expect(result.customDislikeReason).toBe("回答完全错误");
    });
  });

  // ----- 解析失败 -----

  describe("解析失败处理", () => {
    it("非 JSON 数据返回 { success: false }", () => {
      const result = processCardCallback("not-json-data");
      expect(result.parseFailed).toBe(true);
      expect(result.actionType).toBe("parse_error");
      expect(result.response).toEqual({ success: false });
    });

    it("content 字段非 JSON 不影响处理", () => {
      const data = JSON.stringify({
        outTrackId: "card_parse_1",
        userId: "user10",
        content: "invalid-json-content",
      });

      const result = processCardCallback(data);
      // content 解析失败降级为空对象，actionIds 为空
      expect(result.parseFailed).toBe(false);
      expect(result.actionType).toBe("unknown");
    });
  });
});
