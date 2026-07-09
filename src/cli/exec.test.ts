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
vi.spyOn(serverModule, 'startProxyServer').mockReturnValue({
  close: vi.fn(),
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
    runExecCommand(['mock-agent', '--flag'], { port: 9099, tpm: 1000, rpm: 10 });

    // Verify proxy server was started on port 9099
    expect(serverModule.startProxyServer).toHaveBeenCalledWith({ port: 9099, tpm: 1000, rpm: 10 });

    // Verify spawn was called with correct command and args
    expect(spawn).toHaveBeenCalled();
    const [command, args, options] = vi.mocked(spawn).mock.calls[0];
    
    expect(command).toBe('mock-agent');
    expect(args).toEqual(['--flag']);
    
    // Verify environment variables were correctly injected
    expect(options?.env).toBeDefined();
    expect(options?.env?.ANTHROPIC_BASE_URL).toBe('http://localhost:9099');
    expect(options?.env?.OPENAI_BASE_URL).toBe('http://localhost:9099/v1');
    expect(options?.env?.OPENAI_API_BASE).toBe('http://localhost:9099/v1');
  });
});
