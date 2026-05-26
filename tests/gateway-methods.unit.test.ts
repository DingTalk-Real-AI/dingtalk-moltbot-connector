/**
 * Gateway Methods 单元测试
 * 
 * 直接测试 Gateway Methods 的注册和业务逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { registerGatewayMethods } from '../src/gateway-methods';
import {
  DINGTALK_CARD_BRIDGE_SYMBOL,
  getDingtalkCardBridge,
  installDingtalkCardBridge,
  registerDingtalkCardGatewayMethods,
} from '../src/services/card-bridge';

const {
  mockCreateAICardForTarget,
  mockStreamAICard,
  mockFinishAICard,
} = vi.hoisted(() => ({
  mockCreateAICardForTarget: vi.fn(),
  mockStreamAICard: vi.fn(),
  mockFinishAICard: vi.fn(),
}));

// ============ Mock 数据 ============

const mockConfig = {
  channels: {
    'dingtalk-connector': {
      enabled: true,
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret',
    },
  },
};

// Mock loadConfig：gateway-methods.ts 通过动态 import 获取配置
vi.mock('openclaw/plugin-sdk/config-runtime', () => ({
  loadConfig: () => mockConfig,
}));

vi.mock('../src/services/messaging/card', () => ({
  createAICardForTarget: mockCreateAICardForTarget,
  streamAICard: mockStreamAICard,
  finishAICard: mockFinishAICard,
}));

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

// ============ 辅助函数 ============

/**
 * 创建 Mock API
 */
function createMockApi() {
  const handlers = new Map<string, Function>();
  
  const api: Partial<OpenClawPluginApi> = {
    logger: mockLogger,
    registerGatewayMethod: vi.fn((name: string, handler: Function) => {
      handlers.set(name, handler);
    }),
  };

  return {
    api: api as OpenClawPluginApi,
    handlers,
    callMethod: async (name: string, params: unknown = {}) => {
      const handler = handlers.get(name);
      if (!handler) {
        throw new Error(`Method ${name} not registered`);
      }

      let result: any;
      let ok: boolean | undefined;
      let error: any;

      const respond = (success: boolean, payload?: any, err?: any) => {
        ok = success;
        result = payload;
        error = err;
      };

      const context = {
        deps: {},
      };

      await handler({ context, params, respond });

      return { ok, result, error };
    },
  };
}

// ============ 测试套件 ============

describe('Gateway Methods - 注册', () => {
  it('应该注册所有方法', () => {
    const { api, handlers } = createMockApi();
    registerGatewayMethods(api);
    registerDingtalkCardGatewayMethods(api);

    // 验证所有方法都已注册
    expect(handlers.has('dingtalk-connector.sendToUser')).toBe(true);
    expect(handlers.has('dingtalk-connector.sendToGroup')).toBe(true);
    expect(handlers.has('dingtalk-connector.send')).toBe(true);
    expect(handlers.has('dingtalk-connector.docs.read')).toBe(true);
    expect(handlers.has('dingtalk-connector.docs.create')).toBe(true);
    expect(handlers.has('dingtalk-connector.docs.append')).toBe(true);
    expect(handlers.has('dingtalk-connector.docs.search')).toBe(true);
    expect(handlers.has('dingtalk-connector.docs.list')).toBe(true);
    expect(handlers.has('dingtalk-connector.status')).toBe(true);
    expect(handlers.has('dingtalk-connector.probe')).toBe(true);
    expect(handlers.has('dingtalk-connector.fixStuckCards')).toBe(true);
    expect(handlers.has('dingtalk-connector.listAccounts')).toBe(true);
    expect(handlers.has('dingtalk-connector.bootstrapBotIdentity')).toBe(true);
    expect(handlers.has('dingtalk-connector.card.create')).toBe(true);
    expect(handlers.has('dingtalk-connector.card.update')).toBe(true);

    // 10 原有 + fixStuckCards + listAccounts + bootstrapBotIdentity + card.create/update
    expect(handlers.size).toBe(15);
  });
});

