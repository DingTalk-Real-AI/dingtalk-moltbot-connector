# Release Notes - v0.8.23 / v0.8.22

> **v0.8.23 为 v0.8.22 的重新发布包**（[#609](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/609)），功能与 `0.8.22` 完全一致，推荐直接安装 `0.8.23`。
> **v0.8.23 is a republish of v0.8.22** ([#609](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/609)), functionally identical to `0.8.22`; please install `0.8.23`.

## 🎉 本次重点 / Highlights

本版本聚焦 UX 文案与 dws onboarding 体验，与 `0.8.22-beta.0` 功能完全一致：

1. 把单聊空回复兜底文案 `✅ 任务执行完成（无文本输出）` 换成口语化的 `好的 👌 有其他问题随时找我`，避免被用户误判为报错（[#599](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/599) / [PR #601](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/601)）
2. 内置 dws CLI 从 `1.0.13` 升到 npm 最新 `1.0.30`，新装用户拿到正确的 `dws auth login --help` 文案
3. onboarding 检测 SSH / 无头环境（`SSH_CLIENT` / `SSH_TTY` / `SSH_CONNECTION`），自动建议 `dws auth login --device`，避免 127.0.0.1 loopback 在远端无浏览器服务器上挂起（[#565](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/565) / [PR #598](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/598)）

This release focuses on UX copy + dws onboarding experience. Functionally identical to `0.8.22-beta.0`:

1. Replace direct-chat empty-reply fallback `✅ 任务执行完成（无文本输出）` with conversational `好的 👌 有其他问题随时找我`, so users no longer mistake it for an error (#599 / PR #601)
2. Bump bundled dws CLI from `1.0.13` to npm latest `1.0.30`; new installs get the corrected `dws auth login --help` copy
3. Detect SSH / headless env in onboarding and auto-suggest `dws auth login --device`, avoiding 127.0.0.1 loopback hangs on remote headless servers (#565 / PR #598)

## ✨ 改进 / Improvements

### 单聊空回复 UX 文案优化 ([#599](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/599) / [PR #601](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/601))

**现象**：用户对一段说明回「知道了」后，机器人显示 `✅ 任务执行完成（无文本输出）`，被误判为报错。

**根因**：私聊场景下模型可能因 ACK 类输入选择沉默（只走 thinking / tool_call、或纯输出空文本）。connector 的空回复兜底文案系统/技术味偏重。

**改动**：

- `src/utils/empty-reply.ts:23` — `DIRECT_FALLBACK_TEXT` 改为 `好的 👌 有其他问题随时找我`，保留"本轮已结束"信号但去掉技术味
- 测试改成语义契约（不绑死字符串）：不出现报错感字样 / 以「好」开头 / 包含追问引导 / 与群聊文案不同
- 群聊兜底文案与日志 hint 维持不变（仍是面向运维的可操作指引）

### dws onboarding SSH 兼容 + 版本升级 ([#565](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/565) / [PR #598](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/598))

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

## 🔒 兼容性 / Compatibility

- **API 无变化**、配置 schema 无变化、导出符号无变化
- 现有用户升级无需任何配置改动
- 群聊行为完全不变（空回复兜底文案与日志 hint 未动）
- 仅以下两类用户感知到差异：
  - 私聊场景看到空回复兜底文案的用户 —— 文案更友好
  - 全新安装 / 在 SSH 环境首次 `dws auth login` 的用户 —— 自动得到正确命令建议

## 🧪 验证 / Verification

**Beta 社区验证（2026-05-21 ~ 2026-05-24，~3 天）**：
- npm `beta` tag 上 `0.8.22-beta.0` 稳定可用
- 无任何针对私聊空回复文案 / dws SSH onboarding 的回归 issue

**已验证组合 / Verified combo**：
- OpenClaw Gateway `2026.5.12` (f066dd2)
- Connector `0.8.22-beta.0`（已晋升为 `0.8.22`）
- 平台 macOS（darwin 23.2.0）

## 📥 安装升级 / Installation & Upgrade

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.23
openclaw gateway restart
```

或：

```bash
npm install @dingtalk-real-ai/dingtalk-connector@latest
```

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [Beta release notes (`v0.8.22-beta.0`)](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/docs/RELEASE_NOTES_V0.8.22-beta.0.md)
- 关联 PRs / issues：[#599](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/599) / [#601](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/601) / [#565](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/565) / [#598](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/598) / [#609](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/609) / [dws #327](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues/327)

---

**v0.8.23 发布日期 / Release Date**：2026-05-26
**v0.8.22 发布日期 / Release Date**：2026-05-24
**当前推荐版本 / Recommended Version**：v0.8.23
**兼容性 / Compatibility**：OpenClaw Gateway 2026.5.7+
