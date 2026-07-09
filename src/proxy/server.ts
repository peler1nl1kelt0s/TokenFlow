import express from 'express';
import { OpenAIProvider } from '../providers/openai.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { TokenFlowScheduler } from '../core/scheduler.js';
import { ProviderRequest } from '../providers/types.js';
import { ContextManager } from '../core/contextManager.js';
import { MultiModelRouter } from './router.js';
import { TokenFlowCostTracker } from '../core/costTracker.js';
import { TokenFlowDatabase } from '../core/database.js';
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
  dryRun?: boolean;
}

export function startProxyServer(config: ProxyServerConfig) {
  const app = express();
  app.use(express.json());

  const dryRun = !!config.dryRun;

  // Instantiate global scheduler, routers, and cost tracker
  const scheduler = new TokenFlowScheduler({ tpm: config.tpm, rpm: config.rpm });
  const openAiRouter = new MultiModelRouter('gpt-5.6-sol', 'gpt-5.6-luna');
  const anthropicRouter = new MultiModelRouter('claude-sonnet-5', 'claude-haiku-4-5');
  const costTracker = new TokenFlowCostTracker(config.budgetLimit || 0);

  const sessionStats = {
    startTime: Date.now(),
    totalRequests: 0,
    totalActualTokens: 0,
    totalEstimatedTokens: 0,
    developerId: 'local_developer',
  };

  console.log(picocolors.cyan(`[TokenFlow] Initializing scheduler with limits: TPM=${config.tpm}, RPM=${config.rpm}`));

  // Endpoint: OpenAI Format Chat Completions
  app.post('/v1/chat/completions', async (req, res) => {
    const sessionId = (req.query.session_id as string) || 'default_session';

    const db = new TokenFlowDatabase();
    const dbConfig = await db.getConfig();
    const devAuth = resolveDeveloperId(req, dbConfig);
    if (!devAuth.authorized) {
      console.log(picocolors.red(`[Auth] Blocked request: Unauthorized developer gateway key.`));
      return res.status(401).json({ error: { message: 'TokenFlow API Gateway: Unauthorized developer key.' } });
    }
    sessionStats.developerId = devAuth.developerId;

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
      requestBody.messages = await contextManager.deflate(requestBody.messages);
    }

    // Apply Multi-Model Routing Complexity Check
    const complexityHeader = req.headers['x-tokenflow-complexity'] as string;
    const route = await openAiRouter.route(requestBody, complexityHeader, {
      hasOpenAi: !!apiKey,
      hasAnthropic: !!process.env.ANTHROPIC_API_KEY
    });
    requestBody.model = route.model;
    console.log(picocolors.cyan(`[Router] Routed request to model: ${route.model}`));

    if (dryRun) {
      await handleOpenAiDryRun(req, res, requestBody, scheduler, costTracker, sessionStats);
      return;
    }

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
          }, { priority, tokensEstimate, sessionId });
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
      await costTracker.recordTransaction(requestBody.model || 'default', actualInputTokens, actualOutputTokens);

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
    const sessionId = (req.query.session_id as string) || 'default_session';

    const db = new TokenFlowDatabase();
    const dbConfig = await db.getConfig();
    const devAuth = resolveDeveloperId(req, dbConfig);
    if (!devAuth.authorized) {
      console.log(picocolors.red(`[Auth] Blocked request: Unauthorized developer gateway key.`));
      return res.status(401).json({ error: { message: 'TokenFlow API Gateway: Unauthorized developer key.' } });
    }
    sessionStats.developerId = devAuth.developerId;

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
      requestBody.messages = await contextManager.deflate(requestBody.messages);
    }

    // Apply Multi-Model Routing
    const complexityHeader = req.headers['x-tokenflow-complexity'] as string;
    const route = await anthropicRouter.route(requestBody, complexityHeader, {
      hasOpenAi: !!process.env.OPENAI_API_KEY,
      hasAnthropic: !!apiKey
    });
    requestBody.model = route.model;
    console.log(picocolors.cyan(`[Router] Routed request to model: ${route.model}`));

    if (dryRun) {
      await handleAnthropicDryRun(req, res, requestBody, scheduler, costTracker, sessionStats);
      return;
    }

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
          }, { priority, tokensEstimate, sessionId });
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
      await costTracker.recordTransaction(requestBody.model || 'default', actualInputTokens, actualOutputTokens);

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
      isPaused: scheduler.getIsPaused(),
      developerId: sessionStats.developerId,
    });
  });

  // GET Billing Endpoint
  app.get('/api/billing', async (req, res) => {
    try {
      const db = new TokenFlowDatabase();
      const billing = await db.getDeveloperCosts();
      res.json(billing);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET Config Endpoint
  app.get('/api/config', async (req, res) => {
    try {
      const db = new TokenFlowDatabase();
      const config = await db.getConfig();
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST Config Endpoint
  app.post('/api/config', async (req, res) => {
    try {
      const db = new TokenFlowDatabase();
      const newConfig = req.body;
      await db.saveConfig(newConfig);
      
      // Update scheduler limits dynamically
      if (newConfig.tpm && newConfig.rpm) {
        scheduler.updateLimits({ tpm: parseInt(newConfig.tpm, 10), rpm: parseInt(newConfig.rpm, 10) });
      }

      // Update costTracker budget limit
      if (typeof newConfig.budgetLimit === 'number') {
        costTracker.updateBudgetLimit(newConfig.budgetLimit);
      }
      
      res.json({ success: true, config: newConfig });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST Control Queue Endpoint
  app.post('/api/control', (req, res) => {
    const { action } = req.body;
    if (action === 'pause') {
      scheduler.pause();
      console.log(picocolors.yellow('[Scheduler] Queue paused dynamically via Control Panel API.'));
      return res.json({ success: true, paused: true });
    } else if (action === 'resume') {
      scheduler.resume();
      console.log(picocolors.green('[Scheduler] Queue resumed dynamically via Control Panel API.'));
      return res.json({ success: true, paused: false });
    }
    res.status(400).json({ error: 'Invalid control action' });
  });

  // GET History Logs Endpoint
  app.get('/api/history', async (req, res) => {
    try {
      const db = new TokenFlowDatabase();
      const history = await db.getHistory();
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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
          developerId: sessionStats.developerId,
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

async function handleOpenAiDryRun(
  req: express.Request,
  res: express.Response,
  requestBody: any,
  scheduler: any,
  costTracker: any,
  sessionStats: any
) {
  const model = requestBody.model || 'gpt-5.6-sol';
  const isStream = !!requestBody.stream;
  const mockText = "This is a simulated response in TokenFlow Dry-Run mode. Real LLM model weights were not queried, saving you API costs.";
  
  const promptChars = JSON.stringify(requestBody.messages).length;
  const inputTokens = Math.ceil(promptChars / 4);
  const outputTokens = Math.ceil(mockText.length / 4);
  const totalTokens = inputTokens + outputTokens;

  scheduler.recordActualUsage(inputTokens * 2, totalTokens);
  await costTracker.recordTransaction(model, inputTokens, outputTokens);
  
  sessionStats.totalRequests++;
  sessionStats.totalActualTokens += totalTokens;
  sessionStats.totalEstimatedTokens += inputTokens * 2;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const words = mockText.split(' ');
    const id = `chatcmpl-mock-${Math.random().toString(36).substring(7)}`;
    
    res.write(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created: Math.round(Date.now() / 1000), model,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
    })}\n\n`);

    for (const word of words) {
      await new Promise(resolve => setTimeout(resolve, 15));
      res.write(`data: ${JSON.stringify({
        id, object: 'chat.completion.chunk', created: Math.round(Date.now() / 1000), model,
        choices: [{ index: 0, delta: { content: word + ' ' }, finish_reason: null }]
      })}\n\n`);
    }
    
    res.write(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created: Math.round(Date.now() / 1000), model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    res.json({
      id: `chatcmpl-mock-${Math.random().toString(36).substring(7)}`,
      object: 'chat.completion',
      created: Math.round(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: mockText },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: totalTokens
      }
    });
  }
}

async function handleAnthropicDryRun(
  req: express.Request,
  res: express.Response,
  requestBody: any,
  scheduler: any,
  costTracker: any,
  sessionStats: any
) {
  const model = requestBody.model || 'claude-sonnet-5';
  const isStream = !!requestBody.stream;
  const mockText = "This is a simulated response in TokenFlow Dry-Run mode. Real LLM model weights were not queried, saving you API costs.";
  
  const promptChars = JSON.stringify(requestBody.messages).length;
  const inputTokens = Math.ceil(promptChars / 4);
  const outputTokens = Math.ceil(mockText.length / 4);
  const totalTokens = inputTokens + outputTokens;

  scheduler.recordActualUsage(inputTokens * 2, totalTokens);
  await costTracker.recordTransaction(model, inputTokens, outputTokens);
  
  sessionStats.totalRequests++;
  sessionStats.totalActualTokens += totalTokens;
  sessionStats.totalEstimatedTokens += inputTokens * 2;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const id = `msg_mock_${Math.random().toString(36).substring(7)}`;

    res.write(`event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0 } }
    })}\n\n`);

    res.write(`event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' }
    })}\n\n`);

    const words = mockText.split(' ');
    for (const word of words) {
      await new Promise(resolve => setTimeout(resolve, 15));
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word + ' ' }
      })}\n\n`);
    }

    res.write(`event: content_block_stop\ndata: ${JSON.stringify({
      type: 'content_block_stop', index: 0
    })}\n\n`);

    res.write(`event: message_delta\ndata: ${JSON.stringify({
      type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: outputTokens }
    })}\n\n`);

    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    res.end();
  } else {
    res.json({
      id: `msg_mock_${Math.random().toString(36).substring(7)}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: mockText }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens
      }
    });
  }
}

function resolveDeveloperId(req: express.Request, config: any): { developerId: string; authorized: boolean } {
  const keys = config.authorizedDeveloperKeys;
  
  if (!keys || Object.keys(keys).length === 0) {
    const devId = (req.headers['x-tokenflow-developer-id'] as string) || process.env.TOKENFLOW_DEV_ID || 'local_developer';
    return { developerId: devId, authorized: true };
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();
    if (token.startsWith('tf-dev-')) {
      const devId = keys[token];
      if (devId) {
        return { developerId: devId, authorized: true };
      }
      return { developerId: 'unauthorized', authorized: false };
    }
  }

  const clientKey = (req.headers['x-api-key'] as string) || '';
  if (clientKey.startsWith('tf-dev-')) {
    const devId = keys[clientKey];
    if (devId) {
      return { developerId: devId, authorized: true };
    }
    return { developerId: 'unauthorized', authorized: false };
  }

  const localDevKey = process.env.TOKENFLOW_DEV_KEY;
  if (localDevKey && keys[localDevKey]) {
    return { developerId: keys[localDevKey], authorized: true };
  }

  return { developerId: 'unauthorized', authorized: false };
}

