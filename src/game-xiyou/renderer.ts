/**
 * Markdown 渲染器
 *
 * 输出纯 Markdown 字符串，适配钉钉 AI Card 渲染。
 * 不关心发送方式，只负责内容生成。
 */

import type {
  DropResult, ExpResult, LevelUpResult, Encounter,
  Achievement, UserProfile, UserCollection, Monster,
} from './types.ts';
import { QUALITY_LABELS, LEVEL_DEFINITIONS } from './types.ts';
import { getMonsterById, getWeeklyUpMonster, getTotalMonsterCount, getAllMonsters } from './monster-pool.ts';
import { getImmortalById, getTreasureName, getTreasureDescription } from './encounter-system.ts';
import { getLevelProgress, getExpToNextLevel, getNextLevel } from './level-system.ts';
import { getUserTreasures, getConsumableTreasures } from './treasure-system.ts';
import { getAllAchievements } from './achievement-engine.ts';

// ============ 掉落结果渲染 ============

/**
 * 渲染普通掉落结果（追加到 agent 回复末尾）
 *
 * v3: 紧凑化渲染 — 用妖怪 emoji 图标 + 单行/双行展示，大幅减少纵向空间
 */
export function renderDropResult(drop: DropResult, expResult: ExpResult, collection: UserCollection): string {
  if (!drop.monster.id) {
    return '';
  }

  const qualityLabel = drop.isShiny ? '✨' : QUALITY_LABELS[drop.monster.quality];
  const monsterEmoji = drop.monster.emoji ?? '🗡️';
  const totalMonsters = getTotalMonsterCount();
  const collectedCount = collection.entries.length;
  const tags: string[] = [];
  if (drop.isPityTriggered) tags.push('🔮保底');
  if (drop.isUpMonster) tags.push('📢UP');
  if (drop.isNew) tags.push('📖新发现');
  const tagStr = tags.length > 0 ? ` ${tags.join(' ')}` : '';

  if (drop.escaped) {
    return `\n💨 ${monsterEmoji} ${qualityLabel} **${drop.monster.name}** 逃跑！ *"${drop.monster.captureQuote}"* · +2${tagStr}`;
  }

  if (drop.isShiny) {
    return `\n🌈 ${monsterEmoji} ✨ **${drop.monster.name}** ✨ 闪光降临！ *"${drop.monster.captureQuote}"* · +${expResult.totalExp} · 📖${collectedCount}/${totalMonsters}${tagStr}`;
  }

  if (drop.monster.quality === 'epic' || drop.monster.quality === 'legendary') {
    return `\n✦ ${monsterEmoji} ${qualityLabel} **${drop.monster.name}** · *${drop.monster.origin}* · *"${drop.monster.captureQuote}"* · +${expResult.totalExp} · 📖${collectedCount}/${totalMonsters}${tagStr}`;
  }

  return `\n🗡️ ${monsterEmoji} ${qualityLabel} **${drop.monster.name}** · *"${drop.monster.captureQuote}"* · +${expResult.totalExp} · 📖${collectedCount}/${totalMonsters}${tagStr}`;
}

// ============ 升级渲染 ============

export function renderLevelUp(levelUp: LevelUpResult): string {
  const unlockPart = levelUp.unlockDescription ? ` · 🔓${levelUp.unlockDescription}` : '';
  return `\n⬆️ **升级！** ${levelUp.previousTitle} → **${levelUp.newTitle}** (Lv.${levelUp.newLevel})${unlockPart}`;
}

// ============ 机缘渲染 ============

export function renderEncounter(encounter: Encounter): string {
  const immortal = getImmortalById(encounter.immortalId);
  if (!immortal) return '';

  const typeTag = encounter.type === 'guidance' ? '🤍点化'
    : encounter.type === 'treasure' ? '💛赐宝' : '💜收徒';

  let extra = '';
  if (encounter.type === 'treasure' && encounter.treasureId) {
    extra = ` · 获得${getTreasureName(encounter.treasureId)}`;
  }
  if (encounter.type === 'apprentice') {
    extra = ' · 永久加成';
  }

  return `\n☁️ ${typeTag} **${immortal.name}**：*"${immortal.guidanceQuote}"*${extra}`;
}

// ============ 成就渲染 ============

