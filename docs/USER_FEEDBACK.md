# feat: 支持自定义 AI 卡片模板 & 用户反馈记录到 Session

## Summary

- 支持自定义钉钉 AI 卡片模板，通过配置项指定 `cardTemplateId`、`cardTemplateKey` 替换内置模板，使不同业务场景可以使用各自的卡片样式
- 新增 TOPIC_CARD Stream 回调处理器，接收用户点赞/点踩操作并更新卡片状态
- 卡片回调的 actionId 和变量名支持自定义配置（`cardLikeActionId`、`cardDislikeActionId`、`cardFeedbackStatusKey`），适配不同卡片模板的按钮定义
- 用户反馈（点赞/点踩）自动记录到 OpenClaw session JSONL 文件，供会话统计插件消费
- 单聊和群聊场景均已实测验证通过

## 变更内容

### 1. 自定义 AI 卡片模板支持（af86a20）

**问题**：之前 AI 卡片模板 ID 硬编码为 `02fcf2f4-5e02-4a85-b672-46d1f715543e.schema`，内容字段名固定为 `msgContent`，无法使用自定义卡片模板。

**方案**：新增 5 个可选配置项（均有默认值，不影响已有配置），将模板 ID、内容字段名、回调按钮 ID 全部参数化。

#### 新增配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cardTemplateId` | `string` | `02fcf2f4-...schema` | AI 卡片模板 ID |
| `cardTemplateKey` | `string` | `msgContent` | 卡片内容 Markdown 变量名 |
| `cardLikeActionId` | `string` | `ai_res_like` | 点赞按钮的回调 actionId |
| `cardDislikeActionId` | `string` | `ai_res_dislike` | 点踩按钮的回调 actionId |
| `cardFeedbackStatusKey` | `string` | `like` | 卡片中表示赞踩状态的变量名 |

配置位置：`openclaw.json` 中的 `dingtalk-connector` 插件配置。支持两种配置模式：

**单账号模式**（直接在插件顶层配置）：

```json
{
  "dingtalk-connector": {
    "clientId": "xxx",
    "clientSecret": "xxx",
    "cardTemplateId": "your-custom-template-id.schema",
    "cardTemplateKey": "content",
    "cardLikeActionId": "thumbs_up",
    "cardDislikeActionId": "thumbs_down",
    "cardFeedbackStatusKey": "feedbackStatus"
  }
}
```

**多账号模式**（在 `accounts[].config` 中配置，可按账号设置不同模板）：

```json
{
  "dingtalk-connector": {
    "accounts": [
      {
        "clientId": "xxx",
        "clientSecret": "xxx",
        "config": {
          "cardTemplateId": "your-custom-template-id.schema",
          "cardTemplateKey": "content"
        }
      }
    ]
  }
}
```

#### 代码变更

- **`src/services/messaging/card.ts`**：将硬编码的 `AI_CARD_TEMPLATE_ID` 改为 `DEFAULT_AI_CARD_TEMPLATE_ID`，`createAICardForTarget`、`streamAICard`、`finishAICard` 均从 config 读取 `cardTemplateId` 和 `cardTemplateKey`
- **`src/config/schema.ts`**：在 `DingtalkSharedConfigShape` 中新增 5 个 optional 字段
- **`openclaw.plugin.json`**：在顶层和 accounts 两处 JSON Schema 中注册新字段
- **`src/core/message-handler.ts`**：移除本文件中重复定义的 `AI_CARD_TEMPLATE_ID` 和 `AICardStatus` 常量（已统一到 `card.ts`）
- **`src/reply-dispatcher.ts`**：非 QPS 错误时保留 sendFallbackErrorMessage 兜底逻辑，确保用户始终能收到反馈

#### TOPIC_CARD 回调处理器

在 `src/core/connection.ts` 中新增 TOPIC_CARD Stream 回调监听器：

- 解析回调数据（支持 content 二次 JSON 解析）
- 从 `cardPrivateData.actionIds` 判断是点赞还是点踩
- 根据配置的 `cardLikeActionId`/`cardDislikeActionId`/`cardFeedbackStatusKey` 构造响应
- 点踩时解析 `dislike_reason` 和 `custom_dislike_reason` 参数
- 通过 `socketCallBackResponse` 响应回调（finally 块保证无论异常都响应，避免钉钉超时重试）

### 2. 用户反馈记录到 Session（c46fa86）

**问题**：用户的点赞/点踩行为仅在卡片上生效，无法在会话历史中留存，统计插件无法获取用户满意度数据。

**方案**：新增 card-session 内存映射注册表，在卡片创建时注册 `cardInstanceId → sessionKey` 映射，在回调触发时查找映射并将反馈追加到 session JSONL 文件。

#### 数据流

```
卡片创建(reply-dispatcher.ts) → registerCardSession(cardInstanceId, sessionKey)
                                         ↓ (内存 Map)
用户点赞/踩(connection.ts)    → recordFeedbackToSession(outTrackId, like, userId)
                                         ↓
                               查找 sessions.json → 定位 JSONL 文件
                                         ↓
                               appendFile → session JSONL
```

#### JSONL 条目格式

统计插件通过 `type === "custom" && customType === "user-feedback"` 过滤反馈条目。

**点赞：**

```json
{
  "type": "custom",
  "customType": "user-feedback",
  "data": {
    "like": 1,
    "userId": "194584",
    "cardInstanceId": "card_1777440689892_pwm21ymr",
    "source": "dingtalk-card"
  },
  "id": "12bbd507",
  "parentId": null,
  "timestamp": "2026-04-29T05:31:41.309Z"
}
```

**点踩（含原因）：**

```json
{
  "type": "custom",
  "customType": "user-feedback",
  "data": {
    "like": -1,
    "userId": "194584",
    "cardInstanceId": "card_1777440689892_pwm21ymr",
    "source": "dingtalk-card",
    "dislikeReasons": ["回答不准确", "太啰嗦"],
    "customDislikeReason": "没有给出具体代码"
  },
  "id": "c80d4b7c",
  "parentId": null,
  "timestamp": "2026-04-29T05:32:24.593Z"
}
```

> `like` 字段为数字类型：`1` = 点赞，`-1` = 点踩。

#### 重复反馈

用户可以反复点赞或点踩同一张卡片，每次操作追加新条目。**统计时以同一 `(cardInstanceId, userId)` 的最后一条为准**（群聊中多用户可对同一卡片独立反馈）。

#### 核心模块

- **`src/services/card-session-registry.ts`**（新增）：内存注册表（`Map<cardInstanceId, {sessionKey, agentId}>`，24h TTL + 30min 自动清理）+ `recordFeedbackToSession()` 异步写入
- **`src/reply-dispatcher.ts`**：新增 `sessionKey` 参数，在两处卡片创建路径调用 `registerCardSession()`
- **`src/core/message-handler.ts`**：将已有 `sessionKey` 变量传递给 `createDingtalkReplyDispatcher()`
- **`src/core/connection.ts`**：在 TOPIC_CARD 回调中 fire-and-forget 调用 `recordFeedbackToSession()`

## 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `openclaw.plugin.json` | 修改 | 新增 5 个卡片配置项 JSON Schema |
| `src/config/schema.ts` | 修改 | 新增 5 个 optional 配置字段 |
| `src/core/connection.ts` | 修改 | 新增 TOPIC_CARD 回调处理器 + 反馈记录调用 |
| `src/core/message-handler.ts` | 修改 | 移除重复常量 + 传递 sessionKey |
| `src/reply-dispatcher.ts` | 修改 | 支持 sessionKey 参数 + 注册卡片映射 |
| `src/services/messaging/card.ts` | 修改 | 模板 ID 和内容字段名参数化 |
| `src/services/card-session-registry.ts` | **新增** | 卡片-会话映射注册表 + 反馈写入 |
| `tests/card-feedback/card-feedback.test.ts` | **新增** | 13 个单元测试（注册表 + 反馈写入） |
| `tests/card-feedback/card-callback.test.ts` | **新增** | 11 个单元测试（TOPIC_CARD 回调解析） |
| `tests/card-feedback/card-contentkey.test.ts` | **新增** | 4 个单元测试（自定义模板 contentKey） |
| `docs/USER_FEEDBACK.md` | **新增** | 反馈功能文档（含 PR 描述 + 统计消费指南） |

## 测试

- 单元测试：28 个测试全部通过（`vitest run tests/card-feedback/`）
  - 注册/查找/覆盖
  - TTL 过期清理
  - 点赞/点踩写入验证
  - 点踩原因字段验证
  - 异常路径（空 outTrackId、未知卡片、sessions.json 不存在、sessionKey 不存在、sessionFile 已删除）
  - TOPIC_CARD 回调（actionId 解析、自定义 actionId、点踩原因、解析失败）
  - card.ts 自定义 contentKey 替换路径（默认/自定义模板的 staticMsgContent 写入行为）
- 集成测试：
  - 单聊（admin agent）：点赞/点踩反馈正确记录到 session JSONL
  - 群聊（main agent）：点赞/点踩反馈正确记录到 session JSONL
- 构建：`npx tsdown` 通过

## 注意事项

- 所有新增配置项均为 optional 且有默认值，**完全向后兼容**，不影响使用内置模板的已有部署
- 内存映射表在进程重启后清空，重启前创建的卡片如收到反馈将无法定位 session（日志输出 warn 提示）
- 反馈写入为 fire-and-forget 异步操作，不阻塞卡片回调响应

## 重要约束与已知限制

### OpenClaw Session JSONL 直写耦合

反馈写入功能通过 `appendFile` 直接写入 `~/.openclaw/agents/{agentId}/sessions/*.jsonl`，这是插件对 OpenClaw 私有目录的约定写入：

- **目录约定**：依赖 `~/.openclaw/agents/{agentId}/sessions/sessions.json` 的存在和 schema
- **文件格式约定**：追加的每行为符合 OpenClaw session JSONL schema 的 JSON 对象（`type: "custom"`, `customType: "user-feedback"`）
- **并发安全**：反馈写入通常发生在会话活跃期结束后（用户先看到回复再点赞/踩），与 OpenClaw session writer 并发冲突概率极低，但快速连点场景下理论上存在竞争
- **中期计划**：OpenClaw 提供 custom-event API 后将切换为标准 API 调用，解除直写耦合

### 24h TTL 限制

卡片注册表（`cardSessionMap`）使用 24 小时 TTL，超过 24h 的卡片映射会被自动清理。这意味着：

- **机器人重启后**的反馈不会落库（内存 Map 清空）
- **卡片超过 24h 后**的反馈不会落库（映射已过期清理）
- 上述场景下日志会输出 warn 提示，但不影响卡片本身的赞踩动画效果
