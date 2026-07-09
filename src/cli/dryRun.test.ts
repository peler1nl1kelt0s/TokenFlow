import { describe, it, expect } from 'vitest';
import { startProxyServer } from '../proxy/server.js';
import { TokenFlowDatabase } from '../core/database.js';

describe('TokenFlow Dry-Run Simulation Mode', () => {
  it('should boot in dry-run mode and generate simulated completions', async () => {
    // Start proxy server on test port 9091 in dry-run mode
    const serverConfig = {
      port: 9091,
      tpm: 10000,
      rpm: 5,
      budgetLimit: 2.0,
      dryRun: true
    };

    const bootRes = await startProxyServer(serverConfig);
    const serverInstance = bootRes.server;

    try {
      // Simulate client calling OpenAI Chat Completion in dry-run
      const openAiRes = await fetch('http://localhost:9091/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer tf-dev-token-peler1n' // test gateway token mapping to peler1n
        },
        body: JSON.stringify({
          model: 'gpt-5.6-sol',
          messages: [{ role: 'user', content: 'Say hello' }],
          stream: false
        })
      });

      expect(openAiRes.ok).toBe(true);
      const openAiData: any = await openAiRes.json();
      expect(openAiData.model).toContain('gpt-5.6-');
      expect(openAiData.choices[0].message.content).toContain('Dry-Run');
      expect(openAiData.usage.total_tokens).toBeGreaterThan(0);

      // Verify that the statistics report matches
      const statsRes = await fetch('http://localhost:9091/api/status');
      expect(statsRes.ok).toBe(true);
      const statsData: any = await statsRes.json();
      expect(statsData.totalRequests).toBe(1);
      expect(statsData.developerId).toBe('peler1n');
      expect(statsData.cost).toBeGreaterThan(0);

    } finally {
      if (serverInstance) {
        serverInstance.close();
      }
    }
  });

  it('should fail authentication if invalid token is passed when keys are configured', async () => {
    const serverConfig = {
      port: 9092,
      tpm: 10000,
      rpm: 5,
      budgetLimit: 2.0,
      dryRun: true
    };

    const bootRes = await startProxyServer(serverConfig);
    const serverInstance = bootRes.server;

    try {
      const badAuthRes = await fetch('http://localhost:9092/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer tf-dev-token-BAD'
        },
        body: JSON.stringify({
          model: 'gpt-5.6-sol',
          messages: [{ role: 'user', content: 'Say hello' }]
        })
      });

      expect(badAuthRes.status).toBe(401);
      const errData: any = await badAuthRes.json();
      expect(errData.error.message).toContain('Unauthorized');
    } finally {
      if (serverInstance) {
        serverInstance.close();
      }
    }
  });
});
