// 类型定义
interface ClawdbotConfig {
  [key: string]: any;
}

interface ToolPolicy {
  allow?: string[];
  deny?: string[];
}
import { resolveDingtalkAccount } from "./config/accounts.ts";

export function resolveDingtalkGroupToolPolicy(params: {
  cfg: ClawdbotConfig;
  groupId?: string | null;
  accountId?: string | null;
}): ToolPolicy | undefined {
  const { cfg, groupId, accountId } = params;

  const account = resolveDingtalkAccount({ cfg, accountId });
  const dingtalkCfg = account.config;

  // Check group-specific policy first
  if (groupId) {
    const groupConfig = dingtalkCfg?.groups?.[groupId];
    if (groupConfig?.tools) {
      return groupConfig.tools;
    }
  }

  // Fall back to account-level default (allow all)
  return { allow: ["*"] };
}

import { DEFAULT_ALLOWED_COMMANDS, DEFAULT_COMMAND_BLOCK_MESSAGE } from "./utils/constants.ts";

/**
 * Command policy configuration interface
 */
export interface CommandPolicy {
  mode?: 'open' | 'allowlist' | 'denylist';
  allow?: string[];
  deny?: string[];
  blockMessage?: string;
}

/**
 * 检查消息是否符合命令策略
 * @param text - 用户输入的消息
 * @param policy - 命令策略配置
 * @returns { isAllowed: boolean; blockMessage?: string } - 是否允许及拦截消息
 *
 * 注意：仅对以 / 开头的命令进行过滤，普通消息（不以 / 开头）直接放行
 */
export function checkCommandPolicy(
  text: string,
  policy?: CommandPolicy
): { isAllowed: boolean; blockMessage?: string } {
  const trimmed = text.trim();
  const lowerTrimmed = trimmed.toLowerCase();

  // 空消息允许通过
  if (!trimmed) {
    return { isAllowed: true };
  }

  // 非命令消息（不以 / 开头）直接放行，不做过滤
  if (!trimmed.startsWith('/')) {
    return { isAllowed: true };
  }

  // 默认策略：open（允许所有）
  const mode = policy?.mode ?? 'open';

  // open 模式：允许所有命令
  if (mode === 'open') {
    return { isAllowed: true };
  }

  // allowlist 模式：只允许列表中的命令
  if (mode === 'allowlist') {
    const allowedCommands = policy?.allow?.length
      ? policy.allow.filter(cmd => cmd.startsWith('/'))
      : DEFAULT_ALLOWED_COMMANDS.filter(cmd => cmd.startsWith('/'));

    const isAllowed = allowedCommands.some(
      cmd => lowerTrimmed === cmd.toLowerCase()
    );

    if (!isAllowed) {
      return {
        isAllowed: false,
        blockMessage: policy?.blockMessage || DEFAULT_COMMAND_BLOCK_MESSAGE,
      };
    }
    return { isAllowed: true };
  }

  // denylist 模式：禁止列表中的命令
  if (mode === 'denylist') {
    const deniedCommands = (policy?.deny ?? []).filter(cmd => cmd.startsWith('/'));

    const isDenied = deniedCommands.some(
      cmd => lowerTrimmed === cmd.toLowerCase()
    );

    if (isDenied) {
      return {
        isAllowed: false,
        blockMessage:
          policy?.blockMessage ||
          `抱歉，该命令已被禁用。如需帮助，请联系管理员。`,
      };
    }
    return { isAllowed: true };
  }

  return { isAllowed: true };
}
