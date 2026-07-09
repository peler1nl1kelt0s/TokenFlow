import express from 'express';
import { OpenAIProvider } from '../providers/openai.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { TokenFlowScheduler } from '../core/scheduler.js';
import { ProviderRequest } from '../providers/types.js';
import { ContextManager } from '../core/contextManager.js';
import { MultiModelRouter } from './router.js';
import { TokenFlowCostTracker } from '../core/costTracker.js';
import { scanRepository } from '../estimators/repoScanner.js';
import { injectAnthropicCache } from '../core/promptCache.js';
import { OllamaProvider, isOllamaRunning } from '../providers/ollama.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import picocolors from 'picocolors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ProxyServerConfig {
  port: number;
  tpm: number;
  rpm: number;
  budgetLimit?: number;
}

export function startProxyServer(config: ProxyServerConfig) {
  const app = express();
  app.use(express.json());

  // Instantiate global scheduler, routers, and cost tracker
  const scheduler = new TokenFlowScheduler({ tpm: config.tpm, rpm: config.rpm });
  const openAiRouter = new MultiModelRouter('gpt-4o', 'gpt-4o-mini');
  const anthropicRouter = new MultiModelRouter('claude-3-5-sonnet-20240620', 'claude-3-haiku-20240307');
  const costTracker = new TokenFlowCostTracker(config.budgetLimit || 0);

  const sessionStats = {
    startTime: Date.now(),
    totalRequests: 0,
    totalActualTokens: 0,
    totalEstimatedTokens: 0,
  };

  console.log(picocolors.cyan(`[TokenFlow] Initializing scheduler with limits: TPM=${config.tpm}, RPM=${config.rpm}`));

  // Endpoint: OpenAI Format Chat Completions
  app.post('/v1/chat/completions', async (req, res) => {
    // Budget Guard Check with Ollama Fallback
    const isBudgetLimit = costTracker.isBudgetExceeded();
    let useOllamaFallback = false;

    if (isBudgetLimit) {
      if (await isOllamaRunning()) {
        useOllamaFallback = true;
        console.log(picocolors.yellow(`[Budget] Limit reached. Falling back to local offline Ollama execution.`));
      } else {
        console.log(picocolors.red(`[Proxy] Blocked request: Session budget limit of $${costTracker.getBudgetLimit().toFixed(4)} reached.`));
        res.status(402).json({
          error: {
            message: `TokenFlow Session Budget Limit Exceeded ($${costTracker.getBudgetLimit().toFixed(4)}).`,
            type: 'budget_exceeded',
          }
        });
        return;
      }
    }

    const authHeader = req.headers.authorization;
    const apiKey = authHeader ? authHeader.replace('Bearer ', '').trim() : process.env.OPENAI_API_KEY;

    if (!apiKey && !useOllamaFallback) {
      return res.status(401).json({ error: { message: 'OpenAI API key missing in Authorization header or local env.' } });
    }

    const priorityHeader = req.headers['x-tokenflow-priority'];
    const priority = priorityHeader ? parseInt(priorityHeader as string, 10) : 0;

    const requestBody = req.body as ProviderRequest;

    // Apply Context Manager Pressure Check & Deflation
    const maxContextTokens = parseInt(req.headers['x-tokenflow-max-context'] as string, 10) || 8000;
    const contextManager = new ContextManager({ maxContextTokens });
    if (contextManager.shouldCompress(requestBody.messages)) {
      console.log(picocolors.yellow(`[Context] High context pressure detected (${(contextManager.getPressure(requestBody.messages) * 100).toFixed(0)}%). Deflating history...`));
      requestBody.messages = contextManager.deflate(requestBody.messages);
    }

    // Apply Multi-Model Routing Complexity Check
    const complexityHeader = req.headers['x-tokenflow-complexity'] as string;
    const route = openAiRouter.route(requestBody, complexityHeader);
    requestBody.model = route.model;
    console.log(picocolors.cyan(`[Router] Routed request to model: ${route.model}`));

    const provider = new OpenAIProvider(apiKey || '');
    const tokensEstimate = provider.estimateTokens(requestBody);
    const jobId = `job_openai_${Math.random().toString(36).substring(7)}`;

    console.log(picocolors.blue(`[Proxy] Enqueued OpenAI Job ${jobId} (Priority: ${priority}, Estimated Tokens: ${tokensEstimate})`));

    const abortController = new AbortController();
    res.on('close', () => {
      // Abort underlying fetch if client disconnects prematurely
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      let providerResponse;
      if (useOllamaFallback) {
        const ollama = new OllamaProvider();
        providerResponse = await ollama.execute(requestBody, 'openai', abortController.signal);
      } else {
        try {
          providerResponse = await scheduler.submit(jobId, async () => {
            console.log(picocolors.green(`[Scheduler] Dispatching Job ${jobId}`));
            return provider.execute(requestBody, abortController.signal);
          }, { priority, tokensEstimate });
        } catch (err: any) {
          if (await isOllamaRunning()) {
            console.log(picocolors.yellow(`[Network] Connection failed. Falling back to local offline Ollama execution.`));
            const ollama = new OllamaProvider();
            providerResponse = await ollama.execute(requestBody, 'openai', abortController.signal);
          } else {
            throw err;
          }
        }
      }

      // Copy response status and headers
      res.status(providerResponse.status);
      for (const [key, value] of providerResponse.headers.entries()) {
        if (['content-encoding', 'transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
          continue;
        }
        res.setHeader(key, value);
      }

      let responseChars = 0;

      // Stream body back
      if (providerResponse.body) {
        const reader = providerResponse.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
          responseChars += decoder.decode(value).length;
        }
      }
      res.end();

      // Estimate actual tokens
      const inputChars = JSON.stringify(requestBody.messages).length;
      const actualInputTokens = Math.ceil(inputChars / 4);
      const actualOutputTokens = Math.ceil(responseChars / 4);
      const actualTokens = actualInputTokens + actualOutputTokens;

      // Record feedback
      scheduler.recordActualUsage(tokensEstimate, actualTokens);

      // Record USD cost transaction
      costTracker.recordTransaction(requestBody.model || 'default', actualInputTokens, actualOutputTokens);

      // Update session statistics
      sessionStats.totalRequests++;
      sessionStats.totalActualTokens += actualTokens;
      sessionStats.totalEstimatedTokens += tokensEstimate;

      console.log(picocolors.gray(`[Proxy] Completed Job ${jobId}. Actual tokens: ${actualTokens} (Scale Multiplier: ${scheduler.getScaleMultiplier().toFixed(2)})`));
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log(picocolors.yellow(`[Proxy] Job ${jobId} aborted by client connection close.`));
        return;
      }
      console.error(picocolors.red(`[Proxy] Error executing Job ${jobId}: ${error.message}`));
      res.status(500).json({ error: { message: error.message || 'Internal proxy execution failure' } });
    }
  });

  // Endpoint: Anthropic Format Messages
  app.post('/v1/messages', async (req, res) => {
    // Budget Guard Check with Ollama Fallback
    const isBudgetLimit = costTracker.isBudgetExceeded();
    let useOllamaFallback = false;

    if (isBudgetLimit) {
      if (await isOllamaRunning()) {
        useOllamaFallback = true;
        console.log(picocolors.yellow(`[Budget] Limit reached. Falling back to local offline Ollama execution.`));
      } else {
        console.log(picocolors.red(`[Proxy] Blocked request: Session budget limit of $${costTracker.getBudgetLimit().toFixed(4)} reached.`));
        res.status(402).json({
          error: {
            message: `TokenFlow Session Budget Limit Exceeded ($${costTracker.getBudgetLimit().toFixed(4)}).`,
            type: 'budget_exceeded',
          }
        });
        return;
      }
    }

    const clientApiKey = req.headers['x-api-key'] as string;
    const apiKey = clientApiKey ? clientApiKey.trim() : process.env.ANTHROPIC_API_KEY;

    if (!apiKey && !useOllamaFallback) {
      return res.status(401).json({ error: { message: 'Anthropic API key missing in x-api-key header or local env.' } });
    }

    const priorityHeader = req.headers['x-tokenflow-priority'];
    const priority = priorityHeader ? parseInt(priorityHeader as string, 10) : 0;

    const requestBody = req.body as ProviderRequest;

    // Apply Context Manager Pressure Check & Deflation
    const maxContextTokens = parseInt(req.headers['x-tokenflow-max-context'] as string, 10) || 8000;
    const contextManager = new ContextManager({ maxContextTokens });
    if (contextManager.shouldCompress(requestBody.messages)) {
      console.log(picocolors.yellow(`[Context] High context pressure detected (${(contextManager.getPressure(requestBody.messages) * 100).toFixed(0)}%). Deflating history...`));
      requestBody.messages = contextManager.deflate(requestBody.messages);
    }

    // Apply Multi-Model Routing
    const complexityHeader = req.headers['x-tokenflow-complexity'] as string;
    const route = anthropicRouter.route(requestBody, complexityHeader);
    requestBody.model = route.model;
    console.log(picocolors.cyan(`[Router] Routed request to model: ${route.model}`));

    // Apply Anthropic Prompt Caching Enforcer
    injectAnthropicCache(requestBody);

    const provider = new AnthropicProvider(apiKey || '');
    const tokensEstimate = provider.estimateTokens(requestBody);
    const jobId = `job_anthropic_${Math.random().toString(36).substring(7)}`;

    console.log(picocolors.blue(`[Proxy] Enqueued Anthropic Job ${jobId} (Priority: ${priority}, Estimated Tokens: ${tokensEstimate})`));

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      let providerResponse;
      if (useOllamaFallback) {
        const ollama = new OllamaProvider();
        providerResponse = await ollama.execute(requestBody, 'anthropic', abortController.signal);
      } else {
        try {
          providerResponse = await scheduler.submit(jobId, async () => {
            console.log(picocolors.green(`[Scheduler] Dispatching Job ${jobId}`));
            return provider.execute(requestBody, abortController.signal);
          }, { priority, tokensEstimate });
        } catch (err: any) {
          if (await isOllamaRunning()) {
            console.log(picocolors.yellow(`[Network] Connection failed. Falling back to local offline Ollama execution.`));
            const ollama = new OllamaProvider();
            providerResponse = await ollama.execute(requestBody, 'anthropic', abortController.signal);
          } else {
            throw err;
          }
        }
      }

      res.status(providerResponse.status);
      for (const [key, value] of providerResponse.headers.entries()) {
        if (['content-encoding', 'transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
          continue;
        }
        res.setHeader(key, value);
      }

      let responseChars = 0;

      if (providerResponse.body) {
        const reader = providerResponse.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
          responseChars += decoder.decode(value).length;
        }
      }
      res.end();

      // Estimate actual tokens
      const inputChars = JSON.stringify(requestBody.messages).length;
      const actualInputTokens = Math.ceil(inputChars / 4);
      const actualOutputTokens = Math.ceil(responseChars / 4);
      const actualTokens = actualInputTokens + actualOutputTokens;

      // Record feedback
      scheduler.recordActualUsage(tokensEstimate, actualTokens);

      // Record USD cost transaction
      costTracker.recordTransaction(requestBody.model || 'default', actualInputTokens, actualOutputTokens);

      // Update session statistics
      sessionStats.totalRequests++;
      sessionStats.totalActualTokens += actualTokens;
      sessionStats.totalEstimatedTokens += tokensEstimate;

      console.log(picocolors.gray(`[Proxy] Completed Job ${jobId}. Actual tokens: ${actualTokens} (Scale Multiplier: ${scheduler.getScaleMultiplier().toFixed(2)})`));
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log(picocolors.yellow(`[Proxy] Job ${jobId} aborted by client connection close.`));
        return;
      }
      console.error(picocolors.red(`[Proxy] Error executing Job ${jobId}: ${error.message}`));
      res.status(500).json({ error: { message: error.message || 'Internal proxy execution failure' } });
    }
  });

  // API status endpoint
  app.get('/api/status', (req, res) => {
    res.json({
      uptimeSeconds: Math.round((Date.now() - sessionStats.startTime) / 1000),
      totalRequests: sessionStats.totalRequests,
      totalActualTokens: sessionStats.totalActualTokens,
      totalEstimatedTokens: sessionStats.totalEstimatedTokens,
      tokensSaved: Math.max(0, sessionStats.totalEstimatedTokens - sessionStats.totalActualTokens),
      scaleMultiplier: scheduler.getScaleMultiplier(),
      limits: scheduler.getUsage(),
      cost: costTracker.getCumulativeCost(),
      budget: costTracker.getBudgetLimit(),
      isBudgetExceeded: costTracker.isBudgetExceeded(),
    });
  });

  // Serve static HTML Web Dashboard
  app.get('/dashboard', async (req, res) => {
    try {
      let htmlPath = path.join(__dirname, 'dashboard.html');
      try {
        await fs.access(htmlPath);
      } catch {
        // Fallback for compiled running path vs development path
        htmlPath = path.join(__dirname, '..', '..', 'src', 'proxy', 'dashboard.html');
      }
      const html = await fs.readFile(htmlPath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (err: any) {
      res.status(500).send(`Error loading dashboard: ${err.message}`);
    }
  });

  // MCP Tools Listing Endpoint
  app.get('/mcp/v1/tools', (req, res) => {
    res.json({
      tools: [
        {
          name: 'get_tokenflow_stats',
          description: 'Get real-time token scheduling rates, queue usage, budget constraints, and PID multiplier scales from the local TokenFlow daemon.',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'scan_repository_complexity',
          description: 'Recursively scans a directory\'s LOC, file counts, imports, and complexity metrics using a fast local parser.',
          inputSchema: {
            type: 'object',
            properties: {
              directory: { type: 'string', description: 'Local directory path to scan, defaults to "./"' }
            }
          }
        }
      ]
    });
  });

  // MCP Tool Calling Execution Endpoint
  app.post('/mcp/v1/call', async (req, res) => {
    const { name, arguments: args } = req.body;
    try {
      if (name === 'get_tokenflow_stats') {
        res.json({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                uptimeSeconds: Math.round((Date.now() - sessionStats.startTime) / 1000),
                totalRequests: sessionStats.totalRequests,
                totalActualTokens: sessionStats.totalActualTokens,
                cost: costTracker.getCumulativeCost(),
                budget: costTracker.getBudgetLimit(),
                scaleMultiplier: scheduler.getScaleMultiplier(),
                queueLength: scheduler.getUsage().requests
              }, null, 2)
            }
          ]
        });
      } else if (name === 'scan_repository_complexity') {
        const dir = args?.directory || './';
        const summary = await scanRepository(dir);
        res.json({
          content: [
            {
              type: 'text',
              text: JSON.stringify(summary, null, 2)
            }
          ]
        });
      } else {
        res.status(404).json({ error: `Tool ${name} not found` });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return new Promise<{ server: any; getStats: (() => any) | null; isDaemonShared: boolean }>((resolve, reject) => {
    const server = app.listen(config.port, () => {
      console.log(picocolors.green(`\n🚀 TokenFlow Proxy Server running on http://localhost:${config.port}\n`));
      resolve({
        server,
        isDaemonShared: false,
        getStats: () => ({
          startTime: sessionStats.startTime,
          totalRequests: sessionStats.totalRequests,
          totalActualTokens: sessionStats.totalActualTokens,
          totalEstimatedTokens: sessionStats.totalEstimatedTokens,
          multiplier: scheduler.getScaleMultiplier(),
          cost: costTracker.getCumulativeCost(),
        }),
      });
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log(picocolors.yellow(`[TokenFlow] Port ${config.port} is already in use. Reusing existing TokenFlow daemon instance on this port.`));
        resolve({
          server: null,
          isDaemonShared: true,
          getStats: null,
        });
      } else {
        reject(err);
      }
    });
  });
}
