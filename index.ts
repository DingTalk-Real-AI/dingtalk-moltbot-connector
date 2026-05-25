/**
 * DingTalk Connector Plugin for OpenClaw
 *
 * 钉钉企业内部机器人插件，使用 Stream 模式连接，支持 AI Card 流式响应。
 * 已迁移到 OpenClaw SDK，支持多账号、安全策略等完整功能。
 * 
 * Last updated: 2026-03-24
 */

/**
 * DingTalk Connector Plugin for OpenClaw
 * 
 * 注意：本插件使用专用的 HTTP 客户端（见 src/utils/http-client.ts）
 * 不会影响 OpenClaw Gateway 和其他插件的网络请求
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { dingtalkPlugin, initDingtalkPluginConfigSchema } from "./src/channel.ts";
import { setDingtalkRuntime } from "./src/runtime.ts";
import { registerGatewayMethods } from "./src/gateway-methods.ts";

export { dingtalkPlugin, initDingtalkPluginConfigSchema } from "./src/channel.ts";
export { setDingtalkRuntime } from "./src/runtime.ts";
export { registerGatewayMethods } from "./src/gateway-methods.ts";

/**
 * 检测同一 plugin id 在多个路径被加载的情况。
 *
 * 典型场景：`openclaw.json` 里配了本地 `plugins.load.paths`（开发源码），同时 `~/.openclaw/extensions/dingtalk-connector`
 * 也装了 npm 全局扩展，两份 dist/index.mjs 都被 gateway 加载 → 两份 stream 订阅互相抢占，
 * 表现就是"消息时而能收到，时而收不到 / 回复丢失"。
 *
 * 这里做一个轻量自检：
 * - 把当前 index.mjs 的绝对路径写入全局 Symbol 表
 * - 同名 plugin id 被第二次注册时打印警告（或在 `DINGTALK_STRICT_DUPLICATE_LOAD=1` 时直接抛错）
 *
 * 作为运行时兜底，建议同时在 `openclaw.json` 只保留一条加载路径。
 */
const DUPLICATE_LOAD_SYMBOL = Symbol.for("@dingtalk-connector/loaded-paths");

function recordAndCheckLoadPath(api: OpenClawPluginApi): void {
  try {
    const g = globalThis as any;
    const store: Map<string, Set<string>> = g[DUPLICATE_LOAD_SYMBOL] ?? new Map();
    g[DUPLICATE_LOAD_SYMBOL] = store;

    const pluginId = "dingtalk-connector";
    // import.meta.url 在 ESM 下指向当前 index.mjs 路径，正好是我们要比较的维度
    const here = typeof import.meta !== "undefined" && import.meta?.url ? String(import.meta.url) : "<unknown>";
    const paths = store.get(pluginId) ?? new Set<string>();
    paths.add(here);
    store.set(pluginId, paths);

    if (paths.size > 1) {
      const list = Array.from(paths).join("\n  - ");
      const msg =
        `[dingtalk-connector] 检测到同 plugin id 被多个路径加载:\n  - ${list}\n` +
        `这会导致 stream 回调互相抢占、消息丢失。请在 openclaw.json 里只保留一条加载方式：\n` +
        `  • 本地开发：保留 plugins.load.paths，删除 ~/.openclaw/extensions/dingtalk-connector\n` +
        `  • 生产：只保留 extensions 安装目录，删除 plugins.load.paths 里对本地仓库的引用`;
      if (process.env.DINGTALK_STRICT_DUPLICATE_LOAD === "1") {
        throw new Error(msg);
      }
      api.logger?.warn?.(msg);
    }
  } catch (err) {
    if (process.env.DINGTALK_STRICT_DUPLICATE_LOAD === "1") throw err;
  }
}

export default function register(api: OpenClawPluginApi) {
  recordAndCheckLoadPath(api);
  setDingtalkRuntime(api.runtime);
  initDingtalkPluginConfigSchema();
  api.registerChannel({ plugin: dingtalkPlugin });
  registerGatewayMethods(api);
  
  // 添加全局未处理 Promise Rejection 处理器，防止认证错误导致进程崩溃
  process.on('unhandledRejection', (reason: any) => {
    if (reason?.message?.includes('Authentication failed') || 
        reason?.message?.includes('401') ||
        reason?.message?.includes('Bad Request (400)')) {
      console.error(
        '[dingtalk-connector] ⚠️ 认证错误，避免无限重启循环。' +
        '请检查配置后手动重启。'
      );
      // 不抛出，让进程继续运行
      return;
    }
    // 其他未处理的 rejection 继续传播
    console.error('[dingtalk-connector] Unhandled Promise Rejection:', reason);
  });
}
