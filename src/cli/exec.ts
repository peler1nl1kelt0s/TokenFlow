import { spawn } from 'child_process';
import { startProxyServer } from '../proxy/server.js';
import { TokenFlowDatabase } from '../core/database.js';
import picocolors from 'picocolors';
export async function runExecCommand(commandArgs: string[], options: { port: number; tpm: number; rpm: number; budget: number; dryRun?: boolean }) {
  if (commandArgs.length === 0) {
    console.error(picocolors.red('[Error] No command specified for execution wrapper. Usage: tf exec <command> [args...]'));
    process.exit(1);
  }

  const port = options.port;
  const tpm = options.tpm;
  const rpm = options.rpm;
  const budget = options.budget;
  const dryRun = options.dryRun;

  console.log(picocolors.bold(picocolors.green('\n=== TokenFlow Interceptor Wrapper ===')));
  console.log(picocolors.cyan(`[Wrapper] Initializing local scheduler on port ${port}...`));

  // Boot the proxy server in the background (or connect to singleton daemon if running)
  let serverInstance: any = null;
  let getStats: (() => any) | null = null;
  let isDaemonShared = false;

  try {
    const res = await startProxyServer({ port, tpm, rpm, budgetLimit: budget, dryRun });
    serverInstance = res.server;
    getStats = res.getStats;
    isDaemonShared = res.isDaemonShared;
  } catch (err: any) {
    console.error(picocolors.red(`[Error] Failed to initialize proxy server: ${err.message}`));
    process.exit(1);
  }

  const sessionId = `sess_${Math.random().toString(36).substring(7)}`;

  // Override base URL environment variables for SDKs in child process
  const childEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://localhost:${port}?session_id=${sessionId}`,
    ANTHROPIC_API_URL: `http://localhost:${port}?session_id=${sessionId}`,
    OPENAI_BASE_URL: `http://localhost:${port}/v1?session_id=${sessionId}`,
    OPENAI_API_BASE: `http://localhost:${port}/v1?session_id=${sessionId}`,
    DEEPSEEK_BASE_URL: `http://localhost:${port}/v1?session_id=${sessionId}`,
    OPENROUTER_BASE_URL: `http://localhost:${port}/v1?session_id=${sessionId}`,
  };

  console.log(picocolors.cyan(`[Wrapper] Spawning child agent process: ${commandArgs.join(' ')}`));
  if (isDaemonShared) {
    console.log(picocolors.yellow(`[Wrapper] Connected to existing shared TokenFlow daemon instance on port ${port}.`));
  } else {
    console.log(picocolors.green(`[Wrapper] Active TokenFlow server daemon spawned on port ${port}.`));
  }
  if (budget > 0) {
    console.log(picocolors.magenta(`[Wrapper] Active budget limit enforced: $${budget.toFixed(2)}`));
  }

  // Spawn the child command, preserving stdin/stdout streams
  const child = spawn(commandArgs[0], commandArgs.slice(1), {
    env: childEnv,
    stdio: 'inherit', // Connects child terminal I/O directly to the parent
    shell: true,      // Support shell alias and commands path expansion
  });

  // Setup real-time ANSI Status Bar HUD on TTY terminals
  let hudInterval: NodeJS.Timeout | null = null;
  if (process.stderr.isTTY) {
    hudInterval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:${port}/api/status`);
        if (res.ok) {
          const data = await res.json();
          const q = data.limits?.requests ?? 0;
          const mult = data.scaleMultiplier ?? 1.0;
          const cost = data.cost ?? 0.0;
          const budget = data.budget ?? 0.0;
          const budgetStr = budget > 0 ? ` / $${budget.toFixed(2)}` : '';
          
          process.stderr.write(`\u001b[s\u001b[999;1H\u001b[2K\u001b[1;44m[TokenFlow HUD] Queue: ${q} | Multiplier: ${mult.toFixed(2)} | Cost: $${cost.toFixed(4)}${budgetStr}\u001b[0m\u001b[u`);
        }
      } catch {}
    }, 1000);
  }

  // Handle process termination signals gracefully
  const cleanExit = async (code: number) => {
    try {
      if (hudInterval) {
        clearInterval(hudInterval);
      }
      if (process.stderr.isTTY) {
        // Clear bottom line HUD
        process.stderr.write('\u001b[s\u001b[999;1H\u001b[2K\u001b[u');
      }

      let stats: any = null;

      if (isDaemonShared) {
        // Fetch cumulative daemon stats from the active shared endpoint
        try {
          const apiRes = await fetch(`http://localhost:${port}/api/status`);
          if (apiRes.ok) {
            const data = await apiRes.json();
            stats = {
              startTime: Date.now() - (data.uptimeSeconds * 1000),
              totalRequests: data.totalRequests,
              totalActualTokens: data.totalActualTokens,
              totalEstimatedTokens: data.totalEstimatedTokens,
              multiplier: data.scaleMultiplier,
              cost: data.cost,
              developerId: data.developerId,
            };
          }
        } catch {}
      } else if (getStats) {
        stats = getStats();
      }

      if (stats) {
        try {
          const db = new TokenFlowDatabase();
          await db.recordSession({
            id: `session_${Math.random().toString(36).substring(7)}`,
            startTime: stats.startTime,
            endTime: Date.now(),
            totalRequests: stats.totalRequests,
            actualTokens: stats.totalActualTokens,
            estimatedTokens: stats.totalEstimatedTokens,
            savedTokens: Math.max(0, stats.totalEstimatedTokens - stats.totalActualTokens),
            cost: stats.cost || 0.0,
            developerId: stats.developerId || process.env.TOKENFLOW_DEV_ID || 'local_developer',
          });
        } catch {}

        const uptime = Math.round((Date.now() - stats.startTime) / 1000);
        const saved = Math.max(0, stats.totalEstimatedTokens - stats.totalActualTokens);
        
        console.log(picocolors.bold(picocolors.green('\n=========================================')));
        console.log(picocolors.bold(picocolors.green('      TokenFlow Session Telemetry       ')));
        console.log(picocolors.bold(picocolors.green('=========================================')));
        console.log(`Uptime:             ${picocolors.cyan(`${uptime}s`)}`);
        console.log(`Total Requests:     ${picocolors.cyan(stats.totalRequests.toString())}`);
        console.log(`Actual Tokens:      ${picocolors.cyan(stats.totalActualTokens.toLocaleString())}`);
        console.log(`Estimated Tokens:   ${picocolors.cyan(stats.totalEstimatedTokens.toLocaleString())}`);
        console.log(`Tokens Saved:       ${picocolors.bold(picocolors.green(saved.toLocaleString()))}`);
        console.log(`Total Session Cost: ${picocolors.bold(picocolors.magenta(`$${(stats.cost || 0).toFixed(4)}`))}`);
        console.log(`Adaptive Scale Mult: ${picocolors.bold(picocolors.yellow(stats.multiplier.toFixed(2)))}`);
        console.log(picocolors.bold(picocolors.green('=========================================\n')));
      }

      if (serverInstance && !isDaemonShared) {
        serverInstance.close();
        console.log(picocolors.cyan(`[Wrapper] Background proxy shut down. Exiting with code ${code}.`));
      } else {
        console.log(picocolors.cyan(`[Wrapper] Disconnected from shared daemon. Exiting with code ${code}.`));
      }
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
