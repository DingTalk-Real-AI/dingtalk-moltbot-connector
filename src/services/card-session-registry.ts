/**
 * Card-to-Session 映射注册表
 *
 * 维护 cardInstanceId (outTrackId) → session 信息的内存映射，
 * 使卡片回调（点赞/点踩）能够定位到对应的 session JSONL 文件并追加反馈条目。
 */

import { readFile, appendFile, access, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// ============ 类型定义 ============

export interface CardSessionInfo {
  sessionKey: string;
  agentId: string;
  createdAt: number;
}

export interface RecordFeedbackParams {
  outTrackId: string;
  like: 1 | -1;
  userId: string;
  dislikeReasons?: string[];
  customDislikeReason?: string;
  logger?: { info?: (...args: any[]) => void; warn?: (...args: any[]) => void; error?: (...args: any[]) => void };
}

// ============ 内存注册表 ============

const CARD_SESSION_TTL = 24 * 60 * 60 * 1000; // 24 小时
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 分钟

const cardSessionMap = new Map<string, CardSessionInfo>();

/**
 * 持久化文件路径：${tmpdir}/dingtalk-connector/card-session-map.json
 *
 * 设计说明：
 * - 放在系统临时目录而非 ~/.openclaw，是因为这只是"重启后老卡片反馈兜底"用的缓存，
 *   不属于 OpenClaw 的核心状态；系统对 /tmp 的定期清理也能兜底过期条目。
 * - 使用 lazy 函数而非 module-level 常量，避免在测试中通过 vi.mock("node:os") 替换
 *   homedir/tmpdir 时被模块加载期的求值踩到 hoisting 时序问题。
 */
function getPersistFile(): string {
  return join(tmpdir(), "dingtalk-connector", "card-session-map.json");
}

/** 是否已从文件加载过历史映射 */
let persistLoaded = false;

/**
 * 从文件加载历史映射（进程启动时调用一次）
 */
async function loadFromDisk(): Promise<void> {
  if (persistLoaded) return;
  persistLoaded = true;
  const persistFile = getPersistFile();
  try {
    await access(persistFile);
    const raw = await readFile(persistFile, "utf-8");
    const entries: Record<string, CardSessionInfo> = JSON.parse(raw);
    const now = Date.now();
    let loaded = 0;
    for (const [key, info] of Object.entries(entries)) {
      if (now - info.createdAt <= CARD_SESSION_TTL) {
        cardSessionMap.set(key, info);
        loaded++;
      }
    }
    if (loaded > 0) {
      console.warn(`[CardSession] 从磁盘加载 ${loaded} 条卡片映射（进程重启恢复）`);
    }
  } catch {
    // 文件不存在或解析失败，忽略
  }
}

/**
 * 将当前映射写入磁盘
 */
async function saveToDisk(): Promise<void> {
  const persistFile = getPersistFile();
  try {
    const obj: Record<string, CardSessionInfo> = {};
    for (const [key, info] of cardSessionMap) {
      obj[key] = info;
    }
    await mkdir(dirname(persistFile), { recursive: true });
    await writeFile(persistFile, JSON.stringify(obj), "utf-8");
  } catch (err: any) {
    console.warn(`[CardSession] 持久化写入失败: ${err.message}`);
  }
}

/**
 * 注册 cardInstanceId → session 映射
 */
export function registerCardSession(cardInstanceId: string, info: CardSessionInfo): void {
  cardSessionMap.set(cardInstanceId, info);
  console.warn(`[CardSession] 注册映射: outTrackId=${cardInstanceId}, sessionKey=${info.sessionKey}, agentId=${info.agentId}`);
  // 异步持久化，不阻塞主流程
  saveToDisk().catch(() => {});
}

/**
 * 查找 cardInstanceId 对应的 session 信息
 */
export async function lookupCardSession(cardInstanceId: string): Promise<CardSessionInfo | null> {
  // 首次查找时从磁盘加载历史映射
  await loadFromDisk();
  const result = cardSessionMap.get(cardInstanceId) ?? null;
  if (!result) {
    console.warn(`[CardSession] 查找失败: outTrackId=${cardInstanceId}，当前注册表大小=${cardSessionMap.size}`);
  }
  return result;
}

/**
 * 清理过期条目（超过 24 小时）
 */
export function cleanupExpiredCardSessions(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, info] of cardSessionMap) {
    if (now - info.createdAt > CARD_SESSION_TTL) {
      cardSessionMap.delete(key);
      removed++;
    }
  }
  return removed;
}

