import { describe, expect, it } from 'vitest';
import {
  CHAT_MAX_AUTO_RETRIES,
  classifyChatError,
  isChatQueueItem,
  retryDelayMs,
} from './offlineQueue';

describe('shared chat offline queue', () => {
  it('uses bounded exponential retry', () => {
    expect(retryDelayMs(0)).toBe(1000);
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(2)).toBe(4000);
    expect(retryDelayMs(3)).toBe(8000);
    expect(retryDelayMs(CHAT_MAX_AUTO_RETRIES + 2)).toBe(30000);
  });

  it('classifies permanent and transient errors', () => {
    expect(classifyChatError({ status: 401, message: 'JWT expired' })).toBe('AUTH_ERROR');
    expect(classifyChatError({ status: 403, message: 'permission denied' })).toBe('PERMISSION_ERROR');
    expect(classifyChatError({ status: 429, message: 'rate limit' })).toBe('RATE_LIMIT');
    expect(classifyChatError({ status: 503, message: 'service unavailable' })).toBe('SERVER_ERROR');
    expect(classifyChatError(new Error('Failed to fetch'))).toBe('NETWORK_ERROR');
    expect(classifyChatError({ status: 400, message: 'invalid message' })).toBe('VALIDATION_ERROR');
  });

  it('identifies only the existing chat insertion RPC as a chat queue item', () => {
    expect(isChatQueueItem({
      id: '1',
      createdAt: new Date().toISOString(),
      userId: 'u',
      functionName: 'chat_insert_message',
      args: { client_uuid: 'c', p_conversation_id: 'conversation' },
      attempts: 0,
    })).toBe(true);
    expect(isChatQueueItem({
      id: '2',
      createdAt: new Date().toISOString(),
      userId: 'u',
      functionName: 'create_operational_reminder',
      args: {},
      attempts: 0,
    })).toBe(false);
  });
});
