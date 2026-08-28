<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>OpenClaw DingTalk Plugin</h1>
  <p>Official DingTalk channel plugin for OpenClaw, developed and maintained by the DingTalk team.<br/>It seamlessly connects your OpenClaw Agent to DingTalk, enabling it to directly send/receive messages, manage docs, calendars, tasks, and more.</p>

  <p>
    <a href="https://www.npmjs.com/package/@dingtalk-real-ai/dingtalk-connector"><img src="https://img.shields.io/npm/v/@dingtalk-real-ai/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@dingtalk-real-ai/dingtalk-connector"><img src="https://img.shields.io/npm/dm/@dingtalk-real-ai/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm downloads" /></a>
    <a href="https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/LICENSE"><img src="https://img.shields.io/github/license/DingTalk-Real-AI/dingtalk-openclaw-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="license" /></a>
  </p>

  <p>
    <a href="README.md">简体中文</a> •
    <a href="CHANGELOG.md">Changelog</a> •
    <a href="https://openclaw.ai/">OpenClaw Website</a>
  </p>
</div>

---

## Features

This plugin provides comprehensive DingTalk integration for OpenClaw:

| Category | Capabilities |
|----------|-------------|
| 📄 Docs | Create, append, search, and list DingTalk documents |
| 🔔 DING | Send urgent DING reminders to users/groups |
| 💬 Messaging | Receive group/DM messages, auto-reply, send text/Markdown, @mentions |
| ✅ Tasks | Create personal tasks, check status, set deadlines |
| 📊 AI Sheets | Create sheets, read/write rows, conditional queries |
| 📅 Calendar | Calendar management, event management (create/query/modify/delete/search), attendee management, free/busy queries |
| 📝 Reports | Submit daily/weekly reports, query history |

Additionally, the plugin supports:

- 🌊 **AI Card Streaming**: Typewriter-style live streaming responses within message cards
- 📱 **Interactive Cards**: Real-time status updates (Thinking/Generating/Complete), confirmation buttons for sensitive operations
- 🔒 **Permission Policies**: Flexible access control policies for DMs and group chats
- ⚙️ **Multi-Agent Routing**: Connect multiple bots to different Agents for specialized services
- 🖼️ **Rich Media**: Receive images/audio/file attachments, auto-upload local images
- 🔄 **Session Management**: Multi-turn conversation context, isolated sessions for DMs/groups

> 🚧 **Coming Soon** — The following capabilities are under active development!

| Category | Capabilities |
|----------|-------------|
| ✅ Tasks | Create group tasks, check status, set deadlines |
| 📁 Drive | Upload/download files to DingTalk Drive |

---

## Security & Risk Warnings (Read Before Use)

This plugin integrates with OpenClaw AI automation capabilities and carries inherent risks such as model hallucinations, unpredictable execution, and prompt injection. After you authorize DingTalk permissions, OpenClaw will act under your user identity within the authorized scope, which may lead to high-risk consequences such as leakage of sensitive data or unauthorized operations. Please use with caution.

To reduce these risks, the plugin enables default security protections at multiple layers. However, these risks still exist. **We strongly recommend that you do not proactively modify any default security settings**; once relevant restrictions are relaxed, the risks will increase significantly, and you will bear the consequences.

We recommend using the DingTalk bot connected to OpenClaw as a **personal conversational assistant**. Avoid deploying it directly in enterprise production environments. If you plan to use it with a company account, please comply with your company's information security policies.

> By using this plugin, you are deemed to have fully understood and voluntarily assumed all related risks and responsibilities.

---

## Requirements & Installation

Before you start, make sure you have:

- **OpenClaw**: Installed and running properly. Visit the [OpenClaw website](https://openclaw.ai/) for details.
- **Version**: OpenClaw ≥ **2026.8.1-beta.3**. Check with `openclaw -v`. This version uses the current plugin SDK and runtime config snapshot API. On older hosts, keep connector 0.8.25 until you upgrade OpenClaw.

> If below this version, upgrade with: `npm install -g openclaw`

### One-Click Install + QR Auth (Recommended)

```bash
npx -y @dingtalk-real-ai/dingtalk-connector install
```

During installation, the terminal will display a DingTalk authorization QR code. Scan it with the **DingTalk mobile app** and tap "Create Bot" to complete authorization.

When you see `Success! Bot configured.`, the authorization is complete. Then restart the Gateway:

```bash
openclaw gateway restart
```

> 💡 **Scan failure does not affect installation**: Even if the QR flow fails, plugin dependencies will still be installed. See [Manual Setup Guide](docs/DINGTALK_MANUAL_SETUP.md) to complete configuration.

---

## Usage Guide

[OpenClaw DingTalk Plugin User Guide](https://alidocs.dingtalk.com/i/nodes/2Amq4vjg89GEno0zfPqoPGqdV3kdP0wQ?utm_scene=team_space)

---

## Advanced Documentation

- [Manual Setup Guide](docs/DINGTALK_MANUAL_SETUP.md) — Configure credentials manually
- [DingTalk DEAP Agent Integration](docs/DEAP_AGENT_GUIDE.en.md) — Local device operation capabilities
- [Multi-Agent Routing](https://gist.github.com/smallnest/c5c13482740fd179e40070e620f66a52) — Bind multiple bots to different Agents
- [Troubleshooting](docs/TROUBLESHOOTING.md) — Installation and usage issue resolution

---

## Feedback & Community

Before filing an Issue / PR, please skim the pinned notice — clear context helps us debug faster:

- English: [[READ FIRST] #585](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/585)
- 中文：[【提 Issue 前必看】#584](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/584)

Quick routing:

- **Other DingTalk product / open-platform capabilities** (outside this connector) → [DingTalk developer ticket center](https://applink.dingtalk.com/client/aiAgent?assistantId=381bb5860c264d33bc184c51db776fa7&from=development)
- **OpenClaw upstream** (gateway, models, channels, etc.) → [openclaw/openclaw Issues](https://github.com/openclaw/openclaw/issues)
- **`dingtalk-workspace-cli` (dws)** (DingTalk workspace CLI behavior) → [dingtalk-workspace-cli Issues](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues)
- **This connector** → [GitHub Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)

---

## Contributing

PRs are welcome — small, well-described changes with clear verification land fastest; for larger changes, please open an Issue first. Doc-style reference: [#514](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/514/changes) · code-style reference: [#581](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/581).

> **Quarterly thanks**: each quarter, the top 3 PR contributors get a small gift or an invite to a DingTalk on-site visit (details per quarterly announcement). Thanks for co-building the community.

---

## License

This project is licensed under the [MIT](LICENSE) License.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)