// 自动清理定时器（unref 防止阻止进程退出）
const cleanupTimer = setInterval(cleanupExpiredCardSessions, CLEANUP_INTERVAL);
if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

// ============ 反馈写入 ============

/**
 * 将用户反馈追加到 session JSONL 文件
 *
 * 流程：
 * 1. 通过 outTrackId 查找注册表，获取 sessionKey + agentId
 * 2. 读取 ~/.openclaw/agents/{agentId}/sessions/sessions.json 获取 sessionFile
 * 3. 构造 customType: "user-feedback" 条目
 * 4. appendFileSync 追加到 JSONL 文件
 *
 * 此函数永远不会抛出异常（内部 try/catch），调用方无需处理错误。
 */
export async function recordFeedbackToSession(params: RecordFeedbackParams): Promise<boolean> {
  const { outTrackId, like, userId, dislikeReasons, customDislikeReason, logger } = params;

  if (!outTrackId) {
    logger?.warn?.("[CardFeedback] outTrackId 为空，跳过反馈记录");
    return false;
  }

  try {
    // 1. 查找注册表
    const info = await lookupCardSession(outTrackId);
    if (!info) {
      const keysSample = [...cardSessionMap.keys()].slice(0, 5).map(k => k.slice(0, 20) + '...').join(', ');
      logger?.warn?.(`[CardFeedback] 未找到 outTrackId=${outTrackId} 的 session 映射（可能已重启或过期）。注册表 size=${cardSessionMap.size}, keys样本=[${keysSample}]`);
      return false;
    }

    // 2. 读取 sessions.json 获取 sessionFile 路径
    const sessionsJsonPath = join(homedir(), ".openclaw", "agents", info.agentId, "sessions", "sessions.json");
    try {
      await access(sessionsJsonPath);
    } catch {
      logger?.warn?.(`[CardFeedback] sessions.json 不存在: ${sessionsJsonPath}`);
      return false;
    }

    let sessionsStore: Record<string, any>;
    try {
      sessionsStore = JSON.parse(await readFile(sessionsJsonPath, "utf-8"));
    } catch (parseErr: any) {
      logger?.error?.(`[CardFeedback] sessions.json 解析失败: ${parseErr.message}`);
      return false;
    }

    const sessionEntry = sessionsStore[info.sessionKey];
    if (!sessionEntry) {
      logger?.warn?.(`[CardFeedback] sessionKey=${info.sessionKey} 在 sessions.json 中不存在`);
      return false;
    }

    const sessionFile = sessionEntry.sessionFile as string | undefined;
    if (!sessionFile) {
      logger?.warn?.(`[CardFeedback] session 文件路径为空`);
      return false;
    }
    try {
      await access(sessionFile);
    } catch {
      logger?.warn?.(`[CardFeedback] session 文件不存在: ${sessionFile}`);
      return false;
    }

    // 3. 构造反馈 JSONL 条目
    const feedbackData: Record<string, unknown> = {
      like,
      userId,
      cardInstanceId: outTrackId,
      source: "dingtalk-card",
    };
    if (like === -1) {
      if (dislikeReasons && dislikeReasons.length > 0) {
        feedbackData.dislikeReasons = dislikeReasons;
      }
      if (customDislikeReason) {
        feedbackData.customDislikeReason = customDislikeReason;
      }
    }

    const entry = {
      type: "custom",
      customType: "user-feedback",
      data: feedbackData,
      id: randomBytes(4).toString("hex"),
      parentId: null,
      timestamp: new Date().toISOString(),
    };

    // 4. 追加到 session 文件
    // 注意：反馈写入通常发生在会话活跃期结束后（用户先看到回复再点赞/踩），
    // 此时 OpenClaw 通常不再写入该 session 文件，并发冲突概率极低。
    const jsonLine = "\n" + JSON.stringify(entry);
    await appendFile(sessionFile, jsonLine, "utf-8");

    logger?.info?.(`[CardFeedback] 反馈已记录到 session: like=${like}, userId=${userId}, outTrackId=${outTrackId}, file=${sessionFile}`);
    return true;
  } catch (err: any) {
    logger?.error?.(`[CardFeedback] 记录反馈异常: ${err.message}`);
    return false;
  }
}