describe('Gateway Methods - 参数验证', () => {
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    mockApi = createMockApi();
    registerGatewayMethods(mockApi.api);
  });

  it('sendToUser 缺少 userId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.sendToUser', {
      content: '测试消息',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('userId');
  });

  it('sendToUser 缺少 content 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.sendToUser', {
      userId: 'test_user',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('content');
  });

  it('sendToGroup 缺少 openConversationId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.sendToGroup', {
      content: '测试消息',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('openConversationId');
  });

  it('sendToGroup 缺少 content 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.sendToGroup', {
      openConversationId: 'test_cid',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('content');
  });

  it('send 缺少 target 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.send', {
      content: '测试消息',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('target');
  });

  it('send 缺少 content 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.send', {
      target: 'user:test_user',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('content');
  });

  it('docs.read 缺少 docId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.read', {
      operatorId: 'test_operator',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('docId');
  });

  it('docs.read 缺少 operatorId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.read', {
      docId: 'test_doc',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('operatorId');
  });

  it('docs.create 缺少 spaceId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.create', {
      title: '测试文档',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('spaceId');
  });

  it('docs.create 缺少 title 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.create', {
      spaceId: 'test_space',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('title');
  });

  it('docs.append 缺少 docId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.append', {
      content: '测试内容',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('docId');
  });

  it('docs.append 缺少 content 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.append', {
      docId: 'test_doc',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('content');
  });

  it('docs.search 缺少 keyword 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.search', {});

    expect(ok).toBe(false);
    expect(result?.error).toContain('keyword');
  });

  it('docs.list 缺少 spaceId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.list', {});

    expect(ok).toBe(false);
    expect(result?.error).toContain('spaceId');
  });
});

describe('Gateway Methods - 状态检查', () => {
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    mockApi = createMockApi();
    registerGatewayMethods(mockApi.api);
  });

  it('status 应该返回配置状态', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.status');

    expect(ok).toBe(true);
    expect(result).toHaveProperty('configured');
    expect(result).toHaveProperty('enabled');
    expect(result).toHaveProperty('accountId');
    expect(result).toHaveProperty('clientId');
    expect(result.configured).toBe(true);
    expect(result.enabled).toBe(true);
  });


});

describe('Gateway Methods - 配置读取', () => {
  it('应该能通过 loadConfig 获取配置', async () => {
    const { api, handlers } = createMockApi();
    registerGatewayMethods(api);

    const handler = handlers.get('dingtalk-connector.status');
    expect(handler).toBeDefined();

    const respond = vi.fn();
    const context = {
      deps: {},
    };

    await handler!({ context, params: {}, respond });

    // 验证 respond 被调用且成功（loadConfig 已被 mock 返回 mockConfig）
    expect(respond).toHaveBeenCalled();
    expect(respond.mock.calls[0][0]).toBe(true);
  });
});

