# Release Notes - v0.8.25

> **GA 正式版** — 晋升自 `0.8.25-beta.0`。源码与 beta 完全一致；此正式版将 npm `latest` 从 `0.8.24` 升级到 `0.8.25`。
> **General Availability** — Promoted from `0.8.25-beta.0` with identical source code. This release advances npm `latest` from `0.8.24` to `0.8.25`.

## 🎯 本次重点 / Highlights

本版本提升 AI Card 在异常、上游缺失 `final` / `settle`、以及上游挂死场景下的生命周期可靠性：卡片会被正确收口，迟到回调不会生成无人关闭的孤儿卡片。

This release improves AI Card lifecycle reliability during errors, missing upstream `final` / `settle` callbacks, and upstream hangs: cards are finalized correctly and late callbacks cannot create orphan cards without a closer.

## 🐛 修复详情 / Fixes

### AI Card 生命周期收口 ([#644](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/644) / [#647](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/647))

- `closeStreaming()` 会等待在途卡片创建完成后再收口，消除创建与收口的竞态。
- `onIdle` 与 `onError` 会先密封流式入口；迟到回调不再创建没有关闭方的卡片。
- 默认 10 分钟 watchdog 覆盖上游挂死或永不 settle 的场景。
- watchdog 与正常收口统一使用单飞保护，确保同一张卡只会调用一次 `finishAICard`。
- `startStreaming` 的早返回路径都会释放创建 promise gate，避免后续回合误复用已完成的 promise。
- 可选调用 `markRunComplete`，对齐较新的 OpenClaw channel 生命周期契约，同时保持旧版兼容。

## 🧪 发布核验 / Release verification

- 正式版源码与 `v0.8.25-beta.0` 完全一致；仅更新版本、CHANGELOG 和本 Release Notes。
- 发布包在 Node 22 下重新构建并核验：包含 `dist/index.mjs`、类型声明、插件元数据和本 Release Notes，且不包含开发依赖。
- 仓库当前 TypeScript 报错和 Vitest/esbuild 启动失败均已与 `v0.8.24` 对比，属于既有基线，不是本版本引入的回归。

## 📦 安装升级 / Installation & upgrade

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.25
openclaw gateway restart
```

或者 / or:

```bash
npm install @dingtalk-real-ai/dingtalk-connector@latest
```

## 🔗 相关链接 / Related links

- [PR #647](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/647)
- [Issue #644](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/644)
- [Beta release `v0.8.25-beta.0`](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/releases/tag/v0.8.25-beta.0)
- [完整变更日志 / Full changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
