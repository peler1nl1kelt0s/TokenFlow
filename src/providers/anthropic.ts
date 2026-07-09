import { IProvider, ProviderRequest, ProviderCapabilities } from './types.js';

export class AnthropicProvider implements IProvider {
  public id = 'anthropic';
  private apiKey: string;
  private apiBase: string;

  constructor(apiKey: string, apiBase = 'https://api.anthropic.com') {
    this.apiKey = apiKey;
    this.apiBase = apiBase;
  }

  public getCapabilities(model: string): ProviderCapabilities {
    return {
      maxContextTokens: 200000,
      costPerInputToken: 3.0, // Claude 3.5 Sonnet approximations
      costPerOutputToken: 15.0,
    };
  }

  public estimateTokens(request: ProviderRequest): number {
    let charCount = 0;
    for (const msg of request.messages) {
      if (typeof msg.content === 'string') {
        charCount += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        charCount += JSON.stringify(msg.content).length;
      }
    }
    const inputEstimate = Math.ceil(charCount / 4);
    const outputEstimate = request.max_tokens ?? 2048;
    return inputEstimate + outputEstimate;
  }

  public async execute(
    request: ProviderRequest,
    signal?: AbortSignal
  ): Promise<Response> {
    const url = `${this.apiBase}/v1/messages`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };

    // Anthropic API uses 'max_tokens' as required.
    // Ensure we supply it if the request payload uses it or has a default.
    const bodyPayload = {
      model: request.model,
      messages: request.messages.filter(m => m.role !== 'system'),
      system: request.messages.find(m => m.role === 'system')?.content,
      max_tokens: request.max_tokens ?? 4096,
      stream: request.stream,
      temperature: request.temperature,
      tools: request.tools,
    };

    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
      signal,
    });
  }
}
