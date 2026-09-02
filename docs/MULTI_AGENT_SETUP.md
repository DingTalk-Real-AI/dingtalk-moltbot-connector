# Connector 插件配置多 Agent — 辅助文档 2.0

> [dingtalk-connector GitHub 官网](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector)

## 一、实操：从零配置多 Agent

### 前提条件

- OpenClaw 已安装且正常运行（本文配置示例使用 OpenClaw 2026.8.1 的 `agents.entries` 格式）
- 已有一个可用的钉钉机器人（作为第一个 Agent）

### Step 1：在钉钉开放平台创建新机器人

[手动创建机器人](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/docs/DINGTALK_MANUAL_SETUP.md)

### Step 2：创建 Agent 配置目录

每个 Agent 使用独立的工作空间。将人格说明写入工作空间的 `SOUL.md`，操作说明写入 `AGENTS.md`。

```bash
# 创建 Agent 目录
mkdir -p ~/.openclaw/workspace-dev-agent

# 写入 systemPrompt（这是 Agent 的"人格定义"）
cat > ~/.openclaw/workspace-dev-agent/SOUL.md << 'EOF'
你是一个开发助手，擅长代码审查、技术方案设计和 Bug 排查。
回复时请在第一行加上标识：🔵 [Dev Agent]
EOF
```

> 💡 **建议**：给每个 Agent 的 systemPrompt 加上明显不同的标识（如 emoji + 名称），方便测试时一眼区分回复来自哪个 Agent。

### Step 3：编辑 openclaw.json

编辑 `~/.openclaw/openclaw.json`，需要修改三个部分：

#### 3.1 注册 Agent（agents.entries）

```jsonc
"agents": {
  "ownership": "explicit",
  "entries": {
    "main": {},
    "dev-agent": {
      "name": "开发助手",
      "workspace": "/Users/你的用户名/.openclaw/workspace-dev-agent"
    }
  }
}
```

#### 3.2 注册机器人账号（channels.dingtalk-connector.accounts）

将**所有机器人**都放到 `accounts` 里，每个 key 是你自定义的账号名：

```jsonc
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "accounts": {
      "main-bot": {
        "enabled": true,
        "name": "主机器人",
        "clientId": "原有机器人的AppKey",
        "clientSecret": "原有机器人的AppSecret"
      },
      "dev-bot": {
        "enabled": true,
        "name": "开发助手机器人",
        "clientId": "新机器人的AppKey（Step 1 获取）",
        "clientSecret": "新机器人的AppSecret（Step 1 获取）"
      }
    }
  }
}
```

> **关于顶层 `clientId` / `clientSecret` 是否保留：**
>
> - **单机器人场景（未配置 `accounts`）**：**必须保留**。框架直接读取顶层凭证启动唯一的机器人，这是最简配置。
> - **多机器人场景（已配置 `accounts`）**：**建议删除**。一旦配置了 `accounts`，框架**只会启动 `accounts` 里列出的机器人**，顶层凭证不再作为独立账号启动。如果某个 account 省略了 `clientId`/`clientSecret`，会从顶层继承（fallback），但这容易造成误解（"为什么删了 account 里的凭证还能连上？"）。**推荐做法**：每个 account 都写明自己的凭证，删除顶层的 `clientId`/`clientSecret`，避免歧义。
>
> ⚠️ **重要**：一旦配置了 `accounts`，原来顶层的 `clientId`/`clientSecret` 不再自动作为独立账号启动，必须也放进 `accounts` 里才会被启动。

#### 3.3 绑定机器人到 Agent（bindings）

通过 `accountId` 将每个机器人绑定到对应的 Agent：

路由由 OpenClaw 的 `resolveAgentRoute` 决定。精确的群/用户绑定优先于账号级绑定，`accountId: "*"` 匹配所有账号，省略 `accountId` 只匹配默认账号。账号名称保留大小写；`default` 和 `__default__` 表示默认账号。显式多 Agent 配置必须为机器人提供绑定，插件不会回退到硬编码的 `main`。

会话仍遵循插件的 `groupSessionScope`、`sharedMemoryAcrossConversations` 和 `session.dmScope` 设置；绑定匹配使用真实群/用户 ID，OpenClaw Host 按最终 SessionKey 管理队列与中断。

```jsonc
"bindings": [
  {
    "agentId": "main",
    "match": {
      "channel": "dingtalk-connector",
      "accountId": "main-bot"
    }
  },
  {
    "agentId": "dev-agent",
    "match": {
      "channel": "dingtalk-connector",
      "accountId": "dev-bot"
    }
  }
]
```

**效果**：`main-bot` 收到的所有消息（无论群聊还是单聊）都路由到 `main` Agent，`dev-bot` 收到的所有消息都路由到 `dev-agent`。

### Step 4：重启 OpenClaw

```bash
openclaw gateway restart
```

### Step 5：验证

查看启动日志，确认两个机器人都成功连接：

```bash
tail -f ~/.openclaw/logs/gateway.log | grep dingtalk
```

应该看到：

```plaintext
[dingtalk-connector] starting dingtalk-connector[dev-bot] (mode: stream, ...)
[dingtalk-connector] starting dingtalk-connector[main-bot] (mode: stream, ...)
```

如果看到 `auto-restart attempt` 或 `Authentication failed (401)`，说明 clientId/clientSecret 不正确或机器人未开启 Stream 模式，请回到 Step 1 检查。

### Step 6：测试

将两个机器人都拉入同一个群聊，分别 @它们发消息：

