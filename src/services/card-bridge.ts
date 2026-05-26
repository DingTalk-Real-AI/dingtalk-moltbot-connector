import type { ClawdbotConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { resolveDingtalkAccount } from "../config/accounts.ts";
import type { DingtalkConfig } from "../types/index.ts";
import {
  createAICardForTarget,
  finishAICard,
  streamAICard,
  type AICardInstance,
  type AICardTarget,
} from "./messaging/card.ts";

export const DINGTALK_CARD_BRIDGE_SYMBOL = Symbol.for("@dingtalk-connector/card-bridge");

const CARD_RECORD_TTL_MS = 24 * 60 * 60 * 1000;
const CARD_RECORD_MAX_SIZE = 10_000;
const CARD_RECORD_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_FAILED_CARD_MARKDOWN = "Task failed";
const TARGET_ID_MAX_LENGTH = 256;
const TARGET_ID_DANGEROUS_CHARS_PATTERN = /[<>"\x00-\x1f\x7f]/;

type LoggerLike = {
  debug?: (message: string) => void;
  error?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

type CardRecord = {
  card: AICardInstance;
  config: DingtalkConfig;
  lastUsedAt: number;
  queue: Promise<unknown>;
};

export type CardUpdateStatus = "running" | "completed" | "failed";

export type CardCreateParams = {
  cfg?: ClawdbotConfig;
  accountId?: string;
  target: string;
  markdown?: string;
  log?: LoggerLike;
};

export type CardUpdateParams = {
  cardInstanceId: string;
  markdown?: string;
  status?: CardUpdateStatus;
  log?: LoggerLike;
};

export type DingtalkCardBridge = {
  create(params: CardCreateParams): Promise<{
    cardInstanceId: string;
    accountId: string;
    target: string;
  }>;
  update(params: CardUpdateParams): Promise<{
    cardInstanceId: string;
    status: CardUpdateStatus;
  }>;
};

const cards = new Map<string, CardRecord>();
let cleanupTimerInstalled = false;

class PublicError extends Error {}

function nowMs(): number {
  return Date.now();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

function publicErrorMessage(err: unknown, fallback: string): string {
  return err instanceof PublicError ? err.message : fallback;
}

function isValidTargetId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= TARGET_ID_MAX_LENGTH &&
    !TARGET_ID_DANGEROUS_CHARS_PATTERN.test(value)
  );
}

function parseCardTarget(target: unknown): AICardTarget | null {
  if (typeof target !== "string") return null;
  const raw = target.trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (lowered.startsWith("user:")) {
    const userId = raw.slice("user:".length).trim();
    return isValidTargetId(userId) ? { type: "user", userId } : null;
  }
  if (lowered.startsWith("group:")) {
    const openConversationId = raw.slice("group:".length).trim();
    return isValidTargetId(openConversationId) ? { type: "group", openConversationId } : null;
  }
  if (raw.startsWith("cid") && isValidTargetId(raw)) {
    return { type: "group", openConversationId: raw };
  }
  return null;
}

function targetToString(target: AICardTarget): string {
  return target.type === "user" ? `user:${target.userId}` : `group:${target.openConversationId}`;
}

function normalizeStatus(value: unknown): CardUpdateStatus {
  if (value === "completed" || value === "failed") return value;
  return "running";
}

function cleanupExpiredCards(log?: LoggerLike, timestamp = nowMs()): number {
  let removed = 0;
  for (const [cardInstanceId, record] of cards) {
    if (timestamp - record.lastUsedAt > CARD_RECORD_TTL_MS) {
      cards.delete(cardInstanceId);
      removed += 1;
    }
  }
  if (removed > 0) {
    log?.info?.(`[DingTalk][CardBridge] cleaned expired cards count=${removed}`);
  }
  return removed;
}

function evictOverflowCards(log?: LoggerLike): number {
  const overflow = cards.size - CARD_RECORD_MAX_SIZE;
  if (overflow <= 0) return 0;

  const oldest = [...cards.entries()]
    .sort(([, a], [, b]) => a.lastUsedAt - b.lastUsedAt)
    .slice(0, overflow);

  for (const [cardInstanceId] of oldest) {
    cards.delete(cardInstanceId);
  }
  log?.warn?.(`[DingTalk][CardBridge] evicted old cards count=${oldest.length}`);
  return oldest.length;
}

function ensureCleanupTimerInstalled(): void {
  if (cleanupTimerInstalled) return;
  const cleanupTimer = setInterval(() => {
    cleanupExpiredCards();
  }, CARD_RECORD_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
  cleanupTimerInstalled = true;
}

function rememberCard(card: AICardInstance, config: DingtalkConfig, log?: LoggerLike): CardRecord {
  cleanupExpiredCards(log);
  const timestamp = nowMs();
  const record: CardRecord = {
    card,
    config,
    lastUsedAt: timestamp,
    queue: Promise.resolve(),
  };
  cards.set(card.cardInstanceId, record);
  evictOverflowCards(log);
  return record;
}

async function loadRuntimeConfig(
  api: OpenClawPluginApi,
  cfg?: ClawdbotConfig,
): Promise<ClawdbotConfig> {
  if (cfg) return cfg;
  const apiConfig = (api as OpenClawPluginApi & { config?: ClawdbotConfig }).config;
  if (apiConfig) return apiConfig;
  const { loadConfig } = await import("openclaw/plugin-sdk/config-runtime");
  return loadConfig() as ClawdbotConfig;
}

function getCardRecord(cardInstanceId: string): CardRecord {
  const record = cards.get(cardInstanceId);
  if (!record) throw new PublicError(`Unknown cardInstanceId: ${cardInstanceId}`);
  record.lastUsedAt = nowMs();
  return record;
}

function resolveAccountConfig(
  cfg: ClawdbotConfig,
  accountId: unknown,
  log: LoggerLike | undefined,
  method: string,
) {
  const account = resolveDingtalkAccount({
    cfg,
    accountId: typeof accountId === "string" ? accountId : undefined,
  });
  if (!account.enabled || !account.configured) {
    throw new PublicError("DingTalk not configured");
  }
  log?.debug?.(`[DingTalk][CardBridge][${method}] using accountId=${account.accountId}`);
  return account;
}

async function createCard(params: {
  cfg: ClawdbotConfig;
  accountId?: string;
  target: AICardTarget;
  markdown?: string;
  log?: LoggerLike;
}) {
  const account = resolveAccountConfig(params.cfg, params.accountId, params.log, "card.create");
  const card = await createAICardForTarget(account.config, params.target, params.log);
  if (!card) throw new PublicError("Failed to create DingTalk AI Card");
  rememberCard(card, account.config, params.log);
  try {
    if (params.markdown) {
      await streamAICard(card, params.markdown, false, account.config, params.log);
    }
  } catch (err) {
    cards.delete(card.cardInstanceId);
    throw err;
  }
  params.log?.info?.(`[DingTalk][CardBridge][card.create] created cardInstanceId=${card.cardInstanceId}`);
  return {
    cardInstanceId: card.cardInstanceId,
    accountId: account.accountId,
    target: targetToString(params.target),
  };
}

async function updateCard(params: {
  cardInstanceId: string;
  markdown: string;
  status?: CardUpdateStatus;
  log?: LoggerLike;
}) {
  const record = getCardRecord(params.cardInstanceId);
  const status = normalizeStatus(params.status);
  const operation = record.queue.then(
    () => updateCardRecord(record, params.cardInstanceId, params.markdown, status, params.log),
    () => updateCardRecord(record, params.cardInstanceId, params.markdown, status, params.log),
  );
  record.queue = operation.catch(() => undefined);
  await operation;
  return {
    cardInstanceId: params.cardInstanceId,
    status,
  };
}

async function updateCardRecord(
  record: CardRecord,
  cardInstanceId: string,
  markdown: string,
  status: CardUpdateStatus,
  log?: LoggerLike,
) {
  if (cards.get(cardInstanceId) !== record) {
    throw new PublicError(`Unknown cardInstanceId: ${cardInstanceId}`);
  }
  record.lastUsedAt = nowMs();
  log?.info?.(`[DingTalk][CardBridge][card.update] cardInstanceId=${cardInstanceId} status=${status}`);
  if (status === "completed") {
    try {
      await finishAICard(record.card, markdown || " ", record.config, log);
    } finally {
      cards.delete(cardInstanceId);
    }
  } else if (status === "failed") {
    const content = markdown.trim() ? markdown : DEFAULT_FAILED_CARD_MARKDOWN;
    try {
      await finishAICard(record.card, content, record.config, log);
    } finally {
      cards.delete(cardInstanceId);
    }
  } else {
    await streamAICard(record.card, markdown || " ", false, record.config, log);
  }
}

/**
 * Return the in-process DingTalk card bridge installed by this connector.
 *
 * Contract:
 * - Symbol key: `Symbol.for("@dingtalk-connector/card-bridge")`
 * - `create({ target, accountId?, markdown?, cfg?, log? })`
 * - `update({ cardInstanceId, markdown?, status?, log? })`
 *
 * This bridge is intentionally process-local. Cross-process callers should use
 * the gateway methods registered below instead.
 */
export function getDingtalkCardBridge(): DingtalkCardBridge | undefined {
  return (globalThis as any)[DINGTALK_CARD_BRIDGE_SYMBOL];
}

export function installDingtalkCardBridge(api: OpenClawPluginApi): void {
  ensureCleanupTimerInstalled();
  const g = globalThis as any;
  g[DINGTALK_CARD_BRIDGE_SYMBOL] = {
    async create(params: CardCreateParams) {
      const cfg = await loadRuntimeConfig(api, params?.cfg);
      const target = parseCardTarget(params?.target);
      if (!target) throw new PublicError("target is required (user:<userId>, group:<openConversationId>, or cid...)");
      return createCard({
        cfg,
        accountId: params?.accountId,
        target,
        markdown: optionalString(params?.markdown),
        log: params?.log ?? api.logger,
      });
    },
    async update(params: CardUpdateParams) {
      if (!params?.cardInstanceId) throw new PublicError("cardInstanceId is required");
      return updateCard({
        cardInstanceId: String(params.cardInstanceId),
        markdown: String(params?.markdown ?? ""),
        status: normalizeStatus(params?.status),
        log: params?.log ?? api.logger,
      });
    },
  } satisfies DingtalkCardBridge;
}

export function registerDingtalkCardGatewayMethods(api: OpenClawPluginApi): void {
  const log = api.logger;

  api.registerGatewayMethod("dingtalk-connector.card.create", async ({ params, respond }) => {
    try {
      const { loadConfig } = await import("openclaw/plugin-sdk/config-runtime");
      const cfg = loadConfig() as ClawdbotConfig;
      const rawParams = asRecord(params);
      const target = parseCardTarget(rawParams.target);
      if (!target) {
        return respond(false, {
          error: "target is required (user:<userId>, group:<openConversationId>, or cid...)",
        });
      }
      const result = await createCard({
        cfg,
        accountId: optionalString(rawParams.accountId),
        target,
        markdown: optionalString(rawParams.markdown),
        log,
      });
      respond(true, result);
    } catch (err: unknown) {
      log?.error?.(`[Gateway][card.create] 错误: ${errorMessage(err)}`);
      respond(false, { error: publicErrorMessage(err, "card.create failed") });
    }
  });

  api.registerGatewayMethod("dingtalk-connector.card.update", async ({ params, respond }) => {
    try {
      const rawParams = asRecord(params);
      if (!rawParams.cardInstanceId) {
        return respond(false, { error: "cardInstanceId is required" });
      }
      const result = await updateCard({
        cardInstanceId: String(rawParams.cardInstanceId),
        markdown: String(rawParams.markdown ?? ""),
        status: normalizeStatus(rawParams.status),
        log,
      });
      respond(true, result);
    } catch (err: unknown) {
      log?.error?.(`[Gateway][card.update] 错误: ${errorMessage(err)}`);
      respond(false, { error: publicErrorMessage(err, "card.update failed") });
    }
  });
}
