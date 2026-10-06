import { describe, expect, it } from 'vitest';
import {
  CHAT_MAX_AUTO_RETRIES,
  classifyChatSendError,
  isAutoRetryableChatError,
  retryDelayMs,
} from './messageOutbox';

describe('chat message outbox policy', () => {
  it('uses bounded exponential backoff', () => {
    expect(retryDelayMs(0)).toBe(1000);
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(2)).toBe(4000);
    expect(retryDelayMs(3)).toBe(8000);
    expect(retryDelayMs(8)).toBeLessThanOrEqual(30000);
  });

  it('retries only transient failures', () => {
    expect(isAutoRetryableChatError('NETWORK_ERROR')).toBe(true);
    expect(isAutoRetryableChatError('SERVER_ERROR')).toBe(true);
    expect(isAutoRetryableChatError('RATE_LIMIT')).toBe(true);
    expect(isAutoRetryableChatError('AUTH_ERROR')).toBe(false);
    expect(isAutoRetryableChatError('PERMISSION_ERROR')).toBe(false);
    expect(isAutoRetryableChatError('VALIDATION_ERROR')).toBe(false);
  });

  it('classifies common Supabase/network failures', () => {
    expect(classifyChatSendError({ status: 401, message: 'JWT expired' })).toBe('AUTH_ERROR');
    expect(classifyChatSendError({ status: 403, message: 'permission denied' })).toBe('PERMISSION_ERROR');
    expect(classifyChatSendError({ status: 429, message: 'rate limit' })).toBe('RATE_LIMIT');
    expect(classifyChatSendError({ status: 503, message: 'service unavailable' })).toBe('SERVER_ERROR');
    expect(classifyChatSendError(new Error('Failed to fetch'))).toBe('NETWORK_ERROR');
  });

  it('caps automatic retry count', () => {
    expect(CHAT_MAX_AUTO_RETRIES).toBe(8);
    expect(retryDelayMs(CHAT_MAX_AUTO_RETRIES + 100)).toBe(30000);
  });
});
