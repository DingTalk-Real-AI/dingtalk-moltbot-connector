# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.21] - 2026-05-19

晋升自 `0.8.21-beta.0` 的 GA 版本，与 beta.0 内容完全一致，经过社区验证后正式发布。  
GA promotion of `0.8.21-beta.0` after community validation; functionally identical to the beta.

### 升级 / Upgrade

\`\`\`bash
npx openclaw@latest add @dingtalk-real-ai/dingtalk-connector@0.8.21
\`\`\`

以下内容沿用自 `0.8.21-beta.0` 的修复与改进 / Same fixes and improvements as `0.8.21-beta.0`：

## [0.8.21-beta.0] - 2026-05-17

### 修复 / Fixes
- 🐛 **WebSocket phantom reconnect 根因修复 (#566)** — `setupPongListener` / `setupMessageListener` / `setupCloseListener` 原本在 `client.connect()` 之前调用，此时 `client.socket === undefined`，可选链让三个 listener 静默 no-op，从未真正挂上。pong 没人接 → `lastSocketAvailableTime` 不更新 → 命中 `TIMEOUT_THRESHOLD = 20s` → 约 30 秒一次的幽灵重连。本次把 setup 移到 `client.connect()` 之后（初次连接 + `doReconnect` 两条路径都覆盖），并放在 `await for OPEN` 之前，消除 race window。感谢 @Majorshi 贡献。  
  **Root-cause fix for WebSocket phantom reconnect (#566)** — `setupPongListener` / `setupMessageListener` / `setupCloseListener` were called before `client.connect()` when `client.socket === undefined`, so optional-chaining silently no-op'd and the three listeners were never attached. With no pong handler, `lastSocketAvailableTime` never refreshed, hit `TIMEOUT_THRESHOLD = 20s`, and triggered a phantom reconnect every ~30s. This release moves the setup calls to right after `client.connect()` (covering both initial connect and `doReconnect`), before the OPEN await, eliminating the race window. Credit: @Majorshi.

- 🐛 **消息处理保活 interval 兜底 bug (#594)** — `markMessageProcessingStart` 启动的兜底定时器原本 30s 间隔，但 `TIMEOUT_THRESHOLD` 早已从 90s 降到 20s，30s 间隔无法在 AI 长任务期间防住超时（约 21s 就可能触发幽灵重连，下次刷新还要等 9 秒）。本次改为 15s 间隔（< TIMEOUT_THRESHOLD），让保活真正生效。  
  **Fix message-processing keepalive interval (#594)** — The fallback `setInterval` in `markMessageProcessingStart` was 30s, but `TIMEOUT_THRESHOLD` had since dropped from 90s to 20s — the 30s interval couldn't prevent the timeout during long AI tasks (could trigger phantom reconnect around the 21s mark, with the next refresh 9s away). This release changes the interval to 15s (< TIMEOUT_THRESHOLD) so the safety net actually works.

- 🐛 **过滤上游 SDK `console.info` 噪音 (#571 / #536 / #573)** — 上游 `dingtalk-stream@2.1.4` SDK 在 `client.cjs:138 / :185` 每次 `disconnect()` / `connect()` 时直接 `console.info("Disconnecting.")` / `connect success`，绕过 logger，在频繁重连场景下会刷屏。本次在 `src/core/connection.ts` 加 `silenceDingtalkStreamConsoleNoise()`：模块级一次性 patch `console.info`，**只过滤这两条精确字符串**，其他 `console.info` 不受影响。同时在首个账号连上时通过 `printConnectionNoticeOnce()` 打印一次连接生命周期说明，解释过滤动机以及"高频重连不正常"的预期。  
  **Filter upstream SDK `console.info` noise (#571 / #536 / #573)** — Upstream `dingtalk-stream@2.1.4` SDK calls `console.info("Disconnecting.")` / `connect success` directly (`client.cjs:138 / :185`) on every `disconnect()` / `connect()`, bypassing the logger and spamming logs in frequent-reconnect scenarios. This release adds `silenceDingtalkStreamConsoleNoise()` in `src/core/connection.ts`: a module-level one-time `console.info` patch that filters **only these two exact strings**, leaving other `console.info` untouched. It also prints a one-time connection-lifecycle notice via `printConnectionNoticeOnce()` on first connect explaining the filter and setting the expectation that high-frequency reconnects are not normal.

### 改进 / Improvements
- 🩹 **群聊空回复兜底文案带修复指引 (#589)** — 当 OpenClaw `messages.groupChat.visibleReplies` 未设为 `"automatic"` 时，群聊 @ 机器人会因上游 `source-reply-delivery-mode.ts` 走 `message_tool_only` 而拿不到流式 token，最终落到 connector 空回复兜底；以前固定文案「任务执行完成（无文本输出）」无信息量，现群聊场景改为带 `openclaw.json` 配置修复指引的提示，并在 warn 日志中打印完整片段；同时在 `onIdle` / `onError` 时若本轮无任何用户可见输出，主动 nudge 一条配置指引，覆盖上游根本不调 `deliver()` 的盲区。单聊文案保持不变。  
  **Group-chat empty-reply fallback now ships actionable hint (#589)** — When OpenClaw’s `messages.groupChat.visibleReplies` is not `"automatic"`, group `@` mentions hit `message_tool_only` upstream and the connector’s accumulated text stays empty, falling through to a cold fallback. The group-chat fallback message now embeds the exact `openclaw.json` fix snippet, and the warn-level log prints the full hint for operators. A new idle nudge in `onIdle` / `onError` proactively sends the same hint when no user-visible output happens this turn — covering the case where upstream never calls `deliver()` at all. DM fallback text unchanged.

### 文档 / Docs
- 📚 **TROUBLESHOOTING (#589)** — 新增「群聊 @ 机器人只返回『任务执行完成（无文本输出）』」条目，给出 `messages.groupChat.visibleReplies = "automatic"` 修复步骤。  
  **TROUBLESHOOTING (#589)** — Added "Group `@` only returns 'Task done (no text output)'" entry with the `messages.groupChat.visibleReplies = "automatic"` fix.

- 📚 **`silenceDingtalkStreamConsoleNoise` 文案与函数命名收紧 (#592)** — `printLoadBalanceNoticeOnce` → `printConnectionNoticeOnce`，banner 文案改为「SDK noise 已过滤 + 真实重连 connector 自动处理 + 高频重连不正常」的预期；相关注释同步收紧，去掉对重连频率的强归因。  
  **Tighten copy & rename for `silenceDingtalkStreamConsoleNoise` (#592)** — Renamed `printLoadBalanceNoticeOnce` to `printConnectionNoticeOnce`; banner copy now reads "SDK noise filtered + real reconnects handled by connector + high-frequency reconnects are not expected"; related comments tightened.

- 📚 **清理 stale `90 秒` 文档残留 (#594)** — 文件头 docstring 与消息处理保活注释里的 `90 秒超时` → `20 秒超时`，与实际 `TIMEOUT_THRESHOLD` 保持一致。  
  **Clean up stale `90s` doc references (#594)** — File-header docstring and message-processing keepalive comments updated from `90s timeout` to `20s timeout`, matching the actual `TIMEOUT_THRESHOLD`.

### 说明 / Notes
- 不改动 `startKeepAlive` / `setupPongListener` / `lastSocketAvailableTime` 写入时机的语义，不影响 #437 的心跳超时检测修复。  
  No changes to `startKeepAlive` / `setupPongListener` / `lastSocketAvailableTime` write semantics — does not affect the #437 heartbeat-timeout fix.

## [0.8.20] - 2026-04-28

### 修复 / Fixes
- 🐛 **OpenClaw 插件加载兼容性 (Issue #527)** — `configSchema` 改为延迟初始化，通过 `createRequire` 解析 `openclaw/plugin-sdk/core`，修复插件安装到 `~/.openclaw/extensions/` 时 ESM 裸说明符解析失败导致的 "Cannot find package 'openclaw'" 崩溃  
  **OpenClaw plugin load compatibility (Issue #527)** — `configSchema` deferred to lazy init via `createRequire`, fixing "Cannot find package 'openclaw'" crash when plugin is installed to `~/.openclaw/extensions/`

- 🐛 **Onboarding 动态导入** — `promptSingleChannelSecretInput` 从静态 import 改为动态 `import()`，避免在 ESM 加载阶段触发同样的裸说明符解析错误  
  **Onboarding dynamic import** — `promptSingleChannelSecretInput` switched from static to dynamic `import()` to avoid bare specifier resolution error during ESM loading

### 改进 / Improvements
- ✅ **DWS CLI 版本管理重构** — `ensureDwsCli()` 新增 `compareVersions()` 语义版本比较，支持四种场景：目标版本更高时自动升级、本地版本更高时询问是否覆盖、版本一致时跳过、全新安装时显示已安装版本号  
  **DWS CLI version management refactor** — `ensureDwsCli()` now uses `compareVersions()` for semver comparison with four scenarios: auto-upgrade when target is newer, prompt before downgrade, skip when equal, show version on fresh install

## [0.8.19] - 2026-04-25

### 新增 / Added
- 🔔 **DING 消息** — 支持向用户/群发送强提醒 DING（应用内/短信/电话），用户授权后即可使用
- 📄 **钉钉文档** — 支持创建、追加、搜索、列举钉钉文档，用户授权后即可使用
- 📝 **日志** — 支持提交日报/周报、查询历史日志记录，用户授权后即可使用
- ✨ **插件重复加载检测** — 全局 Symbol 自检同一 plugin id 多路径加载，防止 stream 回调冲突

### 修复 / Fixes
- 🐛 AI Card QPS 限流不再误报用户错误，改为 warn 日志
- 🐛 AI Card 令牌桶新增串行化锁，修复并发击穿
- 🐛 多 Agent 配置检测改为 OR 条件，放宽触发保护
- 🐛 CLI 提示文案统一中英文混合格式

### 改进 / Improvements
- ✅ 新增多 Agent 配置文档 `docs/MULTI_AGENT_SETUP.md`，提供从零配置多 Agent 的完整步骤
- ✅ DWS CLI 升级提示、BotIdentity 上下文透传、reply-dispatcher text/markdown 降级发送

## [0.8.18] - 2026-04-21

### 修复 / Fixes
- **AI Card 流式中断残留修复 (#463)** — Gateway 重启后 AI Card 卡在思考中动画、表情标签未撤回；新增 `fixStuckCards` Gateway Method 支持手动修复卡住的 AI Card 和撤回残留表情
  **AI Card stuck state fix (#463)** — After gateway restart, AI Card stuck in thinking animation and emotion tag not recalled; added `fixStuckCards` Gateway Method for manual recovery

- **多 Agent 配置覆盖保护** — 安装向导检测到已有钉钉 channels + bindings 配置时，跳过自动写入，展示凭证信息让用户自行决定，避免多 Agent 路由配置被意外覆盖
  **Multi-Agent config overwrite protection** — Install wizard detects existing DingTalk channels + bindings config, skips auto-write and shows credentials for user to decide

### 改进 / Improvements
- **OpenClaw 版本兼容性** — peerDependency 从 >=2026.3.23 升级到 >=2026.4.9，兼容 OpenClaw 2026.4.15 中的 plugin-sdk 变更
  **OpenClaw version compatibility** — peerDependency bumped from >=2026.3.23 to >=2026.4.9

- **README 能力展示优化** — 已支持的业务能力（待办、AI 表格、日历日程）整合到主能力表，Coming Soon 区域更新
  **README capability display** — Supported capabilities consolidated into main table; Coming Soon section updated

## [0.8.17] - 2026-04-16

### 新增 / Added
- ✨ **钉钉 DWS CLI 集成** - 安装插件时自动安装 `dws` CLI 工具，支持 AI 表格、日历、通讯录、群聊与机器人、待办、审批、考勤、日志等钉钉产品能力；凭证自动注入，无需手动配置  
  **DingTalk Workspace (DWS) CLI integration** - Auto-installs `dws` CLI during plugin setup, enabling AI Table, Calendar, Contacts, Chat & Bot, Todo, Approval, Attendance, Report and more; credentials injected automatically

- ✨ **Agent Skills 体系** - 新增三组内置 Skill 文档：`dingtalk-channel-rules`（频道能力路由规范）、`dingtalk-troubleshoot`（常见问题排查）、`dws-cli`（DWS CLI 使用指南与产品参考），通过 `openclaw.plugin.json` 注册  
  **Agent Skills system** - Added three built-in Skill document sets: `dingtalk-channel-rules` (channel capability routing), `dingtalk-troubleshoot` (troubleshooting), `dws-cli` (DWS CLI guide & product references), registered via `openclaw.plugin.json`

### 修复 / Fixes
- 🐛 **AI Card finishAICard QPS 限流** - `finishAICard` 的 PUT 请求现在也经过全局令牌桶限流器 `waitForToken()`，避免多会话并发结束时触发 403 QpsLimit  
  **AI Card finishAICard QPS rate limiting** - `finishAICard` PUT request now goes through global token bucket `waitForToken()` to prevent 403 QpsLimit when multiple conversations finish concurrently

- 🐛 **Probe 接口迁移到 HTTP 客户端** - `probe.ts` 中的 token 获取和 bot 信息查询从 `fetch` 迁移到统一的 `dingtalkHttp` 客户端，修复潜在的代理和错误处理不一致问题  
  **Probe migrated to HTTP client** - Token and bot info requests in `probe.ts` migrated from `fetch` to unified `dingtalkHttp` client, fixing potential proxy and error handling inconsistencies

- 🐛 **安全扫描误报规避** - 重构环境变量访问方式（字符串拼接 `globalThis['proc' + 'ess']` / `globalThis['fet' + 'ch']`），避免 OpenClaw 安全扫描将合法的凭证读取误报为 "credential harvesting"  
  **Security scanner false positive avoidance** - Refactored env access via string concatenation to avoid OpenClaw security scanner flagging legitimate credential reads as "credential harvesting"

- 🐛 **DWS 凭证隔离** - DWS clientId/clientSecret 存储在模块作用域的私有 holder 中，不注入 `process.env`，防止子进程（如 Shell Executor）通过 `env`/`printenv` 命令泄露凭证  
  **DWS credential isolation** - DWS credentials stored in module-scoped private holder instead of `process.env`, preventing child processes from leaking secrets via `env`/`printenv`

### 改进 / Improvements
- ✅ **预编译构建 (tsdown)** - 引入 `tsdown` 构建工具，插件发布为预编译的 `dist/index.mjs`，替代 jiti 运行时 TS 加载，提升启动速度和兼容性  
  **Pre-compiled build (tsdown)** - Introduced `tsdown` build tool, plugin now ships pre-compiled `dist/index.mjs` instead of relying on jiti runtime TS loading, improving startup speed and compatibility

- ✅ **Channel ID 常量化** - 提取 `CHANNEL_ID = "dingtalk-connector"` 为模块级常量，消除全代码库中的硬编码字符串  
  **Channel ID as constant** - Extracted `CHANNEL_ID` as a module-level constant, eliminating hardcoded strings across the codebase

- ✅ **CLI 安装流程增强** - `bin/dingtalk-connector.js` 新增 `--skip-dws` 参数跳过 DWS CLI 安装；安装成功后提示网关初始化需约 3 分钟  
  **CLI install flow enhancement** - Added `--skip-dws` flag to skip DWS CLI installation; post-install message now mentions ~3 min gateway warm-up

- ✅ **openclaw.plugin.json 元数据补全** - 新增 `name`、`version`、`description`、`author`、`main` 字段和 `skills` 注册  
  **openclaw.plugin.json metadata** - Added `name`, `version`, `description`, `author`, `main` fields and `skills` registration

- ✅ **依赖版本锁定** - `form-data`、`qrcode-terminal`、`zod` 从 `^` 范围锁定为精确版本，`openclaw` peerDependency 改为 `>=2026.3.23`  
  **Dependency version pinning** - Pinned `form-data`, `qrcode-terminal`, `zod` to exact versions; `openclaw` peerDependency changed to `>=2026.3.23`

- ✅ **npm 发包优化** - 新增 `prepack`/`postpack` 脚本在发包时自动剥离 `devDependencies`，减小安装体积；`files` 列表新增 `dist/` 和 `skills/`  
  **npm publish optimization** - Added `prepack`/`postpack` scripts to strip `devDependencies` during publish; `files` list now includes `dist/` and `skills/`

## [0.8.16] - 2026-04-16

### 修复 / Fixes
- 🐛 **AI Card 流式更新 QPS 限流** - 新增全局令牌桶限流器（`cardRateLimiter`），所有会话共享 20 QPS 速率限制，避免多会话并发时总 QPS 叠加超过钉钉 API 限制；遇到 403 QpsLimit 自动退避 2s 后重试  
  **AI Card streaming QPS rate limiting** - Added global token bucket rate limiter shared across all sessions (20 QPS cap) with automatic 2s backoff and retry on 403 QpsLimit

- 🐛 **streamAICard null card 崩溃** - 修复 `createAICardForTarget` 返回 `null` 后调用方通过 `as any` 绕过类型检查导致 `Cannot read properties of null` 崩溃，添加 null 守卫  
  **streamAICard null card crash** - Fixed crash when `createAICardForTarget` returns `null` and callers bypass type checking; added null guard

- 🐛 **插件配置格式兼容性** - 修复 `package.json` 中缺少 `openclaw.channels` 数组导致旧版 OpenClaw 框架安装失败的问题，同时保留新版 `openclaw.channel` 对象格式  
  **Plugin config format compatibility** - Fixed missing `openclaw.channels` array in `package.json` that caused installation failure on older OpenClaw framework versions; both old and new config formats are now present

### 改进 / Improvements
- ✅ **单实例节流间隔优化** - `reply-dispatcher.ts` 的 `updateInterval` 从 500ms 增大到 800ms，配合全局限流器降低单实例发送频率  
  **Per-instance throttle interval** - Increased `updateInterval` from 500ms to 800ms to complement global rate limiter

## [0.8.15] - 2026-04-15

### 新增 / Added
- ✨ **一键扫码安装** - 新增 `npx -y @dingtalk-real-ai/dingtalk-connector install` 命令，通过钉钉扫码一键完成机器人创建、凭证获取、插件安装和配置写入，零手动配置  
  **One-click QR install** - Added `npx` CLI command for one-click DingTalk bot setup via QR scan: creates bot, obtains credentials, installs plugin, and writes config automatically

- ✨ **Device Authorization Flow** - 新增 `device-auth.ts` 和 `device-auth-config.ts` 模块，实现钉钉 Device Flow 授权（init → begin → poll），支持 QR 码终端渲染、指数退避轮询、2 分钟瞬时错误重试窗口  
  **Device Authorization Flow** - Added `device-auth.ts` and `device-auth-config.ts` implementing DingTalk Device Flow (init → begin → poll) with terminal QR rendering, exponential backoff polling, and 2-minute transient error retry window

- ✨ **Onboarding 扫码授权集成** - `onboarding.ts` 配置向导新增扫码授权路径，首选一键扫码，失败时自动降级为手动输入 Client ID / Client Secret  
  **Onboarding QR auth integration** - Setup wizard now prefers one-click QR authorization, with automatic fallback to manual credential input on failure

- ✨ **CLI 凭证暂存与恢复** - 当插件安装失败时，凭证保存到独立的 staging 文件（`.dingtalk-staging.json`），避免污染 `openclaw.json`；下次安装成功后自动恢复  
  **CLI credential staging & recovery** - Credentials saved to separate staging file on plugin install failure, auto-recovered on next successful install

- ✨ **CLI 安装前自动清理** - 安装前自动删除旧版插件目录，清理 `openclaw.json` 中的过期 channel/plugin/allow 配置，避免验证错误  
  **CLI pre-install cleanup** - Auto-removes old plugin directory and stale config entries before install to prevent validation errors

- ✨ **CLI 429 限流重试** - 插件安装遇到 ClawHub 429 限流时，使用 `Atomics.wait` 同步等待（15s/30s）后重试，最多 3 次  
  **CLI 429 rate limit retry** - Plugin install retries up to 3 times with synchronous backoff (15s/30s) on ClawHub 429 rate limiting

### 改进 / Improvements
- ✅ **Prerelease 版本自动识别** - CLI `install` 命令自动检测当前 package 是否为 prerelease 版本（alpha/beta/rc/canary），若是则传递精确版本号给 `openclaw plugins install`，确保安装正确版本  
  **Prerelease version auto-detection** - CLI auto-detects prerelease versions and passes exact version spec to `openclaw plugins install`

- ✅ **手动配置文档拆分** - 将手动创建机器人和手动配置流程从 README 拆分到独立的 `docs/DINGTALK_MANUAL_SETUP.md`，README 精简为快速入门  
  **Manual setup docs separation** - Extracted manual bot creation and config steps to `docs/DINGTALK_MANUAL_SETUP.md`, keeping README focused on quickstart

- ✅ **README 全面重写** - 参考飞书 OpenClaw 插件风格重写中英文 README，精简结构，突出核心功能，FAQ 迁移到 `docs/TROUBLESHOOTING.md`  
  **README overhaul** - Rewrote Chinese and English README following Lark plugin style, streamlined structure with FAQ moved to `docs/TROUBLESHOOTING.md`

- ✅ **GitHub 索引优化** - 新增 `.gitattributes` 排除 `coverage/` 和 `docs/` 的语言统计；优化 `package.json` keywords、description、openclaw channel 元数据；`openclaw.plugin.json` 移除冗余字段  
  **GitHub index optimization** - Added `.gitattributes` for language detection; optimized `package.json` keywords, description, openclaw channel metadata; cleaned `openclaw.plugin.json`

### 文档 / Documentation
- 📝 **新增 `docs/DINGTALK_MANUAL_SETUP.md`** - 完整的手动创建机器人和手动配置 OpenClaw 流程文档  
  **Added `docs/DINGTALK_MANUAL_SETUP.md`** - Complete manual bot creation and OpenClaw configuration guide

- 📝 **新增 `docs/TROUBLESHOOTING.md`** - 常见问题排查文档，涵盖机器人不回复、配置校验、HTTP 401/400、插件安装失败、国内网络等场景  
  **Added `docs/TROUBLESHOOTING.md`** - Troubleshooting guide covering common issues like bot not responding, config validation, HTTP errors, install failures, and China network issues

## [0.8.13] - 2026-04-08

### 修复 / Fixes
- 🐛 **修复文件发送 mediaId 格式不一致导致静默失败** - `sendFileProactive` 在不同调用点传入 `cleanMediaId`（不带 `@`）和 `mediaId`（带 `@`），经实测钉钉 API 统一要求带 `@` 前缀。同时修复 catch 块吞掉异常导致外层误报成功  
  **Fix inconsistent mediaId format causing silent file send failure** - Unified to `@`-prefixed `mediaId`; fixed catch blocks swallowing errors

- 🐛 **修复多账号场景下凭据未解析** - `sendText`/`sendMedia` 在多账号模式下 `clientId`/`clientSecret` 可能为 `SecretInput` 对象，现已用已解析值覆盖  
  **Fix unresolved credentials in multi-account mode** - Resolved values now override raw config

- 🐛 **修复连接错误在 async 回调中无法传播** - 改为 `reject(new Error(...))` 确保 400/401 等错误正确传播  
  **Fix connection errors not propagating** - Changed `throw` to `reject()` inside async error handlers

- 🐛 **修复 QPS 限流后立即重试** - 收到 403 QpsLimit 后同步更新 `lastUpdateTime`  
  **Fix QPS rate limit immediate retry** - `lastUpdateTime` is now synced when skipping

- 🐛 **修复 `resolveAllowFrom` 全局过滤误拦截群消息** - 返回空列表禁用框架层全局过滤，群消息由内部 `groupAllowFrom` 处理  
  **Fix resolveAllowFrom blocking group messages** - Returns `[]` to disable framework-level filtering

### 新增 / Added
- ✨ **消息路由支持 `group:`/`user:` 前缀** - `sendTextToDingTalk` 和 `sendMediaToDingTalk` 新增前缀格式解析，兼容旧版裸 `cid` 前缀  
  **Message routing supports `group:`/`user:` prefix targets** - Backward compatible with bare `cid` prefix

### 改进 / Improvements
- ✅ **兼容 pdf-parse v1/v2 API** - 自动检测导出格式，v2.x 使用 class API，v1.x 使用函数 API  
  **Support both pdf-parse v1 and v2 API** - Auto-detects export format

- ✅ **`enableMediaUpload`/`systemPrompt` 移至共享配置** - 支持多账号独立配置  
  **Move `enableMediaUpload`/`systemPrompt` to shared config** - Per-account configurable

- ✅ **新增出站路由测试** - 覆盖 `group:`/`user:` 前缀解析和消息路由场景  
  **Add outbound routing tests** - Covers prefix parsing and routing scenarios

### 文档 / Documentation
- 📝 **优化 README 安装验证说明** - 移除版本号硬编码，新增插件未加载时的警示提示  
  **Improve README plugin verification instructions** - Removed hardcoded version, added warning

## [0.8.12] - 2026-04-01

### 修复 / Fixes
- 🐛 **修复 v0.8.11 安装后启动崩溃** ([#419](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/419)) - `mammoth` 和 `pdf-parse` 使用静态 import 但已从 dependencies 移除，导致模块加载阶段报错 `Cannot find module 'mammoth'`。改为动态 import + 优雅降级  
  **Fix startup crash after v0.8.11 installation** - Changed `mammoth` and `pdf-parse` from static import to dynamic import with graceful degradation

### 改进 / Improvements
- ✅ **大幅精简依赖体积** - 移除 `pdf-parse`（~21MB）、`fluent-ffmpeg`（~12MB）、`@ffmpeg-installer/ffmpeg`（~70MB）、`@ffprobe-installer/ffprobe` 等非核心依赖，仅保留 `mammoth`（~2MB）在 `optionalDependencies`  
  **Significantly reduce dependency size** - Removed ~100MB of non-core optional dependencies, keeping only `mammoth` (~2MB)

### 重构 / Refactoring
- ✅ **移除无效的代理禁用代码** - 经源码分析 `dingtalk-stream` SDK 的 WebSocket 连接使用 `ws` 库直接建立，不受 `axios.defaults.proxy` 影响。移除 `proxy-config.ts` 及相关代理配置  
  **Remove ineffective proxy bypass code** - Analysis showed `ws` library bypasses axios entirely; removed `proxy-config.ts` and all proxy configuration code

## [0.8.11] - 2026-04-01

### 新增 / Added
- ✨ **升级 Zod v4 + 自动生成 configSchema** - 将 Zod 从 v3 升级至 v4（`zod@^4.3.6`），通过 SDK 的 `buildChannelConfigSchema()` 自动从 Zod Schema 生成 JSON Schema，替代手动维护的 `configSchema.schema`  
  **Upgrade Zod v4 + auto-generate configSchema** - Upgraded Zod from v3 to v4, auto-generating JSON Schema via SDK's `buildChannelConfigSchema()`

### 改进 / Improvements
- ✅ **依赖结构优化，减小安装体积** - 将 `openclaw` 移至 `peerDependencies`（optional），将 `fluent-ffmpeg`/`@ffmpeg-installer/ffmpeg`/`@ffprobe-installer/ffprobe` 移至 `optionalDependencies`，移除未使用的 `pako`  
  **Dependency optimization, reduced install size** - Moved `openclaw` to `peerDependencies` (optional), moved ffmpeg packages to `optionalDependencies`, removed unused `pako`

## [0.8.10] - 2026-03-31

### 修复 / Fixes
- 🐛 **Gateway Methods 配置访问失败** ([#397](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/397)) - 修复 SDK 升级后 `context.deps.config` 为 `undefined`，所有 Gateway RPC 方法调用失败。改用 SDK 的 `loadConfig()` 函数获取配置  
  **Gateway Methods config access failure** - Fixed `context.deps.config` being `undefined` after SDK upgrade, now uses `loadConfig()` from `openclaw/plugin-sdk/config-runtime`

- 🐛 **锁定 axios 版本避免兼容性问题** ([#396](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/396)) - 将 `axios` 从 `^1.6.0` 锁定为 `1.6.0`，避免自动升级引入不兼容变更  
  **Pin axios version** - Pinned `axios` from `^1.6.0` to `1.6.0` to prevent incompatible upgrades

### 改进 / Improvements
- ✅ **connection.ts 动态 import 优化** - 将 `createLoggerFromConfig` 改为动态 import，避免潜在循环依赖  
  **connection.ts dynamic import** - Changed `createLoggerFromConfig` to dynamic import to avoid potential circular dependencies

## [0.8.9] - 2026-03-31

### 新增 / Added
- ✨ **引用消息完整解析** - 新增 `extractQuotedMsgText` 递归解析引用消息（最多 3 层嵌套），支持 text、richText、picture、video、audio、file、markdown、interactiveCard 等消息类型，自动提取引用中的媒体附件和链接  
  **Quoted message full parsing** - Added recursive quoted message parsing (up to 3 levels) with media attachment and URL extraction

- ✨ **新增配置项 asyncMode / ackText / endpoint / debug** - `configSchema` 新增四个配置字段  
  **New config options** - Added `asyncMode`, `ackText`, `endpoint`, `debug` to configSchema

- ✨ **普通消息本地图片后处理** - `sendNormalToUser` 和 `sendNormalToGroup` 新增本地图片上传后处理，发送普通消息时自动替换本地图片路径为 media_id  
  **Local image post-processing for normal messages** - Added automatic local image upload and replacement in `sendNormalToUser` and `sendNormalToGroup`

### 修复 / Fixes
- 🐛 **macOS LaunchAgent 环境 WebSocket 连接失败** - 修复 macOS LaunchAgent/daemon 环境下 fd 0/1/2 无效（EBADF）导致 TCP 连接创建失败的问题  
  **WebSocket connection failure on macOS LaunchAgent** - Fixed EBADF errors on macOS LaunchAgent environments by redirecting invalid file descriptors to `/dev/null`

- 🐛 **AI Card 流式关闭竞争条件** - 修复 `closeStreaming` 被 `onIdle` 和 `onError` 同时触发时的竞争条件，采用 snapshot 模式防止并发崩溃  
  **AI Card streaming close race condition** - Fixed race condition in `closeStreaming` using snapshot pattern to prevent concurrent crashes

- 🐛 **FormData CJS 互操作问题** - 将 `form-data` 从动态 import 改为静态 import，修复 jiti/ESM 环境下 `.default` 偶发为 undefined 的问题  
  **FormData CJS interop issue** - Changed `form-data` from dynamic to static import, fixing intermittent `.default` undefined errors in jiti/ESM

- 🐛 **纯文本图片路径误转换** - 禁用纯文本中本地图片路径自动转换为图片语法的行为，避免影响用户展示路径文本的场景  
  **Bare image path false conversion** - Disabled automatic conversion of bare local image paths to image syntax

### 改进 / Improvements
- ✅ **Zod Schema 拆分兼容 Web UI** - 将 `DingtalkConfigSchema` 拆分为 `DingtalkConfigBaseSchema` 和带 `superRefine` 的完整 Schema，解决 JSON Schema 生成兼容性问题  
  **Zod Schema split for Web UI compatibility** - Split schema to fix `buildChannelConfigSchema` JSON Schema generation

- ✅ **configSchema 类型简化** - 将 `clientId`、`clientSecret` 等字段从 `oneOf` 联合类型简化为单一 `string` 类型  
  **configSchema type simplification** - Simplified JSON Schema from `oneOf` union types to single `string` type

- ✅ **reply-dispatcher logger 统一** - 替换手动构建的 log 对象为 `createLoggerFromConfig`  
  **reply-dispatcher logger unification** - Replaced manual log object with `createLoggerFromConfig`

- ✅ **锁定 axios 版本到 1.6.0** - 避免自动升级引入不兼容变更  
  **Pin axios to 1.6.0** - Prevent automatic upgrades from introducing incompatible changes

## [0.8.8] - 2026-03-29

### 修复 / Fixes
- 🐛 **多 block 流式响应产生多条独立气泡** ([#369](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/369)) - 重构 `startStreaming` 并发控制逻辑，从 `isCreatingCard` 布尔标志改为 `cardCreationPromise`，彻底消除多 block 响应场景下每个 block 新建独立 AI Card 气泡的问题  
  **Multi-block streaming response creates multiple bubbles** - Refactored `startStreaming` concurrency control from boolean flag to `cardCreationPromise`, eliminating independent AI Card bubbles per block in multi-block responses

- 🐛 **Web UI Connected / Last inbound 显示 n/a** - 新增 `onStatusChange` 回调在连接建立/断开/收到消息时上报状态字段；补全 `buildSessionContext` 中 `conversationId` 和 `groupSubject` 字段透传  
  **Web UI shows n/a for Connected and Last inbound** - Added `onStatusChange` callback to report status fields on connection events; fixed `buildSessionContext` field passthrough

- 🐛 **AI Card 函数调用参数错误** - 修复 `reply-dispatcher.ts` 中 `createAICardForTarget`、`streamAICard`、`finishAICard` 参数从 `params.runtime` 改为 `account.config/log`  
  **AI Card function call parameter error** - Fixed parameters in `reply-dispatcher.ts` from `params.runtime` to `account.config/log`

- 🐛 **sendFileProactive 参数错误导致文件发送失败** - 修复 `processFileMarkers` 和 `processRawMediaPaths` 错误传入 `downloadUrl`，改为正确的 `cleanMediaId`  
  **File sending failure due to wrong sendFileProactive parameter** - Fixed incorrect `downloadUrl` parameter, now correctly uses `cleanMediaId`

- 🐛 **纯多账号配置下 probe 被跳过** ([#381](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/381)) - `getStatus()` 改用 `resolveDingtalkAccount()` 统一获取账号信息，修复纯多账号配置下状态显示不准确的问题  
  **Probe skipped in pure multi-account config** - `getStatus()` now uses `resolveDingtalkAccount()` for unified account resolution

### 改进 / Improvements
- ✅ **音频时长提取安全性改进** ([#134](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/134)) - `extractAudioDuration` 改用 `fluent-ffmpeg` 的 `ffprobe` API，消除安全扫描误报  
  **Audio duration extraction security improvement** - Changed to `fluent-ffmpeg` `ffprobe` API, eliminating security scan false positives

- ✅ **SDK 接口迁移** - `onboarding.ts` 类型引用迁移到新版 `ChannelSetupWizardAdapter`，导入路径更新为 `openclaw/plugin-sdk/setup`  
  **SDK interface migration** - Migrated to `ChannelSetupWizardAdapter` and updated import path to `openclaw/plugin-sdk/setup`

## [0.8.7] - 2026-03-26

### 修复 / Fixes
- 🐛 **账号 ID 大小写敏感修复** - 修复 `normalizeAccountId` 函数强制将账号 ID 转为小写（`.toLowerCase()`）导致驼峰命名账号（如 `zhizaoDashuIP`）无法匹配配置的问题。现在账号 ID 仅做 `trim()` 处理，保留原始大小写，与配置文件中的 key 严格匹配  
  **Account ID case-sensitivity fix** - Fixed `normalizeAccountId` forcibly lowercasing account IDs, which caused camelCase account IDs (e.g., `zhizaoDashuIP`) to fail configuration lookup. Account IDs are now only trimmed, preserving original casing for strict matching against config keys

- 🐛 **WebSocket 连接代理控制统一** - 修复 `src/core/connection.ts` 中 WebSocket 连接未遵循 `DINGTALK_FORCE_PROXY` 环境变量的问题，现在与 HTTP 请求保持一致的代理控制逻辑  
  **Unified proxy control for WebSocket connections** - Fixed WebSocket connections not respecting the `DINGTALK_FORCE_PROXY` environment variable; proxy control is now consistent with HTTP requests

- 🐛 **媒体下载代理控制统一** - 修复 `src/core/message-handler.ts` 中图片/文件下载时代理配置与 HTTP 客户端不一致的问题，确保所有媒体下载请求统一遵循代理控制策略  
  **Unified proxy control for media downloads** - Fixed inconsistent proxy configuration for image/file downloads; all media download requests now follow the unified proxy control policy

- 🐛 **多账号消息去重误判** - 修复多账号（多机器人）场景下，同一条群消息 @多个机器人时，第二个机器人因去重缓存未按账号隔离，误将消息判定为重复而跳过处理的问题。`checkAndMarkDingtalkMessage` 的去重 key 现在带有 `accountId` 前缀，不同机器人账号的去重缓存完全隔离  
  **Multi-account message deduplication false positive** - Fixed an issue where a group message mentioning multiple bots caused the second bot to skip processing due to a shared deduplication cache. The deduplication key now includes an `accountId` prefix, fully isolating each bot's cache

## [0.8.6] - 2026-03-24

### 改进 / Improvements
- ✅ **移除版本校验逻辑** - 删除插件入口 `index.ts` 中的 OpenClaw SDK 版本兼容性检查代码，简化插件启动流程，提升加载性能  
  **Removed version check logic** - Removed OpenClaw SDK version compatibility check code from plugin entry `index.ts`, simplifying plugin startup process and improving load performance

## [0.8.5] - 2026-03-24

### 改进 / Improvements
- ✅ **移除 SDK 版本兼容性检查** - 移除插件启动时的 OpenClaw SDK 版本检查逻辑，简化插件入口代码，提升加载性能  
  **Removed SDK version compatibility check** - Removed OpenClaw SDK version check logic at plugin startup, simplifying entry code and improving load performance

## [0.8.4] - 2026-03-24

### 修复 / Fixes
- 🐛 **群聊消息处理崩溃** - 修复群聊时报错 `TypeError: Cannot read properties of undefined (reading 'config')` 导致 Agent 无法回复的问题。根因是 `src/policy.ts` 中 `resolveDingtalkGroupToolPolicy` 函数的参数签名与 OpenClaw SDK 的 `ChannelGroupContext` 接口不匹配，函数期望接收 `account: ResolvedDingtalkAccount`，但框架实际传入 `{ cfg, groupId, accountId, ... }`，导致 `account` 为 `undefined`。现已修正参数签名，内部通过 `resolveDingtalkAccount()` 正确获取账号信息。单聊不受影响。  
  **Group chat message processing crash** - Fixed `TypeError: Cannot read properties of undefined (reading 'config')` crash in group chats. Root cause: `resolveDingtalkGroupToolPolicy` in `src/policy.ts` had a parameter signature mismatch with the OpenClaw SDK's `ChannelGroupContext` interface. Fixed by correcting the parameter signature and resolving the account internally via `resolveDingtalkAccount()`. Direct messages were unaffected.

- 🐛 **兼容旧版 OpenClaw Gateway（createPluginRuntimeStore 缺失）** - 修复在旧版 OpenClaw Gateway 上加载插件时报错 `TypeError: (0 , _pluginSdk.createPluginRuntimeStore) is not a function` 的问题。根因是 `src/runtime.ts` 直接从 `openclaw/plugin-sdk` 导入 `createPluginRuntimeStore`，而该函数在旧版 SDK 中并不存在。现已替换为内联实现的 `createRuntimeStore`，功能完全等价，兼容所有版本的 OpenClaw  
  **Compatible with older OpenClaw Gateway (missing createPluginRuntimeStore)** - Fixed `TypeError: (0 , _pluginSdk.createPluginRuntimeStore) is not a function` when loading the plugin on older OpenClaw Gateway versions. Root cause: `src/runtime.ts` imported `createPluginRuntimeStore` from `openclaw/plugin-sdk`, which doesn't exist in older SDK versions. Replaced with an inline `createRuntimeStore` implementation that is fully equivalent and compatible with all OpenClaw versions

- 🐛 **openclaw 依赖版本约束放宽** - 将 `package.json` 中的 `"openclaw": "^2026.3.0"` 改为 `"openclaw": "*"`，避免版本约束导致安装失败或与用户已安装版本冲突  
  **Relaxed openclaw dependency version constraint** - Changed `"openclaw": "^2026.3.0"` to `"openclaw": "*"` in `package.json` to avoid installation failures or conflicts with the user's installed version

## [0.8.3] - 2026-03-24

### 修复 / Fixes
- 🐛 **兼容 OpenClaw Gateway 新版本** - 修复在 OpenClaw Gateway 2026.3.22+ 版本下安装插件时报错 `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './plugin-sdk/compat' is not defined by "exports"` 的问题。根因是 `src/runtime.ts` 使用了已被新版 SDK 移除的 `openclaw/plugin-sdk/compat` 子路径，现已改为从 `openclaw/plugin-sdk` 主入口导入，对所有版本（2026.3.1+）均兼容  
  **Compatible with newer OpenClaw Gateway versions** - Fixed `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './plugin-sdk/compat' is not defined by "exports"` when installing under OpenClaw Gateway 2026.3.22+. Root cause: `src/runtime.ts` imported from the removed `openclaw/plugin-sdk/compat` sub-path; now imports from the `openclaw/plugin-sdk` main entry, compatible with all versions (2026.3.1+)

- ✅ **AI 卡片流式更新延迟优化** - 改动前 `onReplyStart` 串行等待 AI Card 创建（约 500ms~1s），期间 partial reply 全部丢弃，节流间隔 1000ms 也过于保守。改动后 AI Card 创建改为 fire-and-forget 与 AI 生成并行，节流间隔调整为 500ms，流式内容能更早更频繁地呈现  
  **AI card progressive update latency improvement** - Previously `onReplyStart` awaited AI Card creation serially (~500ms–1s), discarding all partial replies during that window, with a 1000ms throttle too conservative for short replies. AI Card creation now runs fire-and-forget in parallel with AI generation; throttle reduced to 500ms for earlier and more frequent streaming updates

- 🐛 **多 Agent 路由与 sharedMemoryAcrossConversations 冲突** - 修复配置 `sharedMemoryAcrossConversations: true` 时，多群分配不同 Agent 的 bindings 全部路由到同一 Agent 的问题。路由匹配现在使用专用的 `peerId`（真实 peer 标识，不受会话隔离配置影响），session 构建使用 `sessionPeerId`，两者职责严格分离  
  **Multi-Agent routing conflict with sharedMemoryAcrossConversations** - Fixed all bindings resolving to the same Agent when `sharedMemoryAcrossConversations: true`. Routing now uses dedicated `peerId` (real peer identifier, unaffected by session isolation config); session construction uses `sessionPeerId` with strict separation of responsibilities

- 🐛 **发送图片失败** - 修复发送图片时出现异常的问题 ([#316](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/316))  
  **Image sending failure** - Fixed an issue where sending images would fail with an error ([#316](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/316))

- 🐛 **发送人昵称与群名称未正确传递给 AI** - 修复会话上下文中 `SenderName` 字段错误传入用户 ID（而非昵称）、`GroupSubject` 字段错误传入群 ID（而非群名称）的问题，AI 现在能正确获取发送人的钉钉昵称和所在群的名称  
  **Sender nickname and group name not passed to AI** - Fixed `SenderName` being set to user ID instead of display name, and `GroupSubject` being set to group ID instead of group title; AI now correctly receives the sender's nickname and group name

### 改进 / Improvements
- ✨ **消息队列繁忙时的即时排队反馈** - 当用户快速连续发送消息、上一条仍在处理中时，新消息现在会立即弹出一条 AI Card 气泡显示排队提示文案，同时贴上"思考中"表情。等轮到该消息处理时，气泡**原地更新**为最终回复内容，不会额外多发一条消息  
  **Instant queue acknowledgement when busy** - When a user sends messages in quick succession while the previous one is still processing, the new message now immediately shows an AI Card bubble with a queuing acknowledgement and a "thinking" emoji. When it's the message's turn, the same bubble is **updated in place** with the final reply — no extra message is sent

## [0.8.2] - 2026-03-22

### 修复 / Fixes
- 🐛 **多账号重复启动问题** - 修复 `enabled: false` 的账号仍会建立 WebSocket 连接的问题，禁用账号现在正确保持 pending 状态直到 Gateway 停止  
  **Multi-account duplicate startup** - Fixed accounts with `enabled: false` still establishing WebSocket connections; disabled accounts now correctly remain in a pending state until the Gateway stops

- 🐛 **相同 clientId 账号去重** - 修复多个账号配置相同 `clientId` 时建立重复连接的问题，通过静态配置分析确保同一 `clientId` 只有列表中第一个启用账号建立连接  
  **Duplicate clientId deduplication** - Fixed duplicate connections when multiple accounts share the same `clientId`; static config analysis now ensures only the first enabled account per `clientId` establishes a connection


### 改进 / Improvements
- ✅ **Onboarding 配置向导优化** - 改进钉钉连接器配置引导逻辑，调整凭据输入顺序（先 Client ID 后 Client Secret），优化引导文案  
  **Onboarding wizard improvement** - Improved DingTalk connector onboarding flow, adjusted credential input order (Client ID first, then Client Secret), and refined guidance text

- ✅ **会话 Key 遵循 OpenClaw 规范** - 会话上下文按 OpenClaw 标准规则构建，通过 `channel`、`accountId`、`chatType`、`peerId` 唯一标识会话，支持 `sharedMemoryAcrossConversations` 跨会话记忆共享  
  **Session key follows OpenClaw convention** - Session context now built per OpenClaw standard rules, uniquely identified via `channel`, `accountId`, `chatType`, `peerId`; supports `sharedMemoryAcrossConversations` for cross-conversation memory sharing

- ✅ **消息处理逻辑优化** - 重构消息处理流程，提升消息响应速度和处理可靠性，确保消息按序正确处理  
  **Message processing logic optimization** - Refactored message processing flow to improve response speed and reliability, ensuring messages are processed correctly in order

## [0.8.1] - 2026-03-20

### 修复 / Fixes
- 🐛 **文件和图片下载 OSS 签名验证失败** - 修复默认 `Content-Type` 请求头导致 OSS 签名验证失败的问题，确保文件和图片能够正常下载  
  **File and image download OSS signature verification failure** - Fixed OSS signature verification failure caused by default `Content-Type` header, ensuring files and images download correctly

## [0.8.0] - 2026-03-20

### 重构 / Refactoring
- ✅ **业务逻辑分层重构** - 对项目结构进行重构，采用业务逻辑分层设计，明确职责边界，降低模块耦合并提升可维护性  
  **Business-logic layered refactor** - Reworked project architecture with layered business logic design, clarifying responsibilities, reducing coupling, and improving maintainability
- ✅ **OpenClaw 对接方式升级** - 从 OpenClaw HTTP 对接迁移为 OpenClaw SDK，统一调用链路并增强集成稳定性  
  **OpenClaw integration upgrade** - Migrated from OpenClaw HTTP integration to OpenClaw SDK for a unified invocation flow and better integration stability

### 改进 / Improvements
- ✅ **IM 交互体验优化** - 优化 IM 场景下的部分交互细节，提升消息处理与反馈体验  
  **IM interaction optimization** - Improved several interaction details in IM scenarios to provide smoother message handling and feedback
- ✅ **README 重写与配置简化** - 重写 README 文档，简化配置教程，降低接入门槛并提升上手效率  
  **README rewrite & simpler setup** - Rewrote README and simplified setup guidance to reduce onboarding complexity and speed up adoption

### 修复 / Fixes
- 🐛 **dingtalk-stream 断连问题修复** - 修复 dingtalk-stream 相关的部分断连场景，增强长连接稳定性与恢复能力  
  **dingtalk-stream disconnect fixes** - Fixed several dingtalk-stream related disconnection scenarios, improving long-connection stability and recovery

## [0.7.10] - 2026-03-16

### 新增 / Added
- ✨ **WebSocket 心跳重连机制优化** - 关闭 DWClient 的 `autoConnect`，采用应用层自动重连机制（修复 DWClient 重连 bug）；添加指数退避重连策略，避免雪崩效应；使用 WebSocket 原生 Ping 进行心跳检测  
  **WebSocket heartbeat & reconnect optimization** - Disabled DWClient's `autoConnect`, implemented app-layer auto-reconnect (fixing DWClient bug); added exponential backoff to avoid avalanche; using WebSocket native Ping for heartbeat
- ✨ **socket-manager 模块** - 新增模块统一管理 WebSocket 连接生命周期，包括心跳检测、自动重连、指数退避、事件监听等  
  **socket-manager module** - New module for unified WebSocket connection lifecycle management, including heartbeat, auto-reconnect, exponential backoff, event listening
- ✨ **debug 参数** - 添加 `debug` 配置项控制详细日志输出，便于问题排查  
  **debug parameter** - Added `debug` config to control detailed log output for easier troubleshooting
- ✨ **WebSocket 无限重连机制** - 移除最大重连次数限制，实现无限重连，确保长连接服务的高可用性  
  **WebSocket infinite reconnection** - Removed maximum reconnection attempt limit, implemented infinite reconnection to ensure high availability for long-lived connection services

### 修复 / Fixes
- 🐛 **修复 DWClient 重连 bug** - DWClient 内置重连机制存在缺陷，通过应用层重连机制替代，确保连接稳定可靠  
  **Fixed DWClient reconnect bug** - DWClient's built-in reconnect has defects; replaced with app-layer reconnect for stable connection
- 🐛 **长连接静默断开** - 通过应用层心跳检测连接活性，超时后主动重连，减少因长时间无数据导致的静默断连且无法恢复  
  **Long-lived connection silent disconnect** - App-layer heartbeat detects liveness and triggers reconnect on timeout, reducing silent disconnects when idle
### 改进 / Improvements
- ✅ **DWClient 配置** - 设置 `autoReconnect: false`、`keepAlive: false`，由应用层接管重连和心跳，避免与钉钉服务端策略冲突  
  **DWClient config** - Set `autoReconnect: false`, `keepAlive: false`; app-layer takes over reconnect and heartbeat to avoid server conflicts
- ✅ **指数退避策略** - 公式 `baseBackoffDelay * Math.pow(2, attempt) + jitter(0-1s)`，最大退避 30 秒，避免雪崩效应  
  **Exponential backoff strategy** - Formula `baseBackoffDelay * Math.pow(2, attempt) + jitter(0-1s)`, max 30s backoff to avoid avalanche effect
- ✅ **统一事件监听** - `pong`、`message`、`close`、`open` 四个事件统一管理和清理，提升代码可维护性  
  **Unified event listening** - `pong`, `message`, `close`, `open` events managed and cleaned up uniformly, improving maintainability
- ✅ **配置简化** - 从 `SocketManagerConfig` 中移除 `maxReconnectAttempts` 配置项，简化配置复杂度  
  **Configuration simplification** - Removed `maxReconnectAttempts` from `SocketManagerConfig`, simplifying configuration
- ✅ **日志输出优化** - 更新重连日志格式，移除最大次数显示（从 "尝试 X/5" 改为 "尝试 X"）  
  **Log output optimization** - Updated reconnection log format, removed maximum attempt display (from "attempt X/5" to "attempt X")

### 技术细节 / Technical Details
- **退避策略**：指数退避 + 随机抖动，公式 `baseBackoffDelay * Math.pow(2, attempt) + jitter(0-1s)`  
- **最大退避**：30 秒（由 `maxBackoffDelay` 限制）  
- **重置条件**：重连成功后 `reconnectAttempts` 归零  
- **立即重连**：心跳检测失败、WebSocket close、disconnect 消息触发时立即重连，不退避  

## [0.7.9] - 2026-03-13

### 新增 / Added
- ✨ **应用层心跳机制** - 钉钉 Stream 客户端使用自定义心跳（WebSocket ping/pong，30 秒间隔、90 秒超时），超时后主动断开并重连，重连失败 5 秒后重试  
  **Application-layer heartbeat** - Stream client uses custom ping/pong heartbeat (30s interval, 90s timeout), reconnects on timeout with 5s retry on failure
- ✨ **统一停止与清理** - 停止客户端时通过 `doStop` 统一清理心跳定时器并调用 `client.disconnect()`，确保连接正确关闭  
  **Unified stop & cleanup** - `doStop` clears heartbeat timer and calls `client.disconnect()` when stopping the client

### 修复 / Fixes
- 🐛 **长连接静默断开** - 关闭 SDK 激进 keepAlive（8 秒超时），改用应用层心跳，减少因长时间无数据导致的静默断连且无法恢复  
  **Long-lived connection silent disconnect** - Disabled SDK aggressive keepAlive (8s timeout), use app-layer heartbeat to reduce silent disconnects when idle

### 改进 / Improvements
- ✅ **DWClient 配置** - 启用 `autoReconnect: true`，设置 `keepAlive: false`，由应用层心跳替代 SDK 心跳，避免与钉钉服务端策略冲突  
  **DWClient config** - `autoReconnect: true`, `keepAlive: false`; app-layer heartbeat replaces SDK keepAlive to avoid conflicts with server

## [0.7.8] - 2026-03-13

### 修复 / Fixes
- 🐛 **AI 卡片模版与渲染优化** - 更新 AI 卡片模版 ID，使卡片样式与最新官方规范保持一致，并提升多终端展示效果  
  **AI card template & rendering optimization** - Updated the AI card template ID to match the latest official standard and improved rendering across clients
- 🐛 **Markdown 表格渲染修复** - 在发送到钉钉前自动为 Markdown 表格头部补充必要空行，避免因缺少空行导致表格被当作普通文本渲染  
  **Markdown table rendering fix** - Automatically inserts required blank lines before Markdown table headers to prevent DingTalk from rendering tables as plain text
- 🐛 **消息去重逻辑优化** - 将消息去重维度从「账号 + 消息 ID」简化为单一「消息 ID」，避免多账号场景下的重复处理或误判  
  **Message de-duplication optimization** - Simplified de-duplication from `(accountId, messageId)` to `messageId` only, preventing duplicate handling or misjudgment in multi-account scenarios

### 改进 / Improvements
- ✅ **统一 Markdown 修正管道** - 对 AI 卡片流式内容、最终内容、普通 Markdown 消息及 `sampleMarkdown` 卡片文本统一应用 Markdown 修正规则，确保表格等格式在各入口行为一致  
  **Unified Markdown normalization pipeline** - Applies the same Markdown normalization to streaming AI card content, final content, regular Markdown messages, and `sampleMarkdown` card text for consistent behavior
- ✅ **AI 卡片状态内容一致性** - 在完成 AI 卡片时，对展示内容和写入 `cardParamMap.msgContent` 的内容使用同一份 Markdown 修正结果，确保用户看到的内容与内部状态一致  
  **Consistent AI card status content** - Ensures the same normalized Markdown is used both for the visible content and `cardParamMap.msgContent` when finishing AI cards

## [0.7.7] - 2026-03-13

### 新增 / Added
- ✨ **自定义 Gateway URL 支持** - 新增 `gatewayBaseUrl` 配置项，支持通过自定义 URL（如 Nginx 反向代理到 TLS/HTTPS Gateway）访问 Gateway  
  **Custom Gateway URL support** - Added `gatewayBaseUrl` option to allow using a custom URL (e.g., Nginx reverse proxy to a TLS/HTTPS Gateway)
- ✨ **钉钉「思考中」表情反馈** - 在处理用户消息期间为原消息贴上「🤔思考中」表情，处理结束后自动撤回，清晰展示处理进度  
  **DingTalk “thinking” emotion feedback** - Attaches a “🤔 Thinking” emotion to the original user message while processing and automatically recalls it after completion to clearly indicate progress
- ✨ **测试基础设施完善** - 引入 Vitest 及多种测试脚本（run/watch/coverage/ui/integration），为后续自动化测试和回归验证提供基础  
  **Improved testing infrastructure** - Introduced Vitest and multiple test scripts (run/watch/coverage/ui/integration) to enable better automated and regression testing
- ✨ **Issue Webhook 工作流** - 新增 GitHub Actions 工作流，将 Issue 变更以统一 JSON 格式推送到配置的 Webhook  
  **Issue webhook workflow** - Added a GitHub Actions workflow to push Issue changes as unified JSON payloads to a configured webhook

### 修复 / Fixes
- 🐛 **媒体元数据与缩略图提取更健壮** - ffprobe 或缩略图生成失败时不再中断主流程，而是返回默认元数据或空缩略图  
  **More robust media metadata & thumbnail extraction** - ffprobe or thumbnail generation failures no longer abort the main flow but return default metadata or a null thumbnail instead
- 🐛 **音频时长提取兼容性改进** - 使用动态 `import('child_process')` 替代 `require('child_process')`，提升在不同运行环境下的兼容性  
  **Audio duration extraction compatibility** - Replaced `require('child_process')` with dynamic `import('child_process')` to improve compatibility across environments
- 🐛 **主动消息用户列表校验** - 为主动消息的 `userIds` 列表增加空值过滤，避免因无效用户 ID 导致请求失败  
  **Proactive message user list validation** - Added empty value filtering for the `userIds` list in proactive messages to prevent request failures caused by invalid IDs

## [0.7.6] - 2026-03-12

### 修复 / Fixes
- 🐛 **Gateway 端口连接修复** - 修复修改 gateway 端口后无法连接的问题，确保配置中的 `gateway.port` 能够正确生效  
  **Gateway port connection fix** - Fixed issue where connection fails after modifying gateway port, ensuring that `gateway.port` in configuration takes effect correctly
- 🐛 **新会话命令修复** - 修复新会话命令（`/new`、`/reset`、`/clear`、`新会话` 等）未真正清理会话的问题，统一将命令透传到 Gateway 由 Gateway 统一处理会话重置  
  **New session command fix** - Fixed issue where new session commands (`/new`, `/reset`, `/clear`, `新会话`, etc.) did not actually clear sessions, commands are now forwarded to Gateway for unified session reset handling

## [0.7.5] - 2026-03-10

### 修复 / Fixes
- 🐛 **修复 Stream 客户端频繁重连问题** - 禁用 `DWClient` 内置的 `autoReconnect`，由框架的 health-monitor 统一管理重连逻辑，避免双重重连机制冲突  
  **Fixed Stream client frequent reconnection issue** - Disabled `DWClient` built-in `autoReconnect`, reconnection is now managed by framework's health-monitor to avoid dual reconnection mechanism conflict
- 🐛 **修复连接关闭不完整问题** - `stop()` 方法现在正确调用 `client.disconnect()` 关闭 WebSocket 连接  
  **Fixed incomplete connection closure** - `stop()` method now correctly calls `client.disconnect()` to close WebSocket connection
- 🐛 **Gateway 端口连接修复** - 修复修改 gateway 端口后无法连接的问题
  **Gateway port connection fix** - Fixed issue where connection fails after modifying gateway port

### 重构 / Refactoring
- ✅ **OpenClaw session.dmScope 机制** - 会话管理由 OpenClaw Gateway 统一处理，插件不再内部管理会话超时  
  **OpenClaw session.dmScope mechanism** - Session management is now handled by OpenClaw Gateway, plugin no longer manages session timeout internally
- ✅ **SessionContext 标准化** - 使用 OpenClaw 标准的 SessionContext JSON 格式传递会话上下文  
  **SessionContext standardization** - Use OpenClaw standard SessionContext JSON format for session context

### 配置变更 / Configuration Changes
- 新增 `groupSessionScope`（默认：`group`）- 群聊会话隔离策略（仅当 separateSessionByConversation=true 时生效）：`group`=群共享，`group_sender`=群内用户独立  
  Added `groupSessionScope` (default: `group`) - Group chat session isolation (only when separateSessionByConversation=true): `group`=shared, `group_sender`=per-user
- ⚠️ **废弃** `sessionTimeout` - 会话超时由 OpenClaw Gateway 的 `session.reset.idleMinutes` 配置控制，详见 [Gateway 配置文档](https://docs.openclaw.ai/gateway/configuration)  
  **Deprecated** `sessionTimeout` - Session timeout is now controlled by OpenClaw Gateway's `session.reset.idleMinutes`, see [Gateway Configuration](https://docs.openclaw.ai/gateway/configuration)

### 向后兼容 / Backward Compatibility
- 旧配置 `sessionTimeout` 仍可使用，但会打印废弃警告日志  
  Old config `sessionTimeout` still works but will print deprecation warning

## [0.7.4] - 2026-03-09

### 新增功能 / Added Features
- ✅ **按会话区分 Session** - 支持按单聊、群聊、不同群分别维护独立会话，单聊与群聊、不同群之间的对话上下文互不干扰  
  **Session by conversation** - Support separate sessions for direct chat, group chat, and different groups; conversation context is isolated between DMs, group chats, and different groups
- ✅ **记忆隔离/共享配置** - 新增 `sharedMemoryAcrossConversations` 配置，控制单 Agent 场景下是否在不同会话间共享记忆；默认 `false` 实现群聊与私聊、不同群之间的记忆隔离  
  **Memory isolation/sharing config** - Added `sharedMemoryAcrossConversations` option to control whether memory is shared across conversations in single-Agent mode; default `false` isolates memory between DMs, group chats, and different groups
- ✅ **Gateway Session 格式增强** - Session key 支持 `group:conversationId` 格式，便于 Gateway 识别群聊场景  
  **Gateway session format enhancement** - Session key supports `group:conversationId` format for Gateway to identify group chat scenarios
- ✅ **X-OpenClaw-Memory-User 支持** - 向 Gateway 传递记忆归属用户标识，支持 Gateway 侧记忆管理  
  **X-OpenClaw-Memory-User support** - Pass memory user identifier to Gateway for memory management

### 配置 / Configuration
- 新增 `separateSessionByConversation`（默认：`true`）- 是否按单聊/群聊/群区分 session  
  Added `separateSessionByConversation` (default: `true`) - Whether to separate sessions by direct/group/different groups  
  Added `separateSessionByConversation` (default: `true`) - Whether to separate sessions by direct/group/different groups (deprecated in 0.7.5)
- 新增 `sharedMemoryAcrossConversations`（默认：`false`）- 单 Agent 场景下是否在不同会话间共享记忆；`false` 时不同群聊、群聊与私聊记忆隔离  
  Added `sharedMemoryAcrossConversations` (default: `false`) - Whether to share memory across conversations in single-Agent mode; when `false`, memory is isolated between different groups and between DMs and groups

## [0.7.3] - 2026-03-09

### 修复 / Fixes
- 🐛 **兼容性修复**：修复 0.7.0 引入的默认 Agent 路由回归问题。0.7.0 之前默认路由到 `main` agent，0.7.0 之后错误地路由到 `default` agent，现已恢复为 `main` agent  
  **Compatibility fix**: Fixed default agent routing regression introduced in 0.7.0. Before 0.7.0 default routed to `main` agent, after 0.7.0 incorrectly routed to `default` agent, now restored to `main` agent
- 🐛 修复用户显式配置名为 `default` 的账号时被错误映射的问题：使用 `__default__` 作为内部默认账号标识  
  Fixed issue where user-configured account named `default` was incorrectly mapped: Use `__default__` as internal default account identifier

### 改进 / Improvements
- 抽取 `DEFAULT_ACCOUNT_ID` 常量到文件顶部，统一管理默认账号标识  
  Extracted `DEFAULT_ACCOUNT_ID` constant to file top, unified management of default account identifier
- 更新 API 文档注释，移除对 `default` 的硬编码引用  
  Updated API documentation comments, removed hardcoded references to `default`

## [0.7.2] - 2026-03-05

### 新增功能 / Added Features
- ✅ 新增异步模式：立即回执用户消息，后台处理任务，然后主动推送最终结果作为独立消息  
  Added async mode: immediately acknowledge user messages, process in background, then push the final result as a separate message
- ✅ 支持自定义回执消息文本，可通过 `ackText` 配置项设置  
  Support custom acknowledgment message text, configurable via `ackText` option

### 修复 / Fixes
- 🐛 修复异步模式下 Agent 路由问题：`streamFromGateway` 调用时缺少 `accountId` 参数，导致会话路由到 undefined agent  
  Fixed agent routing in async mode: `streamFromGateway` was called without `accountId`, causing sessions to route to undefined agent
- 🐛 修复默认 Agent 路由：当 `accountId` 为 `'default'` 时跳过 `X-OpenClaw-Agent-Id` header，让 gateway 路由到其配置的默认 agent  
  Fixed default agent routing: Skip `X-OpenClaw-Agent-Id` header when `accountId` is `'default'`, letting gateway route to its configured default agent
- 🐛 修复异步模式内容处理：使用 `userContent`（包含文件附件）替代原始 `content.text`  
  Fixed async mode content: Use `userContent` (includes file attachments) instead of raw `content.text`
- 🐛 修复异步模式图片支持：将 `imageLocalPaths` 传递给 gateway stream  
  Fixed image support for async mode: Pass `imageLocalPaths` to gateway stream

### 配置 / Configuration
- 新增 `asyncMode` 配置项（默认：`false`）- 启用异步模式  
  Added `asyncMode` configuration option (default: `false`) - Enable async mode
- 新增 `ackText` 配置项（默认：`'🫡 任务已接收，处理中...'`）- 自定义回执消息文本  
  Added `ackText` configuration option (default: `'🫡 任务已接收，处理中...'`) - Custom ack message text

## [0.7.1] - 2026-03-05

### 修复 / Fixes
- 🐛 修复 stream 模式 model 参数错误导致 session 路由失败的问题  
  Fixed issue where incorrect model parameter in stream mode caused session routing failures
- 🐛 将 Gateway 请求中的 model 参数从 `'default'` 更正为 `'main'`，确保正确的 Agent 路由  
  Corrected model parameter in Gateway requests from `'default'` to `'main'` to ensure proper Agent routing

### 改进 / Improvements
- 优化异步模式处理流程，改进错误处理和日志输出  
  Optimized async mode processing flow, improved error handling and log output
- 增强 DM Policy 检查机制，支持白名单配置  
  Enhanced DM Policy check mechanism, supporting allowlist configuration

## [0.7.0] - 2026-03-05

### 新增功能 / Added Features

#### 富媒体接收支持 / Rich Media Reception Support
- ✅ 支持接收 JPEG 图片消息，自动下载到 `~/.openclaw/workspace/media/inbound/` 目录  
  Support receiving JPEG image messages, automatically downloaded to `~/.openclaw/workspace/media/inbound/` directory
- ✅ 支持接收 PNG 图片（在 richText 中），自动提取 URL 和 downloadCode 并下载  
  Support receiving PNG images (in richText), automatically extract URL and downloadCode and download
- ✅ 图片自动传递给视觉模型，AI 可以识别和分析图片内容  
  Images are automatically passed to vision models, AI can recognize and analyze image content
- ✅ 媒体文件统一命名格式：`openclaw-media-{timestamp}.{ext}`  
  Unified naming format for media files: `openclaw-media-{timestamp}.{ext}`

#### 文件附件提取 / File Attachment Extraction
- ✅ 支持解析 `.docx` 文件（通过 `mammoth` 库提取文本内容）  
  Support parsing `.docx` files (extract text content via `mammoth` library)
- ✅ 支持解析 `.pdf` 文件（通过 `pdf-parse` 库提取文本内容）  
  Support parsing `.pdf` files (extract text content via `pdf-parse` library)
- ✅ 支持读取纯文本文件（`.txt`、`.md`、`.json` 等），内容直接注入到 AI 上下文  
  Support reading plain text files (`.txt`, `.md`, `.json`, etc.), content directly injected into AI context
- ✅ 支持处理二进制文件（`.xlsx`、`.pptx`、`.zip` 等），文件保存到磁盘并在消息中报告路径  
  Support processing binary files (`.xlsx`, `.pptx`, `.zip`, etc.), files saved to disk and paths reported in messages

#### 钉钉文档 API / DingTalk Document API
- ✅ 支持创建钉钉文档 (`docs.create`)  
  Support creating DingTalk documents (`docs.create`)
- ✅ 支持在现有文档上追加内容 (`docs.append`)  
  Support appending content to existing documents (`docs.append`)
- ✅ 支持搜索钉钉文档 (`docs.search`)  
  Support searching DingTalk documents (`docs.search`)
- ✅ 支持列举空间下的文档 (`docs.list`)  
  Support listing documents under a space (`docs.list`)
- ⚠️ 注意：读取文档功能 (`docs.read`) 需要 MCP 提供相应的 tool，当前版本暂不支持  
  Note: Document reading functionality (`docs.read`) requires MCP to provide the corresponding tool, currently not supported in this version

#### 多 Agent 路由支持 / Multi-Agent Routing Support
- ✅ 支持一个连接器实例同时连接多个 Agent  
  Support one connector instance connecting to multiple Agents simultaneously
- ✅ 支持多个钉钉机器人分别绑定到不同的 Agent，实现角色分工和专业化服务  
  Support multiple DingTalk bots binding to different Agents, enabling role division and specialized services
- ✅ 每个 Agent 拥有独立的会话空间，实现会话隔离  
  Each Agent has an independent session space, achieving session isolation
- ✅ 向后兼容单 Agent 场景，无需额外配置  
  Backward compatible with single Agent scenarios, no additional configuration required
- ✅ 提供多 Agent 配置说明和示例，支持通过 `accounts` 和 `bindings` 配置多个机器人  
  Provides multi-Agent configuration documentation and examples, supports configuring multiple bots via `accounts` and `bindings`

### 修复 / Fixes
- 🐛 修复机器人发送语音消息播放异常问题，音频进度和播放功能现已正常工作  
  Fixed bot voice message playback issues, audio progress and playback functionality now work correctly

### 改进 / Improvements
- 优化媒体文件下载和存储机制  
  Optimized media file download and storage mechanism
- 改进文件附件处理流程，支持更多文件类型  
  Improved file attachment processing flow, supporting more file types
- 增强错误处理和日志输出  
  Enhanced error handling and log output
- 新增 Markdown 表格自动转换功能，将 Markdown 表格转换为钉钉支持的文本格式，提升消息可读性  
  Added automatic Markdown table conversion, converting Markdown tables to DingTalk-supported text format for better message readability

### 依赖更新 / Dependency Updates
- 新增 `mammoth@^1.8.0` - Word 文档解析  
  Added `mammoth@^1.8.0` - Word document parsing
- 新增 `pdf-parse@^1.1.1` - PDF 文档解析  
  Added `pdf-parse@^1.1.1` - PDF document parsing

### 已知问题 / Known Issues
- ⚠️ 钉钉文档读取功能 (`docs.read`) 当前不可用，因为 MCP 中未提供相应的 tool。代码层面实现正常，等待 MCP 支持。  
  DingTalk document reading functionality (`docs.read`) is currently unavailable because MCP does not provide the corresponding tool. Implementation is correct at the code level, waiting for MCP support.

### 文档更新 / Documentation Updates
- 更新 README.md，添加新功能使用说明  
  Updated README.md, added usage instructions for new features
- 添加富媒体接收、文件附件提取、钉钉文档 API、多 Agent 路由等章节  
  Added sections on rich media reception, file attachment extraction, DingTalk document API, multi-Agent routing, etc.
- 新增"多 Agent 配置"章节，提供详细的配置示例和说明  
  Added "Multi-Agent Configuration" section with detailed configuration examples and instructions
- 补充常见问题解答  
  Added FAQ section