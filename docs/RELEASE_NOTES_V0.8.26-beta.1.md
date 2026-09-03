# Release Notes - v0.8.26-beta.1

> **Windows 兼容性验证版本** — 本版本修复 OpenClaw `2026.8.1` 在 Windows jiti 加载路径中的插件入口解析和 Runtime 共享问题，发布到 npm `beta` 标签，不会改变 `latest`（仍为 `0.8.25`）。
> **Windows compatibility validation release** — This release fixes plugin-entry parsing and runtime sharing on the Windows jiti loader path in OpenClaw `2026.8.1`. It is published under npm's `beta` tag and does not change `latest` (which remains `0.8.25`).

## 修复 / Fixes

### Windows 插件入口加载 ([#662](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/662) / [#664](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/664))

- 重复加载检测改用 OpenClaw Host 注入的 `api.source`，并以 `api.rootDir` 兜底。
- 插件入口不再执行 `import.meta`，避免 Windows jiti CJS 转换路径抛出 `Cannot use 'import.meta' outside a module`。

### 跨模块 Runtime 共享

- Runtime Store 改用带 `pluginId: "dingtalk-connector"` 的全局共享槽。
- cache-busted 模块实例现在能够读取 `register()` 注入的同一份 Host Runtime，不再错误抛出 `DingTalk runtime not initialized`。

### 单 Agent 路由说明

- 使用 OpenClaw `2026.8.1` 的真实 `resolveAgentRoute` 验证：仅配置 `agents.entries.main` 时，会通过默认路由命中 `main`，无需额外添加 DingTalk binding。
- 多 Agent 场景仍可使用 binding 显式选择 Agent。

## 验证 / Verification

- 新增兼容性回归在修复前复现 2 个失败，修复后 3/3 通过。
- 路由、策略、Channel 与 Windows 兼容性专项测试 33/33 通过。
- 构建通过，发布入口 `dist/index.mjs` 不含 `import.meta`。
- 全量测试 538 通过、11 跳过；5 个 `probe` 失败与精确合入前基线一致，没有新增失败。
- TypeScript 诊断与精确基线均为 21 个，没有新增诊断。
- 使用 Node `22.22.3` 与 OpenClaw `2026.8.1` 完成隔离打包安装；插件成功加载并注册 Channel，兼容性和诊断结果为空。
- Windows 10 的真实 jiti 链路仍等待 Issue 报告者确认，因此本版本继续使用 `beta` 标签。

## 安装与反馈 / Install and feedback

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.26-beta.1 --force --accept-capabilities
openclaw gateway restart
```

遇到问题请在 [#662](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/662) 回复 Connector、OpenClaw 和 Node 版本，并附上脱敏日志。

## 后续节奏 / Next steps

等待 Windows 社区验证插件加载和真实消息闭环；确认没有阻塞回归后，再评估晋升为 `0.8.26` 正式版。

## 相关链接 / Related links

- [Issue #662](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/662)
- [PR #664](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/664)
- [v0.8.26-beta.0 Release Notes](RELEASE_NOTES_V0.8.26-beta.0.md)
- [完整变更日志 / Full changelog](../CHANGELOG.md)
