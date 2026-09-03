# Release Notes - v0.8.26

> **OpenClaw 2 正式版** — 本版本完成钉钉 Connector 对 OpenClaw `2026.8.1+` 的正式适配，并将 npm `latest` 从 `0.8.25` 升级到 `0.8.26`。
> **OpenClaw 2 GA release** — This release completes the DingTalk Connector adaptation for OpenClaw `2026.8.1+` and advances npm `latest` from `0.8.25` to `0.8.26`.

## 主要变化 / Highlights

### OpenClaw 2 Plugin SDK 与密钥契约 ([#656](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/656))

- 迁移到 OpenClaw 当前公开的细分 Plugin SDK 入口和 Host 配置快照。
- 使用缓冲回复调度器和 Channel Secret Contract，支持 OpenClaw 2 `SecretRef`。
- 最低宿主版本调整为 OpenClaw `2026.8.1`。

### Host 队列与 interrupt ([#653](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/653) / [#660](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/660))

- 排队和 interrupt 语义由 OpenClaw Host 统一管理。
- 使用 Host 注入的低层 Channel 派发入口，避免控制消息被 Connector 本地队列或旧回合阻塞。
- 并发消息处理期间保持 DingTalk Stream 连接生命周期。

### Host Agent 路由 ([#657](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/657))

- 消息准入后统一通过 Host `resolveAgentRoute` 解析 Agent。
- 将最终 Agent、workspace 与 SessionKey 一致传递到派发路径。
- 显式多 Agent 配置不再错误回退到硬编码的 `main`；单 Agent 默认路由无需额外 binding。

## 修复 / Fixes

### Windows 插件加载与 Runtime 共享 ([#662](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/662) / [#664](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/664))

- 插件入口使用 Host 注入的 `api.source`，不再执行 `import.meta`，避免 Windows jiti CJS 转换路径加载失败。
- Runtime Store 使用 `dingtalk-connector` 全局共享槽，使 cache-busted 模块实例读取同一份 Host Runtime。
- `0.8.25` 使用已移除的 `channel-runtime` SDK 入口问题也已随当前 SDK 迁移修复（[#663](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/663)）。

### 图片上传失败判空 ([#630](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/630) / [#652](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/652))

- DingTalk 图片上传返回空值时，不再直接解构 `mediaId` 导致异常。
- 上传成功路径与现有 Markdown 图片替换行为保持不变。

## 发布核验 / Release verification

- `0.8.26-beta.0` 已完成 OpenClaw `2026.8.1` 插件加载、15 个 Gateway Methods 注册、DingTalk Stream、主动消息与真实入站/回包闭环验证。
- `0.8.26-beta.1` 增加 Windows/OpenClaw 2 确定性兼容回归；插件入口不含可执行 `import.meta`，跨模块 Runtime Store 共享测试通过。
- 正式版基于当前 `main`，除 beta 已验证内容外仅包含 #652 的空值安全修复、对应回归测试及发布元数据。
- 构建通过；OpenClaw 2、路由、策略、Channel、回复生命周期、Gateway Methods 与媒体专项测试 91/91 通过。
- 全量测试 539 通过、11 跳过；5 个 `probe` mock 失败与 beta 精确基线一致。TypeScript 仍为相同的 21 个既有诊断，没有新增失败类型。
- 最终 npm tarball 已使用 OpenClaw `2026.8.1` 隔离安装：插件状态为 `loaded`，成功注册 DingTalk Channel 与 15 个 Gateway Methods，兼容性及诊断数组均为空，`plugins doctor` 通过。

## 安装与升级 / Installation & upgrade

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.26 --force --accept-capabilities
openclaw gateway restart
openclaw plugins doctor
```

或者 / or:

```bash
npm install @dingtalk-real-ai/dingtalk-connector@latest
```

## 相关链接 / Related links

- [PR #656 — OpenClaw 2 Plugin SDK migration](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/656)
- [PR #657 — Host agent routing](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/657)
- [PR #664 — Windows loader/runtime compatibility](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/664)
- [v0.8.26-beta.1](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/releases/tag/v0.8.26-beta.1)
- [完整变更日志 / Full changelog](../CHANGELOG.md)
