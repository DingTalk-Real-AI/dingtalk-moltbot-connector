/**
 * 空回复兜底文案
 *
 * 群聊空 final 常由 OpenClaw `messages.groupChat.visibleReplies` 未设为 "automatic"
 * 触发；本测试锁定兜底文案的分流契约：
 *   - 群聊：必须给出可操作的修复指引，至少包含 visibleReplies / automatic 关键字
 *   - 单聊：用口语化确认语兜底，避免「任务执行完成（无文本输出）」让用户误判为报错；
 *           不应再出现「任务执行完成」「无文本输出」「无输出」等带技术味的字样
 *   - 日志 hint：要包含 openclaw.json 片段和 messages.groupChat 关键字
 */
import { describe, it, expect } from 'vitest';
import {
  pickEmptyReplyFallbackText,
  emptyGroupReplyLogHint,
  groupChatLacksVisibleRepliesAutomatic,
} from '../src/utils/empty-reply.ts';

describe('pickEmptyReplyFallbackText', () => {
  it('单聊兜底文案不再出现「任务执行完成」/「无文本输出」等报错感字样', () => {
    const text = pickEmptyReplyFallbackText(false);
    expect(text).not.toContain('任务执行完成');
    expect(text).not.toContain('无文本输出');
    expect(text).not.toContain('无输出');
  });

  it('单聊兜底文案是口语化确认语并邀请继续提问', () => {
    const text = pickEmptyReplyFallbackText(false);
    // 用「好」开头的口语化确认（"好的" / "好嘞" 等），并包含可继续追问的引导
    expect(text).toMatch(/^好/);
    expect(text).toMatch(/(找我|问我|继续|有.*问题)/);
  });

  it('群聊给出包含 visibleReplies / automatic 的修复指引', () => {
    const text = pickEmptyReplyFallbackText(true);
    expect(text).toContain('visibleReplies');
    expect(text).toContain('automatic');
  });

  it('群聊文案与单聊不同（确保分流生效）', () => {
    const direct = pickEmptyReplyFallbackText(false);
    const group = pickEmptyReplyFallbackText(true);
    expect(group).not.toBe(direct);
  });

  it('群聊文案不抛配置细节给终端用户，要建议联系管理员', () => {
    const text = pickEmptyReplyFallbackText(true);
    expect(text).toMatch(/管理员/);
  });
});

describe('groupChatLacksVisibleRepliesAutomatic', () => {
  it('cfg 缺失或 messages 为空视为未配置 automatic', () => {
    expect(groupChatLacksVisibleRepliesAutomatic(undefined)).toBe(true);
    expect(groupChatLacksVisibleRepliesAutomatic({})).toBe(true);
    expect(groupChatLacksVisibleRepliesAutomatic({ messages: {} })).toBe(true);
    expect(
      groupChatLacksVisibleRepliesAutomatic({ messages: { groupChat: {} } }),
    ).toBe(true);
  });

  it('仅当 visibleReplies 为 automatic 时视为已配置', () => {
    expect(
      groupChatLacksVisibleRepliesAutomatic({
        messages: { groupChat: { visibleReplies: 'automatic' } },
      }),
    ).toBe(false);
    expect(
      groupChatLacksVisibleRepliesAutomatic({
        messages: { groupChat: { visibleReplies: 'tool_only' } },
      }),
    ).toBe(true);
  });
});

describe('emptyGroupReplyLogHint', () => {
  it('日志指引包含 openclaw.json 片段', () => {
    const hint = emptyGroupReplyLogHint();
    expect(hint).toContain('messages');
    expect(hint).toContain('groupChat');
    expect(hint).toContain('visibleReplies');
    expect(hint).toContain('automatic');
  });

  it('指引点出根因（message_tool_only / source-reply-delivery-mode）', () => {
    const hint = emptyGroupReplyLogHint();
    expect(hint).toContain('message_tool_only');
  });
});