| 操作 | 预期结果 |
| --- | --- |
| @主机器人 "你是谁" | 回复来自 main Agent |
| @开发助手机器人 "你是谁" | 回复带 🔵 [Dev Agent] 标识 |

---

## 二、完整配置示例

以下是一个包含 3 个机器人 × 3 个 Agent 的完整配置：

```jsonc
{
  "agents": {
    "defaults": {
      "model": { "primary": "bailian/qwen3.5-plus" }
    },
    "ownership": "explicit",
    "entries": {
      "main": {},
      "dev-agent": {
        "name": "开发助手",
        "workspace": "~/.openclaw/workspace-dev-agent"
      },
      "pm-agent": {
        "name": "项目经理",
        "workspace": "~/.openclaw/workspace-pm-agent"
      }
    }
  },
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "accounts": {
        "main-bot": {
          "enabled": true,
          "name": "通用助手",
          "clientId": "ding_main_appkey",
          "clientSecret": "main_app_secret"
        },
        "dev-bot": {
          "enabled": true,
          "name": "开发助手机器人",
          "clientId": "ding_dev_appkey",
          "clientSecret": "dev_app_secret"
        },
        "pm-bot": {
          "enabled": true,
          "name": "项目经理机器人",
          "clientId": "ding_pm_appkey",
          "clientSecret": "pm_app_secret"
        }
      }
    }
  },
  "bindings": [
    { "agentId": "main",      "match": { "channel": "dingtalk-connector", "accountId": "main-bot" } },
    { "agentId": "dev-agent",  "match": { "channel": "dingtalk-connector", "accountId": "dev-bot" } },
    { "agentId": "pm-agent",   "match": { "channel": "dingtalk-connector", "accountId": "pm-bot" } }
  ]
}
```

---

## 三、协作模式：多 Agent 信息接力

当多个 Agent 在同一个群里时，它们可以通过**钉钉文档**进行异步协作——Agent A 写入文档，Agent B 读取文档，实现"信息接力"。

### 3.1 协作工具

| 工具 | 作用 |
| --- | --- |
| `docs.create` | 创建协作文档（协作起点） |
| `docs.append` | 追加处理进度或中间产物 |
| `docs.read` | 读取协作文档的最新内容 |

### 3.2 协作场景示例

```plaintext
用户 @项目经理机器人："帮我整理一下本周的需求清单"
  └─ pm-agent 调用 docs.create 创建《本周需求清单.md》
  └─ pm-agent 在群里回复文档链接

用户 @开发助手机器人："看看需求清单，给出技术方案"
  └─ dev-agent 调用 docs.read 读取需求清单
  └─ dev-agent 调用 docs.append 追加技术方案
  └─ dev-agent 在群里回复方案摘要
```

### 3.3 跨 Agent 消息推送

通过 Gateway Methods，一个 Agent 可以主动向其他群/用户发送消息：

```plaintext
运维 Agent 检测到异常
  └─ 调用 gateway.call('dingtalk-connector.sendToGroup', { ... })
  └─ 向"紧急处理群"发送报警
  └─ 该群的值班 Agent 自动接收并开始处理
```

---

## 四、每个 Account 的独立配置

每个 account 可以独立覆盖以下配置（不配则继承顶层默认值）：

| 配置项 | 说明 | 示例 |
| --- | --- | --- |
| `dmPolicy` | 单聊策略 | `"open"` / `"allowlist"` |
| `groupPolicy` | 群聊策略 | `"open"` / `"allowlist"` / `"disabled"` |
| `requireMention` | 群聊是否需要 @机器人 | `true` / `false` |
| `systemPrompt` | 系统提示词 | `"你是一个代码专家"` |
| `asyncMode` | 异步模式 | `true` / `false` |
| `groupSessionScope` | 群聊会话隔离 | `"group"` / `"group_sender"` |

示例：让 dev-bot 在群聊中不需要 @就能响应：

```jsonc
"accounts": {
  "dev-bot": {
    "clientId": "...",
    "clientSecret": "...",
    "requireMention": false
  }
}
```

---

## 五、常见问题

### Q1：机器人连接失败，日志显示 `Authentication failed (401)`

**原因**：clientId 或 clientSecret 不正确，或机器人未开启 Stream 模式。

**解决**：

1. 去钉钉开放平台确认 AppKey/AppSecret 是否正确
2. 确认消息接收模式是 **Stream 模式**
3. 确认机器人已**发布上线**（不是"开发中"状态）

### Q2：配置了 accounts 后，原来的机器人不工作了

**原因**：一旦配置了 `accounts`，框架只启动 `accounts` 里的机器人。顶层的 clientId/clientSecret 变成了基础默认值，不再作为独立账号启动。

**解决**：把原来的机器人也加到 `accounts` 里。

### Q3：同一个群里两个机器人，怎么确保消息不会路由错？

**原理**：每个机器人维护独立的 WebSocket 连接。用户 @机器人A 时，只有机器人A 收到消息（accountId = A 的 key），bindings 中 `accountId` 匹配确保路由到正确的 Agent。两个机器人之间完全隔离，不会串。

### Q4：如何获取群聊的 conversationId（CID）？

在群聊中 @任意已连接的机器人，发送任意消息。开启 `debug: true` 后，从日志中可以看到：

```plaintext
处理消息: accountId=xxx, data= { "conversationId": "cidXXXXX", ... }
```

或者直接在群里问机器人"当前群的 conversationId 是什么"。

---

## 六、后续的改进方向

后续将优化为**通过命令行的形式配置多 Agent**，而**非用户自己去改相应的配置文件**。

connector 优化 ing，后续将提供更简便的多 Agent 配置方式，有问题请提 [Issue](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues) 😍
