import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenRateLimiter } from './limiter.js';
import { TokenFlowScheduler } from './scheduler.js';

describe('TokenRateLimiter', () => {
  let limiter: TokenRateLimiter;

  beforeEach(() => {
    limiter = new TokenRateLimiter({ tpm: 100, rpm: 3 });
  });

  it('should accept requests under the limits', () => {
    const now = Date.now();
    expect(limiter.canAccept(30, now)).toBe(true);
    limiter.record(30, now);
    expect(limiter.getUsage(now)).toEqual({ tokens: 30, requests: 1 });

    expect(limiter.canAccept(50, now)).toBe(true);
    limiter.record(50, now);
    expect(limiter.getUsage(now)).toEqual({ tokens: 80, requests: 2 });
  });

  it('should reject requests exceeding TPM limits', () => {
    const now = Date.now();
    limiter.record(80, now);
    // Over the limit: 80 + 30 = 110 > 100
    expect(limiter.canAccept(30, now)).toBe(false);
  });

  it('should reject requests exceeding RPM limits', () => {
    const now = Date.now();
    limiter.record(10, now);
    limiter.record(10, now + 1000);
    limiter.record(10, now + 2000);
    // Over the limit: 4 requests in last 60 seconds
    expect(limiter.canAccept(10, now + 3000)).toBe(false);
  });

  it('should calculate time until available correctly', () => {
    const now = Date.now();
    limiter.record(80, now); // timestamp: now
    
    // We want to request 30 tokens (over limit: total 110)
    // To fit, the 80 token request must expire, which happens after 60000ms.
    const delay = limiter.timeUntilAvailable(30, now);
    expect(delay).toBe(60000);
  });
});

describe('TokenFlowScheduler', () => {
  it('should schedule and execute jobs in priority order', async () => {
    const scheduler = new TokenFlowScheduler({ tpm: 100000, rpm: 100 });
    scheduler.pause();
    
    const results: string[] = [];
    
    const jobA = scheduler.submit('jobA', async () => {
      results.push('A');
      return 'resA';
    }, { priority: 1, tokensEstimate: 1 });

    const jobB = scheduler.submit('jobB', async () => {
      results.push('B');
      return 'resB';
    }, { priority: 10, tokensEstimate: 1 }); // Higher priority

    const jobC = scheduler.submit('jobC', async () => {
      results.push('C');
      return 'resC';
    }, { priority: 5, tokensEstimate: 1 });

    // Verify they are queued but not started
    expect(results).toEqual([]);
    expect(scheduler.getQueueLength()).toBe(3);

    // Resume scheduler to process queue in sorted priority order
    scheduler.resume();

    const final = await Promise.all([jobA, jobB, jobC]);

    expect(results).toEqual(['B', 'C', 'A']);
    expect(final).toEqual(['resA', 'resB', 'resC']);
  });

  it('should balance execution fairly between different sessions using DRR', async () => {
    const scheduler = new TokenFlowScheduler({ tpm: 100000, rpm: 100 });
    scheduler.pause();

    const results: string[] = [];

    // Session A enqueues 2 large jobs (each requiring 12000 tokens, exceeding quantum 10000)
    const jobA1 = scheduler.submit('jobA1', async () => { results.push('A1'); }, { tokensEstimate: 12000, sessionId: 'sessionA' });
    const jobA2 = scheduler.submit('jobA2', async () => { results.push('A2'); }, { tokensEstimate: 12000, sessionId: 'sessionA' });

    // Session B enqueues 1 small job (3000 tokens)
    const jobB1 = scheduler.submit('jobB1', async () => { results.push('B1'); }, { tokensEstimate: 3000, sessionId: 'sessionB' });

    scheduler.resume();
    await Promise.all([jobA1, jobA2, jobB1]);

    // Because session A's first job requires 12000 tokens (which is > quantum of 10000),
    // it cannot run in the first turn. Session B's job requires 3000 tokens (<= 10000),
    // so it executes first. A runs in subsequent rounds once deficit quota accumulates.
    expect(results[0]).toBe('B1');
  });
});
