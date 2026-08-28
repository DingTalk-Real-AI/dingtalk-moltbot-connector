<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>OpenClaw DingTalk/钉钉 插件</h1>
  <p>钉钉官方出品的 OpenClaw 钉钉 Channel 插件，将你的 OpenClaw Agent 无缝连接到钉钉，<br/>赋予其直接收发消息、操作文档、管理日程、协同待办等能力。</p>

  <p>
    <a href="https://www.npmjs.com/package/@dingtalk-real-ai/dingtalk-connector"><img src="https://img.shields.io/npm/v/@dingtalk-real-ai/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@dingtalk-real-ai/dingtalk-connector"><img src="https://img.shields.io/npm/dm/@dingtalk-real-ai/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm downloads" /></a>
    <a href="https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/LICENSE"><img src="https://img.shields.io/github/license/DingTalk-Real-AI/dingtalk-openclaw-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="license" /></a>
  </p>

  <p>
    <a href="README.en.md">English</a> •
    <a href="CHANGELOG.md">更新日志</a> •
    <a href="https://openclaw.ai/">OpenClaw 官网</a>
  </p>
</div>

---

## 特性

本插件为 OpenClaw 提供全面的钉钉集成能力：

| 类别 | 能力 |
|------|------|
| 📄 钉钉文档 | 创建、追加、搜索、列举钉钉文档 |
| 🔔 DING 消息 | 向用户/群发送强提醒 DING |
| 💬 消息收发 | 接收群聊/私聊消息，自动回复，发送文本/Markdown，@成员 |
| ✅ 待办任务 | 创建个人待办，查状态，设截止时间 |
| 📊 AI 表格 | 创建表格，读写行数据，条件查询 |
| 📅 日历日程 | 日历管理、日程管理（创建/查询/修改/删除/搜索）、参会人管理、忙闲查询 |
| 📝 日志 | 提交日报/周报，查历史日志 |

此外，插件还支持：

- 🌊 **AI Card 流式响应**：打字机效果，在消息卡片中实时流式显示回复
- 📱 **交互式卡片**：实时状态更新（思考中/生成中/完成），敏感操作确认按钮
- 🔒 **权限策略**：为私聊和群聊提供灵活的访问控制策略
- ⚙️ **多 Agent 路由**：将多个机器人连接到不同 Agent，实现专业化服务
- 🖼️ **富媒体处理**：接收图片/音频/文件附件，自动上传本地图片
- 🔄 **会话管理**：多轮对话上下文保持，私聊/群聊会话隔离

> 🚧 **Coming Soon** — 以下能力正在开发中，敬请期待！

| 类别 | 能力 |
|------|------|
| ✅ 待办任务 | 创建群待办，查状态，设截止时间 |
| 📁 文件云盘 | 上传/下载文件到钉钉云盘 |

---

## 安全与风险提示（使用前必读）

本插件对接 OpenClaw AI 自动化能力，存在模型幻觉、执行不可控、提示词注入等固有风险。授权钉钉权限后，OpenClaw 将以你的用户身份在授权范围内执行操作，可能导致敏感数据泄露或越权操作等高风险后果，请谨慎使用。

为降低风险，插件已在多个层面启用默认安全保护，但风险仍然存在。**我们强烈建议不要主动修改任何默认安全配置**；一旦放开相关限制，风险将显著提高，后果需由你自行承担。

建议将接入 OpenClaw 的钉钉机器人作为**个人对话助手**使用，避免在企业生产环境中直接部署。若需在公司账号中使用，请遵守公司信息安全规范。

> 使用本插件即视为你已充分知悉并自愿承担所有相关风险与责任。

---

## 安装与要求

开始之前，请确保：

- **OpenClaw**：已安装并正常运行。详情请访问 [OpenClaw 官网](https://openclaw.ai/)
- **版本要求**：OpenClaw ≥ **2026.8.1-beta.3**，通过 `openclaw -v` 查看。本版本使用新的插件 SDK 和运行时配置快照；旧版宿主请继续使用插件 0.8.25，升级宿主后再升级插件。

> 如低于此版本，执行 `npm install -g openclaw` 升级。

### 一键安装 + 扫码授权（推荐）

```bash
npx -y @dingtalk-real-ai/dingtalk-connector install
```

安装过程中终端会显示钉钉授权二维码，使用**钉钉手机 App** 扫码，点击「一键创建新机器人」即可完成授权。

看到 `Success! Bot configured.` 即表示授权完成。之后重启 Gateway：

```bash
openclaw gateway restart
```

> 💡 扫码失败不影响安装：即使扫码流程出现问题（如超时、二维码无法显示等），插件本身仍会正常安装。你可以稍后参考 [手动配置指南](docs/DINGTALK_MANUAL_SETUP.md) 完成凭证配置。

---

## 使用指南

[OpenClaw 钉钉官方插件使用指南](https://alidocs.dingtalk.com/i/nodes/2Amq4vjg89GEno0zfPqoPGqdV3kdP0wQ?utm_scene=team_space)

---

## 进阶文档

- [手动配置指南](docs/DINGTALK_MANUAL_SETUP.md) — 手动填写凭证配置
- [钉钉 DEAP Agent 集成](docs/DEAP_AGENT_GUIDE.md) — 本地设备操作能力
- [多 Agent 路由配置](docs/MULTI_AGENT_SETUP.md) — 多机器人绑定不同 Agent（从零配置、完整示例、协作模式）
- [常见问题](docs/TROUBLESHOOTING.md) — 安装与使用问题排查

---

## 反馈与社区

提 Issue / PR 前，建议先看一眼置顶说明（信息完整能帮我们更快定位问题）：

- 中文：[【提 Issue 前必看】#584](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/584)
- English: [[READ FIRST] #585](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/585)

简要分流：

- **钉钉其他业务能力**（非本 connector 范畴）→ [钉钉开发者侧工单入口](https://applink.dingtalk.com/client/aiAgent?assistantId=381bb5860c264d33bc184c51db776fa7&from=development)
- **OpenClaw 本体**（网关、模型、多通道等）→ [openclaw/openclaw Issues](https://github.com/openclaw/openclaw/issues)
- **dws（钉钉工作空间 CLI）** → [dingtalk-workspace-cli Issues](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues)
- **本仓库 connector** → [GitHub Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)

---

## 贡献

欢迎提交 Pull Request：改动越小、描述与验证步骤越清晰，越容易合入；较大改动建议先开 Issue 同步。文档类参考 [#514](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/514/changes)，代码类参考 [#581](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/581)。

> **季度致谢**：每个季度对 PR 贡献量居前 3 位的伙伴提供小礼品或钉钉参观交流机会（细则以当季公告为准），感谢大家对社区共建的支持。

---

## 许可证

本项目基于 [MIT](LICENSE) 许可证。

---

## 支持

- **问题反馈**：[GitHub Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)
- **更新日志**：[CHANGELOG.md](CHANGELOG.md)
