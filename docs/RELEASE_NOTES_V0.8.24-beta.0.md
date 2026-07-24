# Release Notes - v0.8.24-beta.0

> **社区验证版本** — 计划经过 ~1 周社区验证后晋升为正式版 `v0.8.24`。
> **Community validation release** — planned to promote to GA `v0.8.24` after ~1 week of community validation.

## 🎉 本次重点 / Highlights

本版本新增钉钉 AI Card 的创建与更新 gateway 能力，方便外部 OpenClaw tool/plugin 复用 connector 已有的 AI Card 生命周期管理：

1. 新增 `dingtalk-connector.card.create` / `dingtalk-connector.card.update` 两个 gateway method，外部 tool/plugin 可直接创建和更新钉钉 AI Card（[#603](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/603)）
2. 新增同进程 card bridge，同一 OpenClaw 运行时内的其他 plugin/tool 可直接复用 AI Card 能力
3. 后续优化：cleanup timer 延迟初始化、overflow eviction 改批量删除、裸 cid target 收紧为显式正则、错误判定改 `PublicError` class（[#611](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/611) / [#612](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/612)）

This release adds DingTalk AI Card create/update gateway capabilities for external OpenClaw tool/plugin reuse:

1. Two new gateway methods `dingtalk-connector.card.create` / `dingtalk-connector.card.update` for external tools to create and update DingTalk AI Cards (#603)
2. In-process card bridge so plugins within the same OpenClaw runtime can directly reuse AI Card lifecycle management
3. Follow-up optimizations: lazy cleanup timer init, batch overflow eviction, strict cid target regex, `PublicError` class for error discrimination (#611 / #612)

## ✨ 新增能力 / New Features

### AI Card Gateway Methods ([#603](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/603))

新增两个 gateway method，暴露钉钉 AI Card 的创建与更新能力。

#### `dingtalk-connector.card.create`

创建一张钉钉 AI Card，支持参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `target` | string | 投放目标：`user:<userId>` / `group:<openConversationId>` / `cid...` |
| `accountId` | string? | 可选，指定钉钉账号 |
| `markdown` | string? | 可选，初始卡片内容 |

返回 `cardInstanceId`、`accountId`、`target`。

#### `dingtalk-connector.card.update`

更新或结束一张已创建的 AI Card，支持参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `cardInstanceId` | string | 必填，卡片实例 ID |
| `markdown` | string | 卡片内容 |
| `status` | string | `running`（流式更新）/ `completed`（完成）/ `failed`（失败态结束）|

### 同进程 Card Bridge

同一 OpenClaw 运行时内的 plugin/tool 可通过 `DingtalkCardBridge` 直接调用 AI Card 能力，无需走 gateway RPC。通过 `Symbol.for("@dingtalk-connector/card-bridge")` 获取 bridge 实例。

## 🔧 优化 / Optimizations ([#611](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/611) / [#612](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/612))

- **cleanup timer 延迟初始化** — 从模块顶层移入 `installDingtalkCardBridge()`，仅 import 不再启动定时器
- **overflow eviction 改单次排序** — `evictOverflowCards()` 从循环扫描淘汰改为一次排序后批量删除，消除 O(n²) 最差情况
- **裸 cid target 收紧** — `raw.startsWith("cid")` 改为显式正则 pattern，避免误匹配 `cidxxx` 等非法值
- **PublicError class** — 对外可见错误从字符串前缀匹配改为 `PublicError` class + `instanceof` 判断，文案修改不会静默降级
- **错误处理测试** — 补充 `card.create` 错误处理测试，确保公开错误原样返回、内部错误对调用方脱敏

## 🔒 兼容性 / Compatibility

- 新增 gateway method 为纯增量能力，**不影响现有回复链路和 AI Card 行为**
- 现有 API / 配置 schema / 导出符号无破坏性变化
- 升级无需任何配置改动

## 📦 升级方式 / How to upgrade

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.24-beta.0
openclaw gateway restart
```

或者 / or:

```bash
npm install @dingtalk-real-ai/dingtalk-connector@0.8.24-beta.0
```

## ⏭️ 后续节奏 / Next steps

- **2026-06-26 ~ 2026-07-03**：社区使用反馈窗口（~1 周观察期）
- **～2026-07-03 之后**：若无回归即晋升为正式版 `v0.8.24`
- 升级遇到问题请提交到 [Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)

## 涉及文件 / Files changed

| 文件 | 改动 |
|---|---|
| `src/services/card-bridge.ts` | 新增 card bridge + gateway methods + follow-up 优化 |
| `index.ts` | 注册 card bridge 和 card gateway methods |
| `entry-bundled.ts` | bundled 入口同步注册 |
| `tests/gateway-methods.unit.test.ts` | 补充注册、参数校验和错误处理测试 |

## 致谢 / Credits

感谢 [@hugtale](https://github.com/hugtale) 贡献 AI Card gateway 能力（[#603](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/603)、[#612](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/612)）。
