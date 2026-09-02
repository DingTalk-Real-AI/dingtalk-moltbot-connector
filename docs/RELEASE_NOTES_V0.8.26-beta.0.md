# Release Notes - v0.8.26-beta.0

> **社区验证版本** — 本版本完成钉钉 Connector 对 OpenClaw 2.0 稳定版的适配，发布到 npm `beta` 标签，不会改变 `latest`（仍为 `0.8.25`）。
> **Community validation release** — This release adapts the DingTalk Connector to the stable OpenClaw 2.0 runtime. It is published under npm's `beta` tag and does not change `latest` (which remains `0.8.25`).

## 主要变化 / Highlights

### OpenClaw 2 Plugin SDK 与密钥契约 ([#656](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/656))

- 迁移到当前 Plugin SDK 与 Host 配置快照。
- 使用缓冲回复调度器和 Channel Secret Contract，兼容 OpenClaw 2 的 `SecretRef`。
- 最低宿主版本调整为 OpenClaw `2026.8.1`。

### Host 队列与 interrupt ([#653](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/653))

- 移除 Connector 自己的会话队列，由 OpenClaw Host 统一处理排队和 interrupt。
- 暂停、中断等控制消息不再被 Connector 队列阻塞。
- 并发消息处理期间保持 DingTalk Stream 连接生命周期。

### Host Agent 路由 ([#657](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/657))

- 消息准入后通过 OpenClaw `resolveAgentRoute` 解析一次 Agent。
- 将最终 Agent、workspace 与 SessionKey 一致地传递到派发路径。
- 多 Agent 配置不再错误回退到硬编码的 `main`。
- 保留钉钉账号大小写、群聊发送者隔离与共享记忆等既有 Session 投影语义。

## 验证 / Verification

- 在 OpenClaw `2026.8.1` 上完成构建、插件加载和真实 npm 打包安装验证。
- 插件成功注册 DingTalk Channel 与 15 个 Gateway Methods，兼容性和诊断结果为空。
- 路由、策略、连接专项测试 26/26 通过；全量测试 535 通过、11 跳过。
- 5 个 `probe` 单测失败与合入前基线一致，本版本没有新增失败。
- 使用测试组织凭据完成 access-token 探测、DingTalk Stream 启动及主动消息发送；发布前以新的钉钉回复完成入站与自动回复闭环验证。

## 安装与反馈 / Install and feedback

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.26-beta.0
openclaw gateway restart
```

遇到问题请在 [Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues) 报告，并附上 Connector、OpenClaw 版本及脱敏日志。

## 后续节奏 / Next steps

观察 beta 的 Stream、AI Card、interrupt 和多 Agent 路由表现；没有阻塞回归后，再以相同功能集晋升为 `0.8.26` 正式版。

## 相关链接 / Related links

- [PR #656](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/656)
- [PR #653](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/653)
- [PR #657](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/657)
- [完整变更日志 / Full changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
