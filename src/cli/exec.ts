import { spawn } from 'child_process';
import { startProxyServer } from '../proxy/server.js';
import picocolors from 'picocolors';

export function runExecCommand(commandArgs: string[], options: { port: number; tpm: number; rpm: number }) {
  if (commandArgs.length === 0) {
    console.error(picocolors.red('[Error] No command specified for execution wrapper. Usage: tf exec <command> [args...]'));
    process.exit(1);
  }

  const port = options.port;
  const tpm = options.tpm;
  const rpm = options.rpm;

  console.log(picocolors.bold(picocolors.green('\n=== TokenFlow Interceptor Wrapper ===')));
  console.log(picocolors.cyan(`[Wrapper] Starting local scheduler proxy on port ${port}...`));

  // Boot the proxy server in the background
  let server: any;
  try {
    server = startProxyServer({ port, tpm, rpm });
  } catch (err: any) {
    console.error(picocolors.red(`[Error] Failed to start background proxy: ${err.message}`));
    process.exit(1);
  }

  // Override base URL environment variables for SDKs in child process
  const childEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://localhost:${port}`,
    ANTHROPIC_API_URL: `http://localhost:${port}`,
    OPENAI_BASE_URL: `http://localhost:${port}/v1`,
    OPENAI_API_BASE: `http://localhost:${port}/v1`,
    // For other agents that might use deepseek, openrouter etc.
    DEEPSEEK_BASE_URL: `http://localhost:${port}/v1`,
    OPENROUTER_BASE_URL: `http://localhost:${port}/v1`,
  };

  console.log(picocolors.cyan(`[Wrapper] Spawning child agent process: ${commandArgs.join(' ')}`));
  console.log(picocolors.gray(`[Wrapper] Injected URL overrides redirecting LLM traffic to TokenFlow queue.\n`));

  // Spawn the child command, preserving stdin/stdout streams
  const child = spawn(commandArgs[0], commandArgs.slice(1), {
    env: childEnv,
    stdio: 'inherit', // Connects child terminal I/O directly to the parent
    shell: true,      // Support shell alias and commands path expansion
  });

  // Handle process termination signals gracefully
  const cleanExit = (code: number) => {
    try {
      server.close();
      console.log(picocolors.cyan(`\n[Wrapper] Background proxy shut down. Exiting with code ${code}.`));
    } catch {}
    process.exit(code);
  };

  child.on('close', (code) => {
    cleanExit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error(picocolors.red(`[Wrapper] Child process error: ${err.message}`));
    cleanExit(1);
  });

  // Forward parent signals to child
  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });
}