export function renderNewAchievements(achievements: Achievement[]): string {
  if (achievements.length === 0) return '';

  return achievements.map(achievement => {
    const titlePart = achievement.titleReward ? ` 🎖️「${achievement.titleReward}」` : '';
    return `\n🏆 ${achievement.emoji} **${achievement.name}** — *${achievement.description}* · +${achievement.expReward}${titlePart}`;
  }).join('');
}

// ============ 面板渲染（命令响应） ============

/**
 * 渲染修行面板 (/修行)
 */
export function renderProfilePanel(profile: UserProfile, collection: UserCollection): string {
  const totalMonsters = getTotalMonsterCount();
  const collectedCount = collection.entries.length;
  const shinyCount = collection.entries.filter(e => e.isShiny).length;
  const progress = getLevelProgress(profile.totalExp);
  const expToNext = getExpToNextLevel(profile.totalExp);
  const nextLevel = getNextLevel(profile.level);
  const upMonster = getWeeklyUpMonster();
  const allAchievementsList = getAllAchievements();

  // 进度条（使用 emoji 圆形符号，兼容钉钉 Markdown 渲染）
  const progressBar = renderEmojiBar(progress);

  const lines = [
    `### 🐒 西游妖魔榜 · 修行面板`,
    '',
    `**修行者 ID**：${profile.uidHash.slice(0, 8)}`,
    `**称号**：${profile.title} (Lv.${profile.level})`,
  ];

  if (nextLevel) {
    lines.push(
      `**修行值**：${profile.totalExp.toLocaleString()} / ${nextLevel.requiredExp.toLocaleString()} (${progress}%)`,
      '',
      `${progressBar}`,
      '',
      `距离下一级「${nextLevel.title}」还需 ${expToNext?.toLocaleString()} 修行值`,
    );
  } else {
    lines.push(`**修行值**：${profile.totalExp.toLocaleString()} (已满级)`, '', `${renderEmojiBar(100)}`);
  }

  lines.push(
    '',
    `#### 📊 统计`,
    `- **总操作**：${profile.totalOperations} 次`,
    `- **连击中**：${profile.currentCombo} 次${profile.currentCombo >= 3 ? ` (×${getComboDisplay(profile.currentCombo)})` : ''}`,
    `- **连续签到**：${profile.consecutiveSignInDays} 天`,
    `- **最高连击**：${profile.maxCombo} 次`,
  );

  // 图鉴进度
  const qualityCounts = getQualityProgress(collection);
  lines.push(
    '',
    `#### 📖 图鉴 ${collectedCount}/${totalMonsters} (${Math.floor(collectedCount / totalMonsters * 100)}%)`,
    '',
    `| 品质 | 进度 |`,
    `|------|------|`,
  );

  for (const [label, collected, total] of qualityCounts) {
    const status = collected >= total ? ' ✅' : '';
    lines.push(`| ${label} | ${collected}/${total}${status} |`);
  }

  if (shinyCount > 0) {
    lines.push(`| ✨ 闪光 | ${shinyCount} |`);
  }

  // 保底状态
  const pity = profile.pityCounters;
  lines.push(
    '',
    `#### 🔮 保底状态`,
    `- **小保底**：${pity.sinceLastRare}/30 · **大保底**：${pity.sinceLastEpic}/80 · **天命**：${pity.sinceLastLegendary}/150`,
  );

  // UP 妖怪
  if (upMonster) {
    lines.push(
      '',
      `📢 **本周 UP**：${QUALITY_LABELS[upMonster.quality]} ${upMonster.name} (权重 ×5)`,
    );
  }

  // 成就
  lines.push(
    '',
    `🏆 **成就**：${profile.unlockedAchievements.length}/${allAchievementsList.length}`,
    `🎒 **法宝**：${profile.treasures.length} 件`,
  );

  return lines.join('\n');
}

/**
 * 渲染图鉴面板 (/图鉴)
 */
