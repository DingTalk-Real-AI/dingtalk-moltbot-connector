// 类型定义
interface ClawdbotConfig {
  [key: string]: any;
}

interface RuntimeEnv {
  log?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  debug?: (...args: any[]) => void;
  info?: (...args: any[]) => void;
  [key: string]: any;
}

interface ReplyPayload {
  text?: string;
  [key: string]: any;
}

import { resolveAgentConfig } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { ReplyDispatcherWithTypingOptions } from "openclaw/plugin-sdk/reply-runtime";
import {
  createReplyPrefixOptions,
} from "openclaw/plugin-sdk/channel-outbound";

import { createLoggerFromConfig } from "./utils/logger.ts";
import { CHANNEL_ID } from "./channel.ts";
import { resolveDingtalkAccount } from "./config/accounts.ts";
import { getDingtalkRuntime } from "./runtime.ts";
import type { DingtalkConfig } from "./types/index.ts";
import {
  createAICardForTarget,
  finishAICard,
  streamAICard,
  isQpsLimitError,
  type AICardInstance,
  type AICardTarget,
} from "./services/messaging/card.ts";
import { sendMessage, sendTextMessage, sendMarkdownMessage } from "./services/messaging.ts";
import { getOapiAccessToken } from "./utils/token.ts";
import {
  processLocalImages,
  processVideoMarkers,
  processAudioMarkers,
  uploadAndReplaceFileMarkers,
} from "./services/media/index.ts";
import {
  pickEmptyReplyFallbackText,
  emptyGroupReplyLogHint,
  groupChatLacksVisibleRepliesAutomatic,
} from "./utils/empty-reply.ts";


export type CreateDingtalkReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  conversationId: string;
  senderId: string;
  isDirect: boolean;
  accountId?: string;
  messageCreateTimeMs?: number;
  sessionWebhook: string;
  asyncMode?: boolean;
  /** 队列繁忙时预先创建的 AI Card，startStreaming 时直接复用而非新建 */
  preCreatedCard?: AICardInstance;
};

