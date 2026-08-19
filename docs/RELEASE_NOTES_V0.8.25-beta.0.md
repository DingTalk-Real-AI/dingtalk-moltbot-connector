# Release Notes - v0.8.25-beta.0

> **社区验证版本** — 本版本聚焦 AI Card 异常收口可靠性，先发布到 npm `beta` 标签，不会替换稳定用户使用的 `latest`（`0.8.24`）。计划在社区验证完成后，以完全相同的源码晋升为正式版 `v0.8.25`。
> **Community validation release** — This release focuses on reliable AI Card completion. It is published under npm's `beta` tag and does not replace the stable `latest` (`0.8.24`). After community validation, the exact same source will be promoted to GA `v0.8.25`.

## 🎯 修复的问题 / What is fixed

当上游没有按预期发送 `final` 或 `settle`，或者回合在创建卡片期间发生 error/hang 时，AI Card 过去可能保持在输入中，或在极端竞态下被重复结束。本版本修复这些生命周期窗口。

When upstream omits `final` or `settle`, or a turn errors/hangs while a card is being created, an AI Card could previously remain in its input state or, in edge races, be finalized twice. This release closes those lifecycle windows.

## 🐛 修复详情 / Fixes

### AI Card 生命周期收口 ([#644](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/644) / [#647](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/647))

- `closeStreaming()` 会等待在途卡片创建完成后再取快照并收口，消除创建与收口的竞态。
- `onIdle` 与 `onError` 会先密封流式入口；迟到的回调不会再生成没有关闭方的孤儿卡片。
- 新增默认 10 分钟的卡片 watchdog；上游挂死或永不 settle 时，卡片会被强制结束并密封。
- 用单飞保护统一 watchdog 与正常收口路径，确保同一张卡只会调用一次 `finishAICard`。
- 所有 `startStreaming` 早返回路径都会释放创建 promise gate，避免后续回合误复用已完成的 promise。
- 收口时会调用可选的 `markRunComplete`，对齐较新的 OpenClaw channel 生命周期契约，同时保持旧版兼容。

## 🧪 验证 / Verification

- 覆盖回复分发器与 AI Card 的回归测试：error 收口密封、watchdog 与正常收口并发、早返回 promise 清理、快速 settle 等场景。
- 发布前会执行 TypeScript 类型检查、全部 Vitest 测试、构建与 npm 打包产物检查。
- 尚未进行真实钉钉环境的端到端验证；因此本版本先作为 beta 发布。

## 📦 安装与反馈 / Install and feedback

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.25-beta.0
openclaw gateway restart
```

遇到问题请在 [Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues) 报告，并附上 connector 与 OpenClaw 版本、场景、以及脱敏后的相关日志。

## ⏭️ 后续节奏 / Next steps

1. 由受影响场景的用户安装 beta，验证错误、长任务和上游无 final/settle 时卡片都能正常结束。
2. 观察期内无阻塞回归后，将不改源码地把版本晋升为 `0.8.25`，并把 npm `latest` 指向正式版。

## 🔗 相关链接 / Related links

- [PR #647](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/647)
- [Issue #644](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/644)
- [完整变更日志 / Full changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