export function renderCollectionPanel(collection: UserCollection): string {
  const allMonstersList = getAllMonsters();
  const totalMonsters = getTotalMonsterCount();
  const collectedCount = collection.entries.length;

  const lines = [
    `### 📖 妖怪图鉴 · ${collectedCount}/${totalMonsters}`,
    '',
  ];

  const qualityGroups: Array<{ quality: string; label: string; monsters: Monster[] }> = [
    { quality: 'normal', label: QUALITY_LABELS.normal, monsters: allMonstersList.filter(m => m.quality === 'normal') },
    { quality: 'fine', label: QUALITY_LABELS.fine, monsters: allMonstersList.filter(m => m.quality === 'fine') },
    { quality: 'rare', label: QUALITY_LABELS.rare, monsters: allMonstersList.filter(m => m.quality === 'rare') },
    { quality: 'epic', label: QUALITY_LABELS.epic, monsters: allMonstersList.filter(m => m.quality === 'epic') },
    { quality: 'legendary', label: QUALITY_LABELS.legendary, monsters: allMonstersList.filter(m => m.quality === 'legendary') },
  ];

  for (const group of qualityGroups) {
    const collected = group.monsters.filter(m =>
      collection.entries.some(e => e.monsterId === m.id && !e.isShiny)
    );
    const uncollectedCount = group.monsters.length - collected.length;

    lines.push(`#### ${group.label} ${collected.length}/${group.monsters.length}${collected.length >= group.monsters.length ? ' ✅' : ''}`);

    if (collected.length > 0) {
      lines.push(collected.map(m => m.name).join(' · '));
    }

    if (uncollectedCount > 0) {
      lines.push(`${'❓'.repeat(Math.min(uncollectedCount, 5))} *还有 ${uncollectedCount} 只未发现*`);
    }

    lines.push('');
  }

  // 闪光
  const shinyEntries = collection.entries.filter(e => e.isShiny);
  lines.push(`#### ✨ 闪光 ${shinyEntries.length}`);
  if (shinyEntries.length > 0) {
    const shinyNames = shinyEntries.map(e => {
      const monster = getMonsterById(e.monsterId);
      return monster ? `${monster.name} ✨` : e.monsterId;
    });
    lines.push(shinyNames.join(' · '));
  } else {
    lines.push('*等级 ≥ 9 后解锁闪光掉落*');
  }

  return lines.join('\n');
}

/**
 * 渲染成就面板 (/成就)
 */
