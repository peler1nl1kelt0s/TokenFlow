import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { runExecCommand } from './exec.js';
import * as serverModule from '../proxy/server.js';

// Mock child_process spawn
vi.mock('child_process', () => {
  const mockChild = {
    on: vi.fn((event, cb) => {
      if (event === 'close') {
        // Delay callback to simulate async process run
        setTimeout(() => cb(0), 10);
      }
    }),
    kill: vi.fn(),
  };
  return {
    spawn: vi.fn().mockReturnValue(mockChild),
  };
});

// Mock proxy server boot
vi.spyOn(serverModule, 'startProxyServer').mockResolvedValue({
  server: { close: vi.fn() },
  isDaemonShared: false,
  getStats: vi.fn().mockReturnValue({
    startTime: Date.now(),
    totalRequests: 1,
    totalActualTokens: 50,
    totalEstimatedTokens: 100,
    multiplier: 1.0,
    cost: 0.12,
  }),
} as any);

describe('CLI Execution Wrapper', () => {
  let originalExit: any;

  beforeEach(() => {
    originalExit = process.exit;
    (process as any).exit = vi.fn();
  });

  afterEach(() => {
    process.exit = originalExit;
    vi.clearAllMocks();
  });

  it('should start proxy server and spawn child process with env overrides', async () => {
    await runExecCommand(['mock-agent', '--flag'], { port: 9099, tpm: 1000, rpm: 10, budget: 0 });

    // Verify proxy server was started on port 9099
    expect(serverModule.startProxyServer).toHaveBeenCalledWith({ port: 9099, tpm: 1000, rpm: 10, budgetLimit: 0 });

    // Verify spawn was called with correct command and args
    expect(spawn).toHaveBeenCalled();
    const [command, args, options] = vi.mocked(spawn).mock.calls[0];
    
    expect(command).toBe('mock-agent');
    expect(args).toEqual(['--flag']);
    
    // Verify environment variables were correctly injected
    expect(options?.env).toBeDefined();
    expect(options?.env?.ANTHROPIC_BASE_URL).toContain('http://localhost:9099');
    expect(options?.env?.OPENAI_BASE_URL).toContain('http://localhost:9099/v1');
    expect(options?.env?.OPENAI_API_BASE).toContain('http://localhost:9099/v1');

    // Wait for async child process close handler to execute before tearing down process.exit mock
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
});