// ============ 辅助查询 ============

/**
 * 根据发送目标（userId/conversationId）查找最近注册过的 sessionKey
 * 用于 outbound.sendText 路径：该路径无法获得 sessionKey，但可通过
 * 已注册条目的 sessionKey 中的 target 模式匹配来推断。
 *
 * 匹配规则：
 * - 单聊: sessionKey 以 `:${peerId}` 结尾
 * - 群聊: sessionKey 中包含 `:${peerId}:`（群聊会话隔离时 peerId 可能在中段）
 */
export async function guessSessionKeyByTarget(target: string): Promise<{ sessionKey: string; agentId: string } | null> {
  // 确保内存映射已从磁盘加载（进程重启后首次调用）
  await loadFromDisk();

  // 从 target 字符串提取 peerId（去掉 user:/group: 前缀）
  const peerId = target.replace(/^(user|group):/, '');

  // 两阶段匹配：优先使用 endsWith 严格匹配，无结果时退化到 includes
  const candidates: { sessionKey: string; agentId: string; createdAt: number }[] = [];
  const looseCandidates: { sessionKey: string; agentId: string; createdAt: number }[] = [];

  for (const [, info] of cardSessionMap) {
    // sessionKey 格式: agent:{agentId}:{channel}:{peerKind}:{peerId}
    // 群聊会话隔离时: agent:{agentId}:{channel}:group:{conversationId}:{senderId}
    if (info.sessionKey.endsWith(`:${peerId}`)) {
      candidates.push({ sessionKey: info.sessionKey, agentId: info.agentId, createdAt: info.createdAt });
    } else if (info.sessionKey.includes(`:${peerId}:`)) {
      looseCandidates.push({ sessionKey: info.sessionKey, agentId: info.agentId, createdAt: info.createdAt });
    }
  }

  // 选择候选集：优先严格匹配
  const pool = candidates.length > 0 ? candidates : looseCandidates;

  // 安全检查：候选集中若存在多个不同 sessionKey，放弃推断（避免跨用户串话）
  const uniqueSessionKeys = new Set(pool.map(c => c.sessionKey));
  if (uniqueSessionKeys.size > 1) {
    console.warn(`[CardSession] guessSessionKeyByTarget: target=${target} 存在 ${uniqueSessionKeys.size} 个候选 sessionKey，放弃推断（避免跨用户串话）。candidates=${[...uniqueSessionKeys].map(k => k.slice(0, 40) + '...').join(', ')}`);
    return null;
  }

  // 从唯一候选中选最新的
  let bestMatch: { sessionKey: string; agentId: string; createdAt: number } | null = null;
  for (const c of pool) {
    if (!bestMatch || c.createdAt > bestMatch.createdAt) {
      bestMatch = c;
    }
  }

  if (bestMatch) {
    console.warn(`[CardSession] guessSessionKeyByTarget: target=${target} → sessionKey=${bestMatch.sessionKey} (candidates=${pool.length}, registry=${cardSessionMap.size})`);
  }
  return bestMatch ? { sessionKey: bestMatch.sessionKey, agentId: bestMatch.agentId } : null;
}

// 导出常量供测试使用
export { CARD_SESSION_TTL, CLEANUP_INTERVAL };
// 导出 Map 引用供测试清理
export function _getRegistryForTesting(): Map<string, CardSessionInfo> {
  return cardSessionMap;
}
