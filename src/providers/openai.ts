import { IProvider, ProviderRequest, ProviderCapabilities } from './types.js';

export class OpenAIProvider implements IProvider {
  public id = 'openai';
  private apiKey: string;
  private apiBase: string;

  constructor(apiKey: string, apiBase = 'https://api.openai.com/v1') {
    this.apiKey = apiKey;
    this.apiBase = apiBase;
  }

  public getCapabilities(model: string): ProviderCapabilities {
    // Standard catalog capabilities
    return {
      maxContextTokens: 128000,
      costPerInputToken: 5.0, // $5 per 1M tokens (e.g. GPT-4o input approximation)
      costPerOutputToken: 15.0, // $15 per 1M tokens
    };
  }

  /**
   * Simple character-based token estimator for v0.1
   */
  public estimateTokens(request: ProviderRequest): number {
    let charCount = 0;
    for (const msg of request.messages) {
      if (typeof msg.content === 'string') {
        charCount += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        charCount += JSON.stringify(msg.content).length;
      }
    }
    
    // Proactive budget reservation: input tokens + expected/max output tokens
    const inputEstimate = Math.ceil(charCount / 4);
    const outputEstimate = request.max_tokens ?? 2048;
    return inputEstimate + outputEstimate;
  }

  public async execute(
    request: ProviderRequest,
    signal?: AbortSignal
  ): Promise<Response> {
    const url = `${this.apiBase}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal,
    });
  }
}