export function createDingtalkReplyDispatcher(params: CreateDingtalkReplyDispatcherParams) {
  const core = getDingtalkRuntime();
  const {
    cfg,
    agentId,
    conversationId,
    senderId,
    isDirect,
    accountId,
    sessionWebhook,
    asyncMode = false,
    preCreatedCard,
  } = params;

  const account = resolveDingtalkAccount({ cfg, accountId });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg,
    agentId,
    channel: CHANNEL_ID,
    accountId,
  });

  // ✅ 读取 debug 配置
  const log = createLoggerFromConfig(account.config, `DingTalk:${accountId}`);

  // AI Card 状态管理
  let currentCardTarget: AICardTarget | null = null;
  let accumulatedText = "";
  const deliveredFinalTexts = new Set<string>();

  /** 本轮是否已向用户发出过可见回复（final / 流式更新 / 错误兜底等） */
  let outboundUserVisibleThisTurn = false;
  /** 防止 onIdle / onError 重复发送 visibleReplies 配置指引 */
  let idleConfigNudgeSent = false;

  // 异步模式：累积完整响应
  let asyncModeFullResponse = "";

  // ===== 养成系统: 通过 onCommandOutput 监听 dws 命令执行 =====
  // 记录当前回复周期内 onCommandOutput 回调检测到的 dws 产品名（如 "aitable"、"calendar"），
  // 在 closeStreaming 时用于触发降妖逻辑，每轮结束后清空。
  const detectedDwsProducts = new Set<string>();
  // 匹配 shell 命令中的 dws 子命令（如 `dws aitable list`），提取产品名用于养成系统掉落判定。
  const DWS_PRODUCT_PATTERN = /\bdws\s+(aitable|calendar|chat|contact|todo|approval|attendance|report|ding|workbench|devdoc)\b/;
  
  // ✅ 节流控制：避免频繁调用钉钉 API 导致 QPS 限流
  // 全局令牌桶限流器已在 streamAICard 内部实现（card.ts），此处的 updateInterval
  // 作为单实例级别的前置过滤，减少不必要的 streamAICard 调用
  let lastUpdateTime = 0;
  const updateInterval = 800; // 最小更新间隔 800ms（配合 card.ts 全局限流器，降低单实例发送频率）

  // ✅ 错误兜底：防止重复发送错误消息
  const deliveredErrorTypes = new Set<string>();
  let lastErrorTime = 0;
  const ERROR_COOLDOWN = 60000; // 错误消息冷却时间 1 分钟

  // ============ 错误兜底函数 ============

  /**
   * 发送兜底错误消息，确保用户始终能收到反馈
   */
  const sendFallbackErrorMessage = async (
    errorType: 'mediaProcess' | 'sendMessage' | 'unknown',
    originalError?: string,
    forceSend: boolean = false
  ) => {
    const now = Date.now();
    const errorKey = `${errorType}:${conversationId}:${senderId}`;
    
    // 防止重复发送相同类型的错误消息
    if (!forceSend && deliveredErrorTypes.has(errorKey)) {
      log.debug(`[DingTalk][Fallback] 跳过重复错误消息：${errorType}`);
      return;
    }
    
    // 冷却时间控制
    if (!forceSend && now - lastErrorTime < ERROR_COOLDOWN) {
      log.debug(`[DingTalk][Fallback] 冷却时间内，跳过错误消息`);
      return;
    }

    const errorMessages = {
      mediaProcess: '⚠️ 媒体文件处理失败，已发送文字回复',
      sendMessage: '⚠️ 消息发送失败，请稍后重试',
      unknown: '⚠️ 抱歉，处理您的请求时出错，请稍后重试',
    };
    
    const errorMessage = errorMessages[errorType];
    log.warn(`[DingTalk][Fallback] ${errorMessage}, error: ${originalError}`);
    
    try {
      await sendMessage(
        account.config as DingtalkConfig,
        sessionWebhook,
        errorMessage,
        {
          useMarkdown: false,
          log: params.runtime.log,
        }
      );
      deliveredErrorTypes.add(errorKey);
      lastErrorTime = now;
      outboundUserVisibleThisTurn = true;
      log.info(`[DingTalk][Fallback] ✅ 错误消息发送成功`);
    } catch (fallbackErr: any) {
      log.error(`[DingTalk][Fallback] ❌ 错误消息发送失败：${fallbackErr.message}`);
    }
  };

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(
    cfg,
    CHANNEL_ID,
    accountId,
    { fallbackLimit: 4000 }
  );
  const chunkMode = core.channel.text.resolveChunkMode(cfg, CHANNEL_ID);

  // ✅ 群聊回复模式：当 groupReplyMode 为 text/markdown 时，群聊禁用 AI Card
  const groupReplyMode = (account.config as any)?.groupReplyMode || 'aicard';
  const isTextMode = !isDirect && (groupReplyMode === 'text' || groupReplyMode === 'markdown');
  if (isTextMode) {
    log.info(`[DingTalk] 群聊回复模式: ${groupReplyMode}，禁用 AI Card，使用 ${groupReplyMode} 发送`);
  }

  // 流式 AI Card 支持（text/markdown 模式强制禁用流式）
  const streamingEnabled = !isTextMode && (account.config as any)?.streaming !== false;
  // 用 Promise 保存 AI Card 的创建过程，避免 final 消息到达时轮询等待
  let cardCreationPromise: Promise<void> | null = null;
  // 回合 settle（onIdle）后置 true。openclaw 2026.5.x+ 存在 settle 之后仍会送达的
  // 迟到回调（typing keepalive 触发的 onReplyStart、steer/followup 认领回合经旧
  // dispatcher 投递的 block 等，见 openclaw typing.ts 的 sealed 机制注释）。
  // 密封后不再创建新卡片——settle 后创建的卡片没有任何收口方，必然孤儿转圈。
  let streamingSealed = false;

  // ===== 卡片守护超时（watchdog）=====
  // settle 可能永远不来：上游 run 挂死、openclaw dispatch 不返回、或收口链中
  // 无超时的调用挂住——此时 onIdle 收口路径整体失效，卡片将永久转圈。
  // watchdog 是最后防线：卡片创建后计时，流式更新/命令输出会刷新计时；
  // 到期仍未收口则强制 finishAICard 并密封本轮，之后迟到的 final/block
  // 走密封降级路径以普通消息发出，内容不丢失。
  const CARD_WATCHDOG_TIMEOUT_MS = 10 * 60 * 1000;
  let cardWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogCard: AICardInstance | null = null;
  // 同一张卡片只允许一次 finish。入口 clearCardWatchdog 盖不到
  // 「卡片创建在途 → await 返回后 IIFE 才 arm → 媒体处理超过 timeout」
  // 的窗口（#647 review）；closeStreaming 与 forceFinishStaleCard 必须
  // 共享单飞，否则两条路径会各调一次 finishAICard。
  let finishInFlight: Promise<void> | null = null;
  const finishedCardIds = new Set<string>();

  const clearCardWatchdog = () => {
    if (cardWatchdogTimer) {
      clearTimeout(cardWatchdogTimer);
      cardWatchdogTimer = null;
    }
    watchdogCard = null;
  };

  const finishCardOnce = async (card: AICardInstance, text: string): Promise<void> => {
    const id = card.cardInstanceId;
    if (id && finishedCardIds.has(id)) {
      log.info(`[DingTalk][finishCardOnce] 卡片已收口，跳过重复 finish`);
      return;
    }
    if (finishInFlight) {
      log.info(`[DingTalk][finishCardOnce] 收口进行中，等待进行中的 finish`);
      await finishInFlight;
      return;
    }
    const run = (async () => {
      await finishAICard(card, text, account.config as DingtalkConfig, log);
      if (id) finishedCardIds.add(id);
    })();
    finishInFlight = run;
    try {
      await run;
    } finally {
      if (finishInFlight === run) finishInFlight = null;
    }
  };

  const forceFinishStaleCard = async () => {
    const staleCard = watchdogCard;
    cardWatchdogTimer = null;
    watchdogCard = null;
    if (!staleCard) return;
    // 本轮已不可信：密封防止迟到回调再建卡；清空引用防止收口路径二次 finish
    streamingSealed = true;
    if (currentCardTarget === (staleCard as any)) {
      currentCardTarget = null;
    }
    const timeoutText = accumulatedText.trim() || pickEmptyReplyFallbackText(!isDirect);
    log.warn(
      `[DingTalk][cardWatchdog] 卡片超过 ${CARD_WATCHDOG_TIMEOUT_MS / 60000} 分钟未收口（settle 未到达），强制结束以避免永久转圈`,
    );
    try {
      await finishCardOnce(staleCard, timeoutText);
      outboundUserVisibleThisTurn = true;
      log.info(`[DingTalk][cardWatchdog] ✅ 强制收口成功`);
    } catch (err: any) {
      log.error(`[DingTalk][cardWatchdog] ❌ 强制收口失败：${err?.message || String(err)}`);
    } finally {
      accumulatedText = "";
    }
  };

  const armCardWatchdog = () => {
    if (cardWatchdogTimer) {
      clearTimeout(cardWatchdogTimer);
    }
    cardWatchdogTimer = setTimeout(() => {
      void forceFinishStaleCard();
    }, CARD_WATCHDOG_TIMEOUT_MS);
    (cardWatchdogTimer as any).unref?.();
  };

  const startStreaming = (): Promise<void> => {
    // 回合已 settle：迟到回调不得再创建 AI Card
    if (streamingSealed) {
      log.debug(`[DingTalk][startStreaming] 回合已 settle（sealed），跳过 AI Card 创建`);
      return Promise.resolve();
    }
    // 如果已经有创建中的 Promise，直接复用，避免并发创建
    if (cardCreationPromise) {
      return cardCreationPromise;
    }
    // 如果 AI Card 已存在，直接返回已完成的 Promise
    if (currentCardTarget) {
      return Promise.resolve();
    }

    const creation = (async () => {
      // 异步模式下禁用流式 AI Card
      if (asyncMode) {
        log.info(`[DingTalk][startStreaming] 异步模式，跳过 AI Card 创建`);
        return;
      }
      if (!streamingEnabled) {
        log.info(`[DingTalk][startStreaming] 流式功能被禁用，跳过 AI Card 创建`);
        return;
      }

      // 若队列繁忙时已预先创建了 Card（显示排队 ACK 文案），直接复用，无需新建
      // 这样用户看到的是同一条消息从 ACK 文案更新为最终结果，而不是多出一条消息
      if (preCreatedCard) {
        log.info(`[DingTalk][startStreaming] 复用预创建 AI Card，cardInstanceId=${preCreatedCard.cardInstanceId}`);
        currentCardTarget = preCreatedCard as any;
        accumulatedText = "";
        outboundUserVisibleThisTurn = true;
        watchdogCard = preCreatedCard;
        armCardWatchdog();
        return;
      }

      log.info(`[DingTalk][startStreaming] 开始创建 AI Card...`);

      try {
        const target: AICardTarget = isDirect
          ? { type: 'user', userId: senderId }
          : { type: 'group', openConversationId: conversationId };

        log.info(`[DingTalk][startStreaming] 目标：${JSON.stringify(target)}`);

        const card = await createAICardForTarget(
          account.config as DingtalkConfig,
          target,
          log
        );
        currentCardTarget = card as any;
        accumulatedText = "";

        if (card) {
          watchdogCard = card;
          armCardWatchdog();
          log.info(`[DingTalk][startStreaming] ✅ AI Card 创建成功`);
        } else {
          log.warn(`[DingTalk][startStreaming] AI Card 创建返回 null，静默降级到普通消息模式`);
        }
      } catch (error: any) {
        log.error(`[DingTalk][startStreaming] ❌ AI Card 创建失败：${error?.message || String(error)}，静默降级到普通消息模式`);
        currentCardTarget = null;
      }
    })();

    cardCreationPromise = creation;
    // 在 Promise settle 后清空 gate，覆盖所有路径（含 asyncMode /
    // !streamingEnabled / preCreatedCard 的 early return——它们不进入
    // 内部 try/finally，旧实现只在内部 finally 清空，导致这三条路径
    // 的 cardCreationPromise 永远指向已 settle 的 stale Promise，后续
    // startStreaming 调用会复用 stale Promise 而非走 currentCardTarget
    // 快捷路径或重新创建）。
    // 不用 creation.finally(...)：其派生 Promise 是独立 rejection 通道，
    // 调用方的 creation.catch() 盖不住它。Node 22 默认
    // --unhandled-rejections=throw，派生 Promise 被丢弃时仍会打
    // UNHANDLED REJECTION 并退出进程（#647 review）。
    // then(onFulfilled, onRejected) 在两个 handler 都不抛时不会再 reject。
    const clearCreationGate = () => {
      if (cardCreationPromise === creation) cardCreationPromise = null;
    };
    void creation.then(clearCreationGate, clearCreationGate);
    return creation;
  };

  const closeStreaming: () => Promise<void> = async () => {
    // ⚠️ 单飞入口：在任何 await 之前先解除 watchdog，防止收口与 watchdog
    // 并发触发同一张卡片的 finishAICard。若不在入口清理，await
    // cardCreationPromise / finishAICard 期间 watchdog 计时器仍会触发
    // forceFinishStaleCard，两条路径会各自调一次 finishAICard，服务端
    // 收到重复关闭请求，日志/计数与 outboundUserVisibleThisTurn 也会被
    // 双写。closeStreaming 的正常/降级路径最终都会走到 finally 的
    // clearCardWatchdog()，此处提前清理是幂等的。
    clearCardWatchdog();
    // ✅ 先等待仍在途的卡片创建完成再快照。final 被上游抑制的回合
    // （openclaw 2026.5.x+ 的 message_tool_only / steer 认领，final 永远不会
    // 经 deliver 到达）里 onIdle → closeStreaming 是唯一收口；若此刻创建
    // HTTP 尚未返回，直接快照会拿到 null 而跳过关闭，卡片随后创建成功后
    // 将永远停留在 INPUTING（转圈）状态。
    if (cardCreationPromise) {
      try {
        await cardCreationPromise;
      } catch {
        // 创建失败已在 startStreaming 内部降级处理，此处继续走快照逻辑即可
      }
    }
    // 立即捕获并清空，防止并发调用重复执行（竞争条件保护）
    // closeStreaming 可能被 onIdle 和 onError 同时触发，若不在此处清空，
    // 第一次调用的 finally 块会将 currentCardTarget 置 null，
    // 导致第二次调用的 finishAICard 收到 null 参数而崩溃
    const cardSnapshot = currentCardTarget;
    if (!cardSnapshot) {
      log.info(`[DingTalk][closeStreaming] 无 AI Card，跳过关闭`);
      return;
    }
    currentCardTarget = null;

    log.info(`[DingTalk][closeStreaming] 开始关闭 AI Card...`);

    try {
      // 处理媒体标记
      let finalText = accumulatedText;
      
      // ✅ 如果累积的文本为空，使用默认提示文案
      // 群聊场景下，常见根因是 OpenClaw `messages.groupChat.visibleReplies` 未设为
      // "automatic"（上游 source-reply-delivery-mode.ts 走 message_tool_only 时
      // 会跳过 onPartialReply，accumulatedText 始终为空）。给运维一份可操作的指引；
      // 单聊则用口语化确认语兜底，避免「任务执行完成（无文本输出）」让用户误判为报错。
      // 详见 src/utils/empty-reply.ts。
      if (!finalText.trim()) {
        const isGroup = !isDirect;
        finalText = pickEmptyReplyFallbackText(isGroup);
        log.info(`[DingTalk][closeStreaming] 累积文本为空，使用默认提示文案 (isGroup=${isGroup})`);
        if (isGroup) {
          log.warn?.(`[DingTalk][closeStreaming] ${emptyGroupReplyLogHint()}`);
        }
      }
      
      // 获取 oapiToken 用于媒体处理
      const oapiToken = await getOapiAccessToken(account.config as DingtalkConfig);
      
      // ✅ 构建正确的 target（单聊用 senderId，群聊用 conversationId）
      const target: AICardTarget = isDirect
        ? { type: 'user', userId: senderId }
        : { type: 'group', openConversationId: conversationId };
      
      log.info(`[DingTalk][closeStreaming] 开始处理媒体文件，target=${JSON.stringify(target)}`);
      
      if (oapiToken) {
        // 处理本地图片
        finalText = await processLocalImages(finalText, oapiToken, log);
        
        // ✅ 先处理 Markdown 标记格式的媒体文件
        finalText = await processVideoMarkers(
          finalText,
          '',
          account.config as DingtalkConfig,
          oapiToken,
          log,
          true,  // ✅ 使用主动 API 模式
          target
        );
        finalText = await processAudioMarkers(
          finalText,
          '',
          account.config as DingtalkConfig,
          oapiToken,
          log,
          true,  // ✅ 使用主动 API 模式
          target
        );
        finalText = await uploadAndReplaceFileMarkers(
          finalText,
          '',
          account.config as DingtalkConfig,
          oapiToken,
          log,
          true,  // ✅ 使用主动 API 模式
          target
        );
        
        // ✅ 处理裸露的本地文件路径（绕过 OpenClaw SDK 的 bug）
        log.info(`[DingTalk][closeStreaming] 准备调用 processRawMediaPaths`);
        const { processRawMediaPaths } = await import('./services/media');
        finalText = await processRawMediaPaths(
          finalText,
          account.config as DingtalkConfig,
          oapiToken,
          log,
          target
        );
        log.info(`[DingTalk][closeStreaming] processRawMediaPaths 处理完成`);
      } else {
        log.warn(`[DingTalk][closeStreaming] oapiToken 为空，跳过媒体处理`);
      }

      // ===== 养成系统：基于 onCommandOutput 检测到的 dws 产品触发降妖 =====
      // 优先使用 onCommandOutput 监听到的产品（精准），兜底用正则匹配回复文本
      try {
        const productsToProcess = new Set<string>(detectedDwsProducts);

        // 兜底：如果 onCommandOutput 没捕获到，尝试从回复文本中正则匹配
        if (productsToProcess.size === 0) {
          const dwsProductMatch = finalText.match(/(?:^|\n)\s*(?:>?\s*)?(?:`\s*)?dws\s+(aitable|calendar|chat|contact|todo|approval|attendance|report|ding|workbench|devdoc)\b/m);
          if (dwsProductMatch && !finalText.includes('command not found: dws') && !finalText.includes('请先执行 dws login')) {
            productsToProcess.add(dwsProductMatch[1]);
            log.info(`[DingTalk][closeStreaming] 养成系统：正则兜底匹配到产品=${dwsProductMatch[1]}`);
          }
        } else {
          log.info(`[DingTalk][closeStreaming] 养成系统：onCommandOutput 监听到 ${productsToProcess.size} 个 dws 产品: ${[...productsToProcess].join(', ')}`);
        }

        if (productsToProcess.size > 0) {
          const { GamificationEngine } = await import('./game-xiyou/index.ts');
          const engine = GamificationEngine.getInstanceForUser(senderId);
          if (engine.isEnabled()) {
            // 一次任务只触发一次降妖，取第一个产品作为代表
            const primaryProduct = [...productsToProcess][0];
            const allProducts = [...productsToProcess].join('+');
            const gamificationBlock = engine.onDwsCommandResult(primaryProduct, true, `dws ${allProducts}`);
            if (gamificationBlock) {
              finalText += '\n' + gamificationBlock;
              log.info(`[DingTalk][closeStreaming] ✅ 养成系统渲染已追加，主产品=${primaryProduct}，涉及产品=${allProducts}`);
            }
          }
        }

        // 清空本轮检测记录
        detectedDwsProducts.clear();
      } catch (gamErr: any) {
        log.warn(`[DingTalk][closeStreaming] 养成系统处理失败（不影响主流程）: ${gamErr?.message || gamErr}`);
      }

      log.info(`[DingTalk][closeStreaming] 准备调用 finishAICard，文本长度=${finalText.length}`);
      log.debug(`[DingTalk][closeStreaming] 最终发送内容长度=${finalText.length}`);
      await finishCardOnce(cardSnapshot as any, finalText);
      outboundUserVisibleThisTurn = true;
      log.info(`[DingTalk][closeStreaming] ✅ AI Card 关闭成功`);
    } catch (error: any) {
      log.error(`[DingTalk][closeStreaming] ❌ AI Card 关闭失败：${error?.message || String(error)}`);
      // ✅ 媒体处理或关闭失败时，降级发送普通消息
      await sendFallbackErrorMessage('mediaProcess', error?.message || String(error));
      
      // 尝试用普通消息发送累积的文本
      if (accumulatedText.trim()) {
        try {
          log.info(`[DingTalk][closeStreaming] 降级发送普通消息`);
          await sendMessage(
            account.config as DingtalkConfig,
            sessionWebhook,
            accumulatedText,
            {
              useMarkdown: true,
              log: params.runtime.log,
            }
          );
          outboundUserVisibleThisTurn = true;
          log.info(`[DingTalk][closeStreaming] ✅ 降级发送成功`);
        } catch (sendErr: any) {
          log.error(`[DingTalk][closeStreaming] ❌ 降级发送失败：${sendErr.message}`);
        }
      }
    } finally {
      // currentCardTarget 已在函数开头清空，此处只需重置累积文本；
      // 正常收口完成，解除守护计时（若 watchdog 已先行触发则此处为幂等清理）
      clearCardWatchdog();
      accumulatedText = "";
    }
  };

  /**
   * 群聊且 OpenClaw 未配置 `messages.groupChat.visibleReplies=automatic` 时，
   * 若本轮结束时仍没有任何用户可见输出（上游可能未调用空 final 的 deliver），
   * 补发与空 final 一致的配置指引，避免只有「思考中」却无声。
   */
  const maybeSendGroupVisibleRepliesIdleNudge = async () => {
    if (isDirect) return;
    if (!groupChatLacksVisibleRepliesAutomatic(cfg)) return;
    if (asyncMode) return;
    if (outboundUserVisibleThisTurn) return;
    if (idleConfigNudgeSent) return;
    idleConfigNudgeSent = true;
    log.info(
      `[DingTalk][idleNudge] 本轮无用户可见回复且群聊未启用 visibleReplies=automatic，发送配置指引`,
    );
    try {
      const text = pickEmptyReplyFallbackText(true);
      log.warn(`[DingTalk][idleNudge] ${emptyGroupReplyLogHint()}`);
      for (const chunk of core.channel.text.chunkTextWithMode(
        text,
        textChunkLimit,
        chunkMode,
      )) {
        if (isTextMode) {
          if (groupReplyMode === 'markdown') {
            await sendMarkdownMessage(
              account.config as DingtalkConfig,
              sessionWebhook,
              chunk.split('\n')[0]?.replace(/^[#*\s\->]+/, '').slice(0, 20) || 'Message',
              chunk,
              { cfg, detectBareAliases: true },
            );
          } else {
            await sendTextMessage(
              account.config as DingtalkConfig,
              sessionWebhook,
              chunk,
              { cfg, detectBareAliases: true },
            );
          }
        } else {
          await sendMessage(
            account.config as DingtalkConfig,
            sessionWebhook,
            chunk,
            {
              useMarkdown: true,
              log: params.runtime.log,
              cfg,
              detectBareAliases: true,
            },
          );
        }
      }
      outboundUserVisibleThisTurn = true;
      log.info(`[DingTalk][idleNudge] ✅ 配置指引已发送`);
    } catch (e: any) {
      log.error(`[DingTalk][idleNudge] 发送失败: ${e?.message || e}`);
    }
  };

  const delayDefaults = cfg.agents?.defaults?.humanDelay;
  const delayOverrides = resolveAgentConfig(cfg, agentId)?.humanDelay;
  const dispatcherOptions: ReplyDispatcherWithTypingOptions = {
      ...prefixOptions,
      humanDelay: delayDefaults || delayOverrides ? {
        mode: delayOverrides?.mode ?? delayDefaults?.mode,
        minMs: delayOverrides?.minMs ?? delayDefaults?.minMs,
        maxMs: delayOverrides?.maxMs ?? delayDefaults?.maxMs,
      } : undefined,
      onReplyStart: () => {
        log.info(`[DingTalk][onReplyStart] 开始回复，流式 enabled=${streamingEnabled}`);
        // 每次 onReplyStart 都是全新的回复周期，清空去重集合
        deliveredFinalTexts.clear();
        outboundUserVisibleThisTurn = false;
        idleConfigNudgeSent = false;
        if (streamingEnabled) {
          // fire-and-forget：提前创建 AI Card，onPartialReply 会等待创建完成。
          // 加 .catch() 防止 IIFE early-return 路径（preCreatedCard 里
          // armCardWatchdog 等）抛出时成为 unhandledRejection。
          void startStreaming().catch(err =>
            log.error(`[DingTalk][onReplyStart] startStreaming error: ${err?.message || err}`)
          );
        }
      },
      deliver: async (payload, info) => {
        let text = payload.text ?? "";
        
        log.info(`[DingTalk][deliver] 被调用：kind=${info?.kind}, textLength=${text.length}, hasText=${Boolean(text.trim())}`);
        log.debug(`[DingTalk][deliver] payload keys=${Object.keys(payload).join(',')}, info.kind=${info?.kind}`);
        
        // ✅ 在 final 响应时，先处理裸露的文件路径
        if (info?.kind === "final" && text.trim()) {
          const target: AICardTarget = isDirect
            ? { type: 'user', userId: senderId }
            : { type: 'group', openConversationId: conversationId };
          
          try {
            const oapiToken = await getOapiAccessToken(account.config as DingtalkConfig);
            if (oapiToken) {
              log.info(`[DingTalk][deliver] 检测到 final 响应，准备处理裸露文件路径`);
              const { processRawMediaPaths } = await import('./services/media');
              text = await processRawMediaPaths(
                text,
                account.config as DingtalkConfig,
                oapiToken,
                log,
                target
              );
              log.info(`[DingTalk][deliver] 裸露文件路径处理完成`);
            }
          } catch (err: any) {
            log.error(`[DingTalk][deliver] 处理裸露文件路径失败：${err.message}`);
          }
        }
        
        const hasText = Boolean(text.trim());
        const skipTextForDuplicateFinal =
          info?.kind === "final" && hasText && deliveredFinalTexts.has(text);
        
        // ✅ 如果是 final 响应且没有文本，使用默认提示文案
        // 群聊空 final 常由 OpenClaw `messages.groupChat.visibleReplies !== "automatic"`
        // 触发，群聊场景给一句可操作的修复指引；单聊保持原文案。
        if (info?.kind === "final" && !hasText) {
          const isGroup = !isDirect;
          text = pickEmptyReplyFallbackText(isGroup);
          log.info(`[DingTalk][deliver] final 响应无文本，使用默认提示文案 (isGroup=${isGroup})`);
          if (isGroup) {
            log.warn?.(`[DingTalk][deliver] ${emptyGroupReplyLogHint()}`);
          }
        }
        
        const shouldDeliverText = Boolean(text.trim()) && !skipTextForDuplicateFinal;

        if (!shouldDeliverText) {
          log.info(`[DingTalk][deliver] 跳过发送：hasText=${hasText}, skipTextForDuplicateFinal=${skipTextForDuplicateFinal}`);
          return;
        }

        // 异步模式：只累积响应，不发送
        if (asyncMode) {
          log.info(`[DingTalk][deliver] 异步模式，累积响应`);
          asyncModeFullResponse = text;
          return;
        }

        // block 消息：Agent 的中间 status update
        // 追加到同一张流式 AI Card 里（delta 模式），不单独创建新卡片
        // 如果流式 AI Card 未启用，直接丢弃 block（不发送）
        if (info?.kind === "block") {
          if (!streamingEnabled) {
            log.info(`[DingTalk][deliver] block 消息，流式未启用，丢弃`);
            return;
          }
          // 回合已 settle：这可能是 steer/followup 认领回合经本 dispatcher 送达的
          // 实际回复（openclaw 2026.5.x+ 对认领回合从不投递 final，只以 block 形式
          // 经原回合 dispatcher 送达）。降级为普通消息发出——既保住回复内容，
          // 也不会创建一张无人收口的孤儿卡片。
          if (streamingSealed) {
            log.info(`[DingTalk][deliver] block 晚于 settle 到达，降级为普通消息发送，文本长度=${text.length}`);
            try {
              for (const chunk of core.channel.text.chunkTextWithMode(
                text,
                textChunkLimit,
                chunkMode
              )) {
                await sendMessage(
                  account.config as DingtalkConfig,
                  sessionWebhook,
                  chunk,
                  {
                    useMarkdown: true,
                    log: params.runtime.log,
                    cfg,
                    detectBareAliases: true,
                  }
                );
              }
              outboundUserVisibleThisTurn = true;
              log.info(`[DingTalk][deliver] ✅ 迟到 block 降级发送成功`);
            } catch (lateErr: any) {
              log.error(`[DingTalk][deliver] ❌ 迟到 block 降级发送失败：${lateErr.message}`);
            }
            return;
          }
          log.info(`[DingTalk][deliver] block 消息，追加到流式 AI Card，文本长度=${text.length}`);
          // 确保 AI Card 已创建（startStreaming 内部会复用已有的 cardCreationPromise）
          await startStreaming();
          // AI Card 已就绪，用 streamAICard 更新内容（仅展示当前 block 文本，不累积到 accumulatedText）
          // accumulatedText 专门给 onPartialReply 的流式更新使用，block 不能污染它
          if (currentCardTarget) {
            const now = Date.now();
            if (now - lastUpdateTime >= updateInterval) {
              // ✅ 乐观更新：防止并发回调在 await 期间通过节流检查
              lastUpdateTime = now;
              try {
                await streamAICard(
                  currentCardTarget as any,
                  text,
                  false,
                  account.config as DingtalkConfig,
                  log
                );
                outboundUserVisibleThisTurn = true;
                if (watchdogCard) armCardWatchdog();
                log.info(`[DingTalk][deliver] ✅ block 更新到 AI Card 成功`);
              } catch (streamErr: any) {
                log.error(`[DingTalk][deliver] ❌ block 更新 AI Card 失败：${streamErr.message}`);
              }
            }
          } else {
            log.warn(`[DingTalk][deliver] block 消息：AI Card 创建失败，丢弃该 block`);
          }
          return;
        }

        // 流式模式的 final 处理
        if (info?.kind === "final" && streamingEnabled) {
          log.info(`[DingTalk][deliver] final 响应，流式模式`);
          // await startStreaming() 确保 AI Card 创建完成后再处理 final
          await startStreaming();

          if (currentCardTarget) {
            // 直接用 final 的 text 覆盖 accumulatedText，确保 closeStreaming 用最终内容关闭卡片
            // 不能追加，因为 final text 本身就是完整的最终回复
            accumulatedText = text;
            log.info(`[DingTalk][deliver] 调用 closeStreaming 完成 AI Card`);
            await closeStreaming();
            deliveredFinalTexts.add(text);
            return;
          } else {
            log.warn(`[DingTalk][deliver] ⚠️ AI Card 创建失败，降级到非流式发送`);
          }
        }

        // 流式模式但没有 card target：降级到非流式发送
        // 或者非流式模式：使用普通消息发送
        if (info?.kind === "final") {
          log.info(`[DingTalk][deliver] 降级到非流式发送，文本长度=${text.length}, isTextMode=${isTextMode}, groupReplyMode=${groupReplyMode}`);
          try {
            // 处理文件/视频/音频标记：上传媒体并通过 proactive API 发送
            const oapiToken = await getOapiAccessToken(account.config as DingtalkConfig);
            if (oapiToken) {
              const fallbackTarget: AICardTarget = isDirect
                ? { type: 'user', userId: senderId }
                : { type: 'group', openConversationId: conversationId };
              text = await processVideoMarkers(text, '', account.config as DingtalkConfig, oapiToken, log, true, fallbackTarget);
              text = await processAudioMarkers(text, '', account.config as DingtalkConfig, oapiToken, log, true, fallbackTarget);
              text = await processFileMarkers(text, '', account.config as DingtalkConfig, oapiToken, log, true, fallbackTarget);
            }

            for (const chunk of core.channel.text.chunkTextWithMode(
              text,
              textChunkLimit,
              chunkMode
            )) {
              if (isTextMode) {
                if (groupReplyMode === 'markdown') {
                  await sendMarkdownMessage(
                    account.config as DingtalkConfig,
                    sessionWebhook,
                    chunk.split('\n')[0]?.replace(/^[#*\s\->]+/, '').slice(0, 20) || 'Message',
                    chunk,
                    { cfg, detectBareAliases: true },
                  );
                } else {
                  await sendTextMessage(
                    account.config as DingtalkConfig,
                    sessionWebhook,
                    chunk,
                    { cfg, detectBareAliases: true },
                  );
                }
              } else {
                await sendMessage(
                  account.config as DingtalkConfig,
                  sessionWebhook,
                  chunk,
                  {
                    useMarkdown: true,
                    log: params.runtime.log,
                    cfg,
                    detectBareAliases: true,
                  }
                );
              }
            }
            outboundUserVisibleThisTurn = true;
            log.info(`[DingTalk][deliver] ✅ 非流式发送成功`);
            deliveredFinalTexts.add(text);
          } catch (error: any) {
            log.error(`[DingTalk][deliver] ❌ 非流式发送失败：${error.message}`);
            params.runtime.error?.(
              `dingtalk[${account.accountId}]: non-streaming delivery failed: ${String(error)}`
            );
            // ✅ 发送兜底错误消息
            await sendFallbackErrorMessage('sendMessage', error.message);
          }
          return;
        }
      },
      onError: async (error, info) => {
        log.error(`[DingTalk][onError] ${info.kind} reply failed: ${String(error)}`);
        params.runtime.error?.(
          `dingtalk[${account.accountId}] ${info.kind} reply failed: ${String(error)}`
        );
        // 与 onIdle 对称：先密封再收口。onError 也是本轮的终结信号，
        // 收口后到达的迟到 onReplyStart / partial / block 不得再创建新卡片，
        // 否则同样会产生无人收口的孤儿卡（见 typing.ts 的 sealed 机制）。
        streamingSealed = true;
        await closeStreaming();
        await maybeSendGroupVisibleRepliesIdleNudge();
      },
      onIdle: async () => {
        log.info(`[DingTalk][onIdle] 回复空闲，关闭 AI Card`);
        // 先密封再收口：onIdle 意味着本轮 dispatcher 已 settle
        //（reservation 语义保证 onIdle 只在 markComplete 之后触发），
        // 此后任何迟到回调都不允许再创建新卡片。
        streamingSealed = true;
        await closeStreaming();
        await maybeSendGroupVisibleRepliesIdleNudge();
      },
      onCleanup: () => {
        log.info(`[DingTalk][onCleanup] 清理回调`);
      },
    };

  // Core owns dispatcher creation and typing settlement; DingTalk owns card callbacks.
  return {
    dispatcherOptions,
    replyOptions: {
      onModelSelected,
      ...(streamingEnabled && {
        onPartialReply: async (payload: ReplyPayload) => {
        log.info(`[DingTalk][onPartialReply] 被调用，payload.text=${payload.text ? payload.text.length : 'null'}`);
        log.debug(`[DingTalk][onPartialReply] textLength=${payload.text?.length ?? 0}`);
        if (!payload.text) {
          log.debug(`[DingTalk][onPartialReply] 空文本，跳过`);
          return;
        }
        
        log.debug(`[DingTalk][onPartialReply] 收到部分响应，文本长度=${payload.text.length}`);
        
        // 异步模式下禁用流式更新
        if (asyncMode) {
          log.debug(`[DingTalk][onPartialReply] 异步模式，累积响应`);
          asyncModeFullResponse = payload.text;
          return;
        }
        
        // await startStreaming() 确保 AI Card 创建完成后再更新
        // startStreaming 内部会复用已有的 cardCreationPromise，不会重复创建
        await startStreaming();
        
        if (currentCardTarget) {
          accumulatedText = payload.text;
          
          const now = Date.now();
          if (now - lastUpdateTime >= updateInterval) {
            const { FILE_MARKER_PATTERN, VIDEO_MARKER_PATTERN, AUDIO_MARKER_PATTERN } = await import('./services/media/common.ts');
            const displayContent = accumulatedText
              .replace(FILE_MARKER_PATTERN, '')
              .replace(VIDEO_MARKER_PATTERN, '')
              .replace(AUDIO_MARKER_PATTERN, '')
              .trim();
            
            log.debug(`[DingTalk][onPartialReply] 更新 AI Card，显示文本长度=${displayContent.length}`);
            
            // ✅ 乐观更新：在发起 HTTP 请求前立即更新 lastUpdateTime，
            // 防止并发的 onPartialReply 回调在 await 期间通过节流检查，
            // 导致多个请求同时打到同一张卡片触发服务端 403 并发保护
            lastUpdateTime = now;
            try {
              await streamAICard(
                currentCardTarget as any,
                displayContent,
                false,
                account.config as DingtalkConfig,
                log
              );
              outboundUserVisibleThisTurn = true;
              if (watchdogCard) armCardWatchdog();
              log.debug(`[DingTalk][onPartialReply] ✅ AI Card 更新成功`);
            } catch (err: any) {
              // QPS 限流是瞬时错误：streamAICard 内部已自动退避+重试，
              // 退避期过后下一次 partial 更新会把 AI Card 内容覆盖补齐，
              // 因此不应把 QPS 限流展示为用户可见的「消息发送失败」提示，
              // 否则用户会同时看到正常的 AI Card 回复和一条误报错误。
              // 真正无法恢复的错误（finalize 仍失败）会在 closeStreaming
              // 的降级路径里通过 sendFallbackErrorMessage 兜底。
              if (isQpsLimitError(err)) {
                log.warn(
                  `[DingTalk][onPartialReply] AI Card 流式更新遇到 QPS 限流，已在内部退避重试；本次跳过，等待下一次 partial 更新补齐内容`,
                );
              } else {
                log.error(`[DingTalk][onPartialReply] ❌ AI Card 更新失败：${err.message}`);
                await sendFallbackErrorMessage('sendMessage', err.message);
              }
            }
          } else {
            log.debug(`[DingTalk][onPartialReply] 节流控制，跳过本次更新（距离上次更新 ${now - lastUpdateTime}ms）`);
          }
        } else {
          log.warn(`[DingTalk][onPartialReply] ⚠️ AI Card 不存在，跳过更新`);
        }
      },
      }),
      // ===== 养成系统：监听 dws 命令执行 =====
      onCommandOutput: (payload: {
        itemId?: string;
        phase?: string;
        title?: string;
        toolCallId?: string;
        name?: string;
        output?: string;
        status?: string;
        exitCode?: number | null;
        durationMs?: number;
        cwd?: string;
      }) => {
        // 命令仍在执行说明本轮存活：刷新卡片守护计时，避免长任务被误判为挂死
        if (watchdogCard) armCardWatchdog();
        const commandText = payload.title || payload.name || '';
        const dwsMatch = commandText.match(DWS_PRODUCT_PATTERN) || payload.output?.match(DWS_PRODUCT_PATTERN);
        if (dwsMatch) {
          const product = dwsMatch[1];
          // 只记录成功执行的命令（exitCode 为 0 或 phase 不是 end 时还不知道结果）
          const isFailure = payload.phase === 'end' && payload.exitCode !== null && payload.exitCode !== 0;
          if (!isFailure) {
            detectedDwsProducts.add(product);
            log.info(`[DingTalk][onCommandOutput] 检测到 dws 产品: ${product}，phase=${payload.phase}, exitCode=${payload.exitCode}`);
          } else {
            log.info(`[DingTalk][onCommandOutput] dws 命令执行失败，跳过: ${product}，exitCode=${payload.exitCode}`);
          }
        }
      },
    },
    getAsyncModeResponse: () => asyncModeFullResponse,
  };
}
