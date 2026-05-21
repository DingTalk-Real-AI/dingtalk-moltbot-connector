# Release Notes - v0.8.22-beta.0

> **社区验证版本** — 计划经过 ~2-3 天社区验证后晋升为正式版 `v0.8.22`。
> **Community validation release** — planned to promote to GA `v0.8.22` after ~2-3 days of community validation.

## 🎉 本次重点 / Highlights

本版本聚焦 UX 文案与 dws onboarding 体验：

1. 把单聊空回复兜底文案 `✅ 任务执行完成（无文本输出）` 换成口语化确认语 `好的 👌 有其他问题随时找我`，避免被用户误判为报错（#599）
2. dws CLI 内置版本从 `1.0.13` 升到 npm 最新 `1.0.30`，新装用户拿到正确的 `dws auth login --help` 文案
3. onboarding 检测 SSH / 无头环境（`SSH_CLIENT` / `SSH_TTY` / `SSH_CONNECTION`），自动建议 `dws auth login --device`，避免 127.0.0.1 loopback 在远端无浏览器服务器上挂起（#565）

This release focuses on UX copy + dws onboarding experience:

1. Replace direct-chat empty-reply fallback `✅ 任务执行完成（无文本输出）` with conversational confirmation `好的 👌 有其他问题随时找我`, so users no longer mistake it for an error (#599)
2. Bump pinned dws CLI from `1.0.13` to npm latest `1.0.30`; new installs get the corrected `dws auth login --help` copy
3. Detect SSH / headless env in onboarding and auto-suggest `dws auth login --device`, avoiding 127.0.0.1 loopback hangs on remote headless servers (#565)

## ✨ 改进 / Improvements

### 单聊空回复 UX 文案优化 (#599 / #601)

**现象**：用户对一段说明回「知道了」后，机器人显示 `✅ 任务执行完成（无文本输出）`，被误判为报错。

**根因**：私聊场景下模型可能因 ACK 类输入选择沉默（只走 thinking / tool_call、或纯输出空文本）。connector 的空回复兜底文案系统/技术味偏重，让用户以为是异常。

**改动**：

- `src/utils/empty-reply.ts:23` — `DIRECT_FALLBACK_TEXT` 改为 `好的 👌 有其他问题随时找我`，保留"本轮已结束"信号但去掉技术味
- 测试改成语义契约（不绑死字符串）：不出现报错感字样 / 以「好」开头 / 包含追问引导 / 与群聊文案不同
- 群聊兜底文案与日志 hint 维持不变（仍是面向运维的可操作指引）

**Phenomenon**: After replying "知道了" (got it) to a bot's explanation, users saw `✅ 任务执行完成（无文本输出）` and mistook it for an error.

**Root cause**: In direct chat, models may choose to stay silent on ACK-style input (only thinking / tool_call, or empty text output). The connector's fallback copy was too system-y, leading users to misjudge it as a fault.

**Changes**:

- `src/utils/empty-reply.ts:23` — `DIRECT_FALLBACK_TEXT` becomes `好的 👌 有其他问题随时找我`, keeping the "turn ended" signal while dropping the system flavor
- Tests refactored to semantic contracts (no hardcoded strings): no error-flavored words / starts with 「好」 / contains a follow-up invitation / differs from group fallback
- Group-chat fallback copy and log hint unchanged (still actionable ops guidance)

### dws onboarding SSH 兼容 + 版本升级 (#565 / #598)

**现象**：SSH / 无头服务器上首次 `dws auth login` 卡死——dws CLI 默认走 127.0.0.1 loopback 回调，本地浏览器无法访问远端 loopback。

**根因**：connector pin 的 dws 是 `1.0.13`，此版本 `--help` 文案描述与实际行为相反，SSH 用户照着 help 跑必然踩坑。

**改动**：

- `bin/dingtalk-connector.js:401` — `DWS_NPM_PACKAGE` 从 `1.0.13` → `1.0.30`（npm latest，含上游 dws #226 文档修复）
- 新增 `isSshSession()`：检测 `SSH_CLIENT` / `SSH_TTY` / `SSH_CONNECTION` 三个环境变量
- 新增 `printDwsLoginHint()` 辅助：SSH 命中时把 `dws auth login` 换成 `dws auth login --device`，并附一句说明
- 把"已安装/全新安装"两条路径的登录提示统一走 `printDwsLoginHint()`，避免分叉

**根治方向（跨仓 follow-up）**：

- [dws #327](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues/327) — 建议 dws 自身检测 SSH 环境自动降级到 `--device`，根治后 connector 这边的兜底逻辑可以择机删除
- 「对话框内授权」是更大的跨仓 UX 改造，需要 dws 支持非 CLI 流程或 Web flow，本版本不涉及

**Phenomenon**: First-time `dws auth login` hangs on SSH / headless servers — the dws CLI defaults to a 127.0.0.1 loopback callback that the local browser can't reach.

**Root cause**: connector pinned dws `1.0.13` whose `--help` text described the opposite of actual behavior; SSH users following the help inevitably hit the trap.

**Changes**:

- `bin/dingtalk-connector.js:401` — `DWS_NPM_PACKAGE` from `1.0.13` → `1.0.30` (npm latest, including upstream dws #226 docs fix)
- Add `isSshSession()`: detects `SSH_CLIENT` / `SSH_TTY` / `SSH_CONNECTION` env vars
- Add `printDwsLoginHint()` helper: when SSH is detected, suggest `dws auth login --device` with a brief reason
- Unify login hint between "already installed" and "fresh install" branches via `printDwsLoginHint()` to avoid drift

**Long-term root fix (cross-repo follow-up)**:

- [dws #327](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues/327) — propose dws itself detect SSH and auto-fall back to `--device`. Once that lands, the connector-side workaround can be removed.
- "In-chat authorization" is a larger cross-repo UX overhaul (needs dws to support non-CLI / Web flow); not in scope for this release.

## 🧪 验证 / Validation

- `tests/empty-reply.unit.test.ts` — 9/9 单测通过（语义契约风格）
- `node --check bin/dingtalk-connector.js` — 语法通过
- 手动验证：设置 `SSH_CLIENT` 环境变量后，onboarding 提示自动切到 `dws auth login --device`

## 📦 升级方式 / How to upgrade

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.22-beta.0
openclaw gateway restart
```

或者：

```bash
npm install -g @dingtalk-real-ai/dingtalk-connector@0.8.22-beta.0
```

## ⏭️ 后续节奏 / Next steps

- **2026-05-22 ~ 2026-05-24**：社区使用反馈窗口，2-3 天观察期
- **～2026-05-24 之后**：若无回归，晋升为正式版 `v0.8.22`
- 升级遇到问题请提交到 [Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)，按置顶 [#584](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/584) / [#585](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/585) 的模板补全反馈信息

## 🔗 关联 / References

- Issue [#599](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/599) → PR [#601](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/601)
- Issue [#565](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/565) → PR [#598](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/598)
- 跨仓 follow-up: [dws #327](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues/327)
