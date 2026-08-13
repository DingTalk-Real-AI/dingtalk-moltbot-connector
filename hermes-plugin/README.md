# DingTalk Official for Hermes

This directory is the Hermes Agent plugin form of the DingTalk official
OpenClaw connector.

Hermes already has the core DingTalk Stream adapter, QR registration flow,
media intake, and AI Card support. This plugin registers that adapter through
the Hermes platform-plugin surface and keeps the official connector defaults:

- platform name `dingtalk`, so normal Hermes DingTalk config keeps working
- official AI Card template enabled unless `card_template_id` is overridden
- proactive robot sends to `user` and `group` targets through the
  `dingtalk_official_send` tool
- local image and file upload for Hermes DingTalk adapter replies when the
  current inbound DingTalk context identifies the target
- one plugin skill, `dingtalk-official:dingtalk-dws`, for DingTalk product
  operations through the `dws` CLI

## Install

Copy this directory into the Hermes user plugin directory, then enable it:

```bash
cp -R hermes-plugin ~/.hermes/plugins/dingtalk-official
hermes plugins enable dingtalk-official
```

Install the DingTalk Hermes dependencies if they are not already present:

```bash
pip install "hermes-agent[dingtalk]"
```

## Configure

An env-only setup is enough:

```bash
export DINGTALK_CLIENT_ID="your-app-key"
export DINGTALK_CLIENT_SECRET="your-app-secret"
export DINGTALK_ACCOUNT_ID="main-bot"
export DINGTALK_ALLOWED_USERS="your-sender-or-staff-id"
```

`DINGTALK_ALLOW_ALL_USERS=true` opens Hermes gateway authorization for this
platform and should only be used intentionally. Group behavior can be tuned
with `DINGTALK_REQUIRE_MENTION`, `DINGTALK_ALLOWED_CHATS`,
`DINGTALK_FREE_RESPONSE_CHATS`, and `DINGTALK_MENTION_PATTERNS`.

The plugin seeds the official AI Card template automatically. Keep credentials
in env vars, and override card options in Hermes YAML when another template is
required:

```yaml
platforms:
  dingtalk:
    enabled: true
    extra:
      card_template_id: your-card-template-id
      robot_code: your-robot-code
```

The adapter still falls back to DingTalk session-webhook Markdown replies when
AI Card SDK setup or delivery is unavailable.

## Quiet Chat Mode

DingTalk is usually a real user-facing conversation, so this plugin suppresses
Hermes intermediate activity by default: tool-progress bubbles, terminal command
previews, streaming draft chunks, and interim assistant commentary are not sent
to the chat. Final replies, local images/files, and explicit proactive
`user:`/`group:` targets still send normally.

Turn activity back on while debugging:

```bash
export DINGTALK_SHOW_ACTIVITY=true
```

Or configure it in Hermes YAML:

```yaml
platforms:
  dingtalk:
    enabled: true
    extra:
      suppress_intermediate: false
```

## Official Send Delta

Hermes' built-in DingTalk `send_message` path is a static robot-webhook path.
This plugin adds the official connector's OpenAPI send path separately:

- use the agent tool `dingtalk_official_send` for proactive user or group
  sends
- pass a DingTalk `staff_id` for `target_type=user`; Hermes `sender_id` is
  not a substitute for the proactive robot API
- pass a DingTalk group `openConversationId` for `target_type=group`
- pass `content` for text or Markdown
- pass `file_path` for a local image or regular file upload
- set `file_kind` only when auto-detection should be overridden
- pass `at_accounts`, `at_dingtalk_ids`, `at_user_ids`, or `at_all` when a
  proactive text/Markdown message should visibly mention another bot or user

The platform adapter also accepts explicit proactive chat IDs when a caller is
already on the adapter send path:

```text
user:<dingtalk-user-id>
group:<open-conversation-id>
```

For normal replies to an inbound DingTalk message, Hermes still uses its
session reply and AI Card behavior. If the reply dispatcher emits a local
image, the plugin uploads it and sends the official connector's
`![image](mediaId)` Markdown form through the current `sessionWebhook`.
If it emits a local document, the plugin uploads it and sends a native DingTalk
file message through the current `sessionWebhook`. Explicit `user:` or `group:`
targets still use the proactive robot send path.

The proactive send path defaults `robotCode` to the DingTalk client ID, matching
the official OpenClaw connector. If DingTalk reports that `robotCode` was not
found, configure `DINGTALK_ROBOT_CODE` or
`platforms.dingtalk.extra.robot_code` with the robot code for that app and
verify that the credentials belong to a robot-enabled DingTalk app.

## Multi-Bot Mentions

OpenClaw's full multi-agent mode starts several DingTalk robot accounts and
routes each account to a different Agent through `accounts` and `bindings`.
Hermes currently creates one adapter for the `dingtalk` platform, so this
plugin does not run multiple DingTalk accounts inside one gateway process.

The portable part is bot-to-bot mention resolution. Configure the other bots'
`chatbotUserId` values and aliases, then Hermes can write `@dev-agent` or pass
`at_accounts=["dev-bot"]`; the plugin rewrites the message to DingTalk's
encrypted bot ID and adds `at.atDingtalkIds` on session-webhook replies.

When a bot receives a DingTalk message, the plugin prints its own identity once:

```text
[DingTalk:main-bot] [BotIdentity] accountId=main-bot chatbotUserId=$:LWCP_v1:$... chatbotCorpId=...
```

Use that `chatbotUserId` in the other server's mention config. The agent can
also call `dingtalk_official_mentions` to list configured aliases and missing
IDs before testing a handoff.

```bash
export DINGTALK_BOT_MENTIONS='[
  {
    "account_id": "dev-bot",
    "name": "开发助手",
    "agent_ids": ["dev-agent"],
    "aliases": ["dev"],
    "chatbot_user_id": "$:LWCP_v1:$example"
  }
]'
```

The same structure can live in Hermes YAML:

```yaml
platforms:
  dingtalk:
    enabled: true
    extra:
      bot_mentions:
        - account_id: dev-bot
          name: 开发助手
          agent_ids: [dev-agent]
          aliases: [dev]
          chatbot_user_id: "$:LWCP_v1:$example"
```

You can also copy an OpenClaw-like `accounts` plus `bindings` shape into
`platforms.dingtalk.extra`; `accountId`, `name`, bound `agentId`, and `aliases`
become valid mention names.

## Scope

The Node/OpenClaw channel runtime is not loaded by Hermes. Incoming/outgoing
chat traffic is handled by Hermes' Python DingTalk adapter. DingTalk business
operations such as docs, calendar, todo, reports, AI tables, and DING messages
remain `dws` CLI work and are described by the bundled plugin skill. Native
OpenClaw-style routing of different DingTalk accounts to different Hermes
profiles would require Hermes gateway core support for multiple adapters or
profile routing per platform message.