describe('Card Gateway Methods - 参数验证', () => {
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as any)[DINGTALK_CARD_BRIDGE_SYMBOL];
    mockCreateAICardForTarget.mockResolvedValue({
      cardInstanceId: 'card_test_1',
      accessToken: 'token',
      tokenExpireTime: Date.now() + 60_000,
      inputingStarted: false,
    });
    mockStreamAICard.mockResolvedValue(undefined);
    mockFinishAICard.mockResolvedValue(undefined);
    mockApi = createMockApi();
    registerDingtalkCardGatewayMethods(mockApi.api);
  });

  it('card.create 缺少 target 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.card.create', {
      markdown: '处理中',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('target');
  });

  it('card.update 缺少 cardInstanceId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.card.update', {
      markdown: '处理中',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('cardInstanceId');
  });

  it('card.update 未知 cardInstanceId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.card.update', {
      cardInstanceId: 'card_missing',
      markdown: '处理中',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('Unknown cardInstanceId');
  });

  it('card.create 应支持 user/group/cid target 格式并拒绝非法格式', async () => {
    const cases = [
      ['user:user_123', { type: 'user', userId: 'user_123' }, 'user:user_123'],
      ['group:cid-group_123', { type: 'group', openConversationId: 'cid-group_123' }, 'group:cid-group_123'],
      ['cid_direct_123', { type: 'group', openConversationId: 'cid_direct_123' }, 'group:cid_direct_123'],
      [
        'cidLY0TRpE+Ka//RsguNtQnHw==',
        { type: 'group', openConversationId: 'cidLY0TRpE+Ka//RsguNtQnHw==' },
        'group:cidLY0TRpE+Ka//RsguNtQnHw==',
      ],
      [
        'cid=26896013',
        { type: 'group', openConversationId: 'cid=26896013' },
        'group:cid=26896013',
      ],
      [
        'group:cidLY0TRpE+Ka//RsguNtQnHw==',
        { type: 'group', openConversationId: 'cidLY0TRpE+Ka//RsguNtQnHw==' },
        'group:cidLY0TRpE+Ka//RsguNtQnHw==',
      ],
    ] as const;

    for (const [target, expectedTarget, expectedReturn] of cases) {
      mockCreateAICardForTarget.mockResolvedValueOnce({
        cardInstanceId: `card_${target.replace(/[^a-zA-Z0-9]/g, '_')}`,
        accessToken: 'token',
        tokenExpireTime: Date.now() + 60_000,
        inputingStarted: false,
      });

      const { ok, result } = await mockApi.callMethod('dingtalk-connector.card.create', {
        target,
        markdown: '处理中',
      });

      expect(ok).toBe(true);
      expect(result?.target).toBe(expectedReturn);
      expect(mockCreateAICardForTarget).toHaveBeenLastCalledWith(
        expect.any(Object),
        expectedTarget,
        mockLogger,
      );
    }

    for (const target of [
      'plain_user',
      'ding:user:user_123',
      '<script>alert(1)</script>',
      'group:cid<script>alert(1)</script>',
      'user:user"123',
      `user:${'a'.repeat(257)}`,
    ]) {
      const { ok, result } = await mockApi.callMethod('dingtalk-connector.card.create', {
        target,
      });

      expect(ok).toBe(false);
      expect(result?.error).toContain('target');
    }
  });

  it('card.create 应原样返回公开错误并过滤内部错误', async () => {
    mockCreateAICardForTarget.mockResolvedValueOnce(null);
    const publicFailure = await mockApi.callMethod('dingtalk-connector.card.create', {
      target: 'user:user_123',
    });

    expect(publicFailure.ok).toBe(false);
    expect(publicFailure.result?.error).toBe('Failed to create DingTalk AI Card');

    mockCreateAICardForTarget.mockRejectedValueOnce(new Error('token=secret internal create failure'));
    const internalFailure = await mockApi.callMethod('dingtalk-connector.card.create', {
      target: 'user:user_123',
    });

    expect(internalFailure.ok).toBe(false);
    expect(internalFailure.result?.error).toBe('card.create failed');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('token=secret internal create failure'),
    );
  });

  it('card.create -> card.update(running) -> card.update(completed) 应完成完整生命周期', async () => {
    const { ok: createOk, result: createResult } = await mockApi.callMethod('dingtalk-connector.card.create', {
      target: 'user:user_123',
      markdown: '启动',
    });

    expect(createOk).toBe(true);
    expect(createResult?.cardInstanceId).toBe('card_test_1');
    expect(mockStreamAICard).toHaveBeenCalledWith(
      expect.objectContaining({ cardInstanceId: 'card_test_1' }),
      '启动',
      false,
      expect.any(Object),
      mockLogger,
    );

    const { ok: runningOk, result: runningResult } = await mockApi.callMethod('dingtalk-connector.card.update', {
      cardInstanceId: 'card_test_1',
      markdown: '处理中',
      status: 'running',
    });

    expect(runningOk).toBe(true);
    expect(runningResult?.status).toBe('running');
    expect(mockStreamAICard).toHaveBeenLastCalledWith(
      expect.objectContaining({ cardInstanceId: 'card_test_1' }),
      '处理中',
      false,
      expect.any(Object),
      mockLogger,
    );

    const { ok: completedOk, result: completedResult } = await mockApi.callMethod('dingtalk-connector.card.update', {
      cardInstanceId: 'card_test_1',
      markdown: '完整报告',
      status: 'completed',
    });

    expect(completedOk).toBe(true);
    expect(completedResult?.status).toBe('completed');
    expect(mockFinishAICard).toHaveBeenCalledWith(
      expect.objectContaining({ cardInstanceId: 'card_test_1' }),
      '完整报告',
      expect.any(Object),
      mockLogger,
    );

    const retry = await mockApi.callMethod('dingtalk-connector.card.update', {
      cardInstanceId: 'card_test_1',
      markdown: '不应成功',
    });
    expect(retry.ok).toBe(false);
    expect(retry.result?.error).toContain('Unknown cardInstanceId');
  });

  it('card.update completed 即使 finishAICard 抛错也应回收 card record', async () => {
    await mockApi.callMethod('dingtalk-connector.card.create', {
      target: 'user:user_123',
    });
    mockFinishAICard.mockRejectedValueOnce(new Error('finish failed'));

    const completed = await mockApi.callMethod('dingtalk-connector.card.update', {
      cardInstanceId: 'card_test_1',
      markdown: '完整报告',
      status: 'completed',
    });

    expect(completed.ok).toBe(false);
    expect(completed.result?.error).toBe('card.update failed');

    const retry = await mockApi.callMethod('dingtalk-connector.card.update', {
      cardInstanceId: 'card_test_1',
      markdown: '重试',
    });

    expect(retry.ok).toBe(false);
    expect(retry.result?.error).toContain('Unknown cardInstanceId');
  });

  it('card.update completed 应过滤内部 finishAICard 错误消息', async () => {
    await mockApi.callMethod('dingtalk-connector.card.create', {
      target: 'user:user_123',
    });
    mockFinishAICard.mockRejectedValueOnce(new Error('token=secret internal stack'));

    const completed = await mockApi.callMethod('dingtalk-connector.card.update', {
      cardInstanceId: 'card_test_1',
      markdown: '完整报告',
      status: 'completed',
    });

    expect(completed.ok).toBe(false);
    expect(completed.result?.error).toBe('card.update failed');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('token=secret internal stack'),
    );
  });

  it('card.update failed 缺少 markdown 时应使用默认失败文案', async () => {
    await mockApi.callMethod('dingtalk-connector.card.create', {
      target: 'user:user_123',
    });

    const failed = await mockApi.callMethod('dingtalk-connector.card.update', {
      cardInstanceId: 'card_test_1',
      status: 'failed',
    });

    expect(failed.ok).toBe(true);
    expect(mockFinishAICard).toHaveBeenCalledWith(
      expect.objectContaining({ cardInstanceId: 'card_test_1' }),
      'Task failed',
      expect.any(Object),
      mockLogger,
    );
  });

  it('card.create 时应清理超过 TTL 的旧 card record', async () => {
    const realDateNow = Date.now;
    let currentTime = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
    mockCreateAICardForTarget
      .mockResolvedValueOnce({
        cardInstanceId: 'card_expired',
        accessToken: 'token',
        tokenExpireTime: currentTime + 60_000,
        inputingStarted: false,
      })
      .mockResolvedValueOnce({
        cardInstanceId: 'card_current',
        accessToken: 'token',
        tokenExpireTime: currentTime + 60_000,
        inputingStarted: false,
      });

    try {
      await mockApi.callMethod('dingtalk-connector.card.create', {
        target: 'user:user_123',
      });

      currentTime += 24 * 60 * 60 * 1000 + 1;

      await mockApi.callMethod('dingtalk-connector.card.create', {
        target: 'user:user_456',
      });

      const expired = await mockApi.callMethod('dingtalk-connector.card.update', {
        cardInstanceId: 'card_expired',
        markdown: '不应成功',
      });
      const current = await mockApi.callMethod('dingtalk-connector.card.update', {
        cardInstanceId: 'card_current',
        markdown: '仍可更新',
      });

      expect(expired.ok).toBe(false);
      expect(expired.result?.error).toContain('Unknown cardInstanceId');
      expect(current.ok).toBe(true);
    } finally {
      Date.now = realDateNow;
    }
  });

  it('同一个 card 的 update 应串行执行', async () => {
    await mockApi.callMethod('dingtalk-connector.card.create', {
      target: 'user:user_123',
    });

    const order: string[] = [];
    mockStreamAICard.mockImplementation(async (_card, markdown) => {
      order.push(`start:${markdown}`);
      await new Promise((resolve) => setTimeout(resolve, markdown === 'first' ? 20 : 0));
      order.push(`end:${markdown}`);
    });

    await Promise.all([
      mockApi.callMethod('dingtalk-connector.card.update', {
        cardInstanceId: 'card_test_1',
        markdown: 'first',
        status: 'running',
      }),
      mockApi.callMethod('dingtalk-connector.card.update', {
        cardInstanceId: 'card_test_1',
        markdown: 'second',
        status: 'running',
      }),
    ]);

    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('installDingtalkCardBridge 应安装可发现的同进程 bridge', () => {
    installDingtalkCardBridge(mockApi.api);
    const bridge = getDingtalkCardBridge();

    expect(bridge).toBeDefined();
    expect(bridge).toBe((globalThis as any)[DINGTALK_CARD_BRIDGE_SYMBOL]);
    expect(typeof bridge?.create).toBe('function');
    expect(typeof bridge?.update).toBe('function');
  });
});

console.log('✅ 单元测试完成');