export function renderAchievementPanel(profile: UserProfile): string {
  const allAchievementsList = getAllAchievements();
  const lines = [
    `### 🏆 成就列表 · ${profile.unlockedAchievements.length}/${allAchievementsList.length}`,
    '',
  ];

  const categories = [
    { key: 'cultivation', label: '修行成就' },
    { key: 'collection', label: '收集成就' },
    { key: 'product', label: '产品成就' },
    { key: 'hidden', label: '隐藏成就' },
  ];

  for (const category of categories) {
    const categoryAchievements = allAchievementsList.filter(a => a.category === category.key);
    lines.push(`#### ${category.label}`);

    for (const achievement of categoryAchievements) {
      const unlocked = profile.unlockedAchievements.includes(achievement.id);
      const status = unlocked ? '✅' : '⬜';
      const desc = category.key === 'hidden' && !unlocked ? '???' : achievement.description;
      lines.push(`- ${status} ${achievement.emoji} **${achievement.name}** — ${desc} (+${achievement.expReward})`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 渲染法宝面板 (/法宝)
 */
export function renderTreasurePanel(profile: UserProfile): string {
  const treasures = getUserTreasures(profile);
  const consumable = getConsumableTreasures(profile);

  const lines = [
    `### 🎒 法宝背包 · ${treasures.length} 件`,
    '',
  ];

  if (treasures.length === 0) {
    lines.push('*背包空空如也，等待神仙赐宝...*');
    return lines.join('\n');
  }

  for (const treasure of treasures) {
    const consumed = profile.consumedTreasures.includes(treasure.id);
    const status = consumed ? '（已使用）' : treasure.consumable ? '（可使用）' : '（永久生效）';
    lines.push(`- **${treasure.name}** ${status}`, `  ${treasure.description}`, `  *来源：${treasure.source}*`, '');
  }

  if (consumable.length > 0) {
    lines.push('', `💡 发送 \`/使用 法宝名\` 来使用一次性法宝`);
  }

  return lines.join('\n');
}

/**
 * 渲染保底面板 (/保底)
 */
export function renderPityPanel(profile: UserProfile): string {
  const pity = profile.pityCounters;

  // v2: 软保底状态提示
  const softPityHints: string[] = [];
  if (pity.sinceLastRare >= 20) softPityHints.push(`稀有软保底已激活 +${(pity.sinceLastRare - 20) * 3}%`);
  if (pity.sinceLastEpic >= 60) softPityHints.push(`史诗软保底已激活 +${(pity.sinceLastEpic - 60) * 2}%`);
  if (pity.sinceLastLegendary >= 120) softPityHints.push(`传说软保底已激活 +${(pity.sinceLastLegendary - 120) * 1}%`);

  const lines = [
    `### 🔮 保底计数器`,
    '',
    `| 保底类型 | 当前计数 | 触发阈值 | 进度 |`,
    `|---------|---------|---------|------|`,
    `| 小保底（稀有） | ${pity.sinceLastRare} | 30 | ${Math.floor(pity.sinceLastRare / 30 * 100)}% |`,
    `| 大保底（史诗） | ${pity.sinceLastEpic} | 80 | ${Math.floor(pity.sinceLastEpic / 80 * 100)}% |`,
    `| 天命保底（传说） | ${pity.sinceLastLegendary} | 150 | ${Math.floor(pity.sinceLastLegendary / 150 * 100)}% |`,
    `| 闪光保底 | ${pity.totalDropsWithoutShiny} | 800 | ${Math.floor(pity.totalDropsWithoutShiny / 800 * 100)}% |`,
  ];

  if (softPityHints.length > 0) {
    lines.push('', `🌟 ${softPityHints.join(' · ')}`);
  }

  lines.push('', `*保底计数器在对应品质或更高品质掉落后重置*`);
  return lines.join('\n');
}

/**
 * 渲染机缘面板 (/机缘)
 */
export function renderEncounterPanel(profile: UserProfile): string {
  const lines = [
    `### ☁️ 神仙机缘录`,
    '',
  ];

  if (profile.level < 3) {
    lines.push('*等级 ≥ 3（修行者）后解锁机缘系统*');
    return lines.join('\n');
  }

  if (profile.encounters.length === 0) {
    lines.push('*尚未遇到任何神仙，继续修行吧...*');
    return lines.join('\n');
  }

  for (const encounter of profile.encounters) {
    const immortal = getImmortalById(encounter.immortalId);
    if (!immortal) continue;

    const typeLabel = encounter.type === 'guidance' ? '🤍 点化' :
      encounter.type === 'treasure' ? '💛 赐宝' : '💜 收徒';
    const date = new Date(encounter.occurredAt).toLocaleDateString('zh-CN');

    lines.push(`- ${typeLabel} **${immortal.name}** — ${date}`);
    if (encounter.type === 'treasure' && encounter.treasureId) {
      lines.push(`  赐宝：${getTreasureName(encounter.treasureId)}`);
    }
  }

  return lines.join('\n');
}

/**
 * 渲染妖魔榜 (/妖魔榜)
 */
export function renderLeaderboard(profile: UserProfile, collection: UserCollection): string {
  const upMonster = getWeeklyUpMonster();
  const totalMonsters = getTotalMonsterCount();

  const lines = [
    `### 🐒 西游妖魔榜`,
    '',
  ];

  if (upMonster) {
    lines.push(
      `#### 📢 本周 UP`,
      `${QUALITY_LABELS[upMonster.quality]} **${upMonster.name}** · ${upMonster.origin}`,
      `> "${upMonster.captureQuote}"`,
      `*在对应品质池中掉落权重 ×5*`,
      '',
    );
  }

  lines.push(
    `#### 📊 掉落统计`,
    `- **总掉落**：${profile.totalOperations} 次`,
    `- **图鉴完成度**：${collection.entries.length}/${totalMonsters}`,
    `- **闪光收服**：${collection.entries.filter(e => e.isShiny).length} 只`,
    '',
    `#### 🔮 保底状态`,
    `- 小保底：${profile.pityCounters.sinceLastRare}/30`,
    `- 大保底：${profile.pityCounters.sinceLastEpic}/80`,
    `- 天命：${profile.pityCounters.sinceLastLegendary}/150`,
  );

  return lines.join('\n');
}

/**
 * 渲染法宝使用结果
 */
export function renderTreasureUse(treasureName: string, expGained: number, currentExp: number, nextLevelExp: number | null): string {
  const emojiMap: Record<string, string> = {
    '蟠桃': '🍑',
    '人参果': '🍐',
  };
  const emoji = emojiMap[treasureName] ?? '✨';

  const lines = [
    '---',
    `${emoji} **使用了${treasureName}！**`,
    `修行值 +${expGained}${nextLevelExp ? ` · 当前 ${currentExp}/${nextLevelExp}` : ''}`,
    `> "仙物入腹，周身舒泰。"`,
  ];

  return lines.join('\n');
}

/**
 * 渲染群聊炫耀 (/炫耀)
 */
export function renderShowOff(profile: UserProfile, collection: UserCollection): string {
  const shinyCount = collection.entries.filter(e => e.isShiny).length;
  const rarest = findRarestMonster(collection);

  const lines = [
    `### 🐒 ${profile.title} (Lv.${profile.level}) 的西游妖魔榜`,
    '',
    `图鉴：${collection.entries.length}/${getTotalMonsterCount()} · 闪光：${shinyCount}`,
  ];

  if (rarest) {
    lines.push(`最稀有：${QUALITY_LABELS[rarest.quality]} ${rarest.name}`);
  }

  lines.push('', `> "此人修为不浅，诸位小心。"`);

  return lines.join('\n');
}

// ============ 辅助函数 ============

/**
 * 渲染 emoji 进度条（8 格，用圆形符号表示）
 *
 * 示例：●●●●●○○○ 62%
 */
function renderEmojiBar(percent: number): string {
  const total = 8;
  const filled = Math.round(percent / 100 * total);
  return '●'.repeat(filled) + '○'.repeat(total - filled);
}

function getComboDisplay(combo: number): string {
  if (combo >= 10) return '3.0';
  if (combo >= 5) return '2.0';
  if (combo >= 3) return '1.5';
  return '1.0';
}

function getQualityProgress(collection: UserCollection): Array<[string, number, number]> {
  const allMonstersList = getAllMonsters();
  const qualities: Array<{ label: string; quality: string }> = [
    { label: QUALITY_LABELS.normal, quality: 'normal' },
    { label: QUALITY_LABELS.fine, quality: 'fine' },
    { label: QUALITY_LABELS.rare, quality: 'rare' },
    { label: QUALITY_LABELS.epic, quality: 'epic' },
    { label: QUALITY_LABELS.legendary, quality: 'legendary' },
  ];

  return qualities.map(({ label, quality }) => {
    const total = allMonstersList.filter(m => m.quality === quality).length;
    const collected = allMonstersList.filter(m =>
      m.quality === quality && collection.entries.some(e => e.monsterId === m.id && !e.isShiny)
    ).length;
    return [label, collected, total];
  });
}

function findRarestMonster(collection: UserCollection): Monster | null {
  const qualityPriority = ['legendary', 'epic', 'rare', 'fine', 'normal'];

  for (const quality of qualityPriority) {
    const entry = collection.entries.find(e => {
      const monster = getMonsterById(e.monsterId);
      return monster?.quality === quality;
    });
    if (entry) {
      return getMonsterById(entry.monsterId) ?? null;
    }
  }

  return null;
}

// ============ v2: 悬赏令渲染 ============

import type { Bounty, DailyBountyState, RandomEvent, ChallengeEvent } from './types.ts';

const BOUNTY_TIER_LABELS: Record<string, string> = {
  bronze: '🥉 铜令',
  silver: '🥈 银令',
  gold: '🥇 金令',
};

/**
 * 渲染悬赏令面板 (/悬赏)
 */
export function renderBountyPanel(profile: UserProfile): string {
  const bountyState = profile.dailyBounty;

  if (!bountyState || bountyState.bounties.length === 0) {
    return [
      `### 📜 今日悬赏令`,
      '',
      '*今日悬赏令尚未生成，执行一次 dws 命令即可刷新。*',
    ].join('\n');
  }

  const lines = [
    `### 📜 今日悬赏令`,
    '',
  ];

  for (const bounty of bountyState.bounties) {
    const tierLabel = BOUNTY_TIER_LABELS[bounty.tier] ?? bounty.tier;
    const status = bounty.completed ? '✅' : '⬜';
    const progressPercent = Math.min(100, Math.floor(bounty.current / bounty.target * 100));
    const progressBar = renderEmojiBar(progressPercent);

    lines.push(
      `${status} **${tierLabel}**：${bounty.description}`,
      `   奖励：+${bounty.reward.exp} 修行值`,
      `   进度：${bounty.current}/${bounty.target} ${progressBar} ${progressPercent}%`,
      '',
    );
  }

  // 刷新倒计时
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const remainingMs = tomorrow.getTime() - now.getTime();
  const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
  const remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

  lines.push(`⏰ 刷新倒计时：${remainingHours} 小时 ${remainingMinutes} 分`);

  // 历史统计
  const history = profile.bountyHistory;
  lines.push(
    '',
    `#### 📊 悬赏历史`,
    `累计完成：${history.totalCompleted} 张 (🥉${history.bronzeCompleted} 🥈${history.silverCompleted} 🥇${history.goldCompleted})`,
    `连续全清：${history.consecutiveFullClear} 天`,
  );

  return lines.join('\n');
}

/**
 * 渲染悬赏令完成通知（紧凑单行）
 */
export function renderBountyComplete(bounty: Bounty): string {
  const tierLabel = BOUNTY_TIER_LABELS[bounty.tier] ?? bounty.tier;
  return `\n📜 **${tierLabel}完成！** 「${bounty.description}」 · +${bounty.reward.exp}`;
}

// ============ v2: 随机事件渲染 ============

const EVENT_CATEGORY_EMOJI: Record<string, string> = {
  blessing: '🌟',
  challenge: '⚔️',
  disaster: '😈',
};

/**
 * 渲染随机事件触发通知（紧凑版）
 */
export function renderEventTrigger(event: RandomEvent | ChallengeEvent): string {
  const emoji = EVENT_CATEGORY_EMOJI[event.category] ?? '🎲';
  const durationStr = event.duration.type !== 'instant' ? ` (${event.duration.remaining}/${event.duration.total})` : '';

  if (event.category === 'challenge') {
    const challenge = event as ChallengeEvent;
    return `\n${emoji} **${event.name}** — ${event.description} · 🏆+${challenge.successReward.exp} 💀-${challenge.failurePenalty.expLoss} · ⏰${challenge.operationLimit}次`;
  }

  const resolvePart = (event.category === 'disaster' && event.resolution) ? ` · 💡${event.resolution.description}` : '';
  return `\n${emoji} **${event.name}** — ${event.description}${durationStr}${resolvePart}`;
}

/**
 * 渲染挑战事件结果（紧凑单行）
 */
export function renderChallengeResult(event: ChallengeEvent, success: boolean): string {
  if (success) {
    const pityPart = event.successReward.pityBonus ? ` · 保底+${event.successReward.pityBonus}` : '';
    return `\n🏆 **${event.name} · 挑战成功！** +${event.successReward.exp}${pityPart}`;
  }
  const comboPart = event.failurePenalty.comboReset ? ' · 连击归零' : '';
  return `\n💀 **${event.name} · 挑战失败** -${event.failurePenalty.expLoss}${comboPart}`;
}

/**
 * 渲染灾厄事件化解通知
 */
export function renderDisasterResolved(event: RandomEvent): string {
  return [
    '',
    '---',
    `🛡️ **${event.name} · 已化解！**`,
    `*灾厄消散，天地清明。*`,
  ].join('\n');
}

/**
 * 渲染事件面板 (/事件)
 */
export function renderEventPanel(profile: UserProfile): string {
  const activeState = profile.activeEvents;
  const lines = [
    `### 🎲 随机事件`,
    '',
  ];

  // 当前活跃事件
  if (activeState.currentEvents.length === 0 && !activeState.activeChallenge) {
    lines.push('*当前没有活跃的随机事件。*');
  } else {
    if (activeState.currentEvents.length > 0) {
      lines.push(`#### 当前生效`);
      for (const event of activeState.currentEvents) {
        const emoji = EVENT_CATEGORY_EMOJI[event.category] ?? '🎲';
        const remaining = event.duration.type !== 'instant'
          ? ` (剩余 ${event.duration.remaining}/${event.duration.total})`
          : '';
        lines.push(`- ${emoji} **${event.name}**：${event.description}${remaining}`);
        if (event.resolution) {
          lines.push(`  💡 化解：${event.resolution.description}`);
        }
      }
      lines.push('');
    }

    if (activeState.activeChallenge) {
      const challenge = activeState.activeChallenge;
      lines.push(
        `#### ⚔️ 进行中的挑战`,
        `**${challenge.name}**：${challenge.description}`,
        `进度：${challenge.challengeCondition.current}/${challenge.challengeCondition.target}`,
        `操作次数：${challenge.progress.operationsUsed}/${challenge.progress.operationLimit}`,
        '',
      );
    }
  }

  // 事件统计
  const stats = profile.eventStats;
  lines.push(
    `#### 📊 事件统计`,
    `- **累计触发**：${stats.totalTriggered} 次`,
    `- **挑战完成**：${stats.challengesCompleted} 次`,
    `- **挑战失败**：${stats.challengesFailed} 次`,
    `- **灾厄化解**：${stats.disastersResolved} 次`,
  );

  return lines.join('\n');
}
