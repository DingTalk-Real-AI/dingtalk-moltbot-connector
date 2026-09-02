/**
 * Test utilities for DingTalk OpenClaw Connector
 *
 * Shared mock factories and helpers used across unit test files.
 */

import { vi } from 'vitest';
import type { OpenClawConfig as ClawdbotConfig } from 'openclaw/plugin-sdk/config-contracts';

/**
 * Create a mock ClawdbotConfig with dingtalk-connector channel configured.
 */
export function createMockClawdbotConfig(overrides: Partial<{
  clientId: string;
  clientSecret: string;
  enabled: boolean;
  allowFrom: (string | number)[];
  groupAllowFrom: (string | number)[];
  groupPolicy: string;
  groups: Record<string, any>;
}> = {}): ClawdbotConfig {
  return {
    channels: {
      'dingtalk-connector': {
        enabled: overrides.enabled ?? true,
        clientId: overrides.clientId ?? 'test-client-id',
        clientSecret: overrides.clientSecret ?? 'test-client-secret',
        ...(overrides.allowFrom ? { allowFrom: overrides.allowFrom } : {}),
        ...(overrides.groupAllowFrom ? { groupAllowFrom: overrides.groupAllowFrom } : {}),
        ...(overrides.groupPolicy ? { groupPolicy: overrides.groupPolicy } : {}),
        ...(overrides.groups ? { groups: overrides.groups } : {}),
      },
    },
  } as ClawdbotConfig;
}

/**
 * Create a mock logger with vi.fn() stubs.
 */
export function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}
