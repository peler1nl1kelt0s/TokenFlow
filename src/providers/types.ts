export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  name?: string;
  tool_calls?: any[];
}

export interface ProviderRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: any[];
  tool_choice?: any;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderChoice {
  index: number;
  message: Message;
  finish_reason: string | null;
}

export interface ProviderResponse {
  id: string;
  model: string;
  choices: ProviderChoice[];
  usage?: TokenUsage;
}

export interface ProviderCapabilities {
  maxContextTokens: number;
  costPerInputToken: number; // USD per 1M tokens
  costPerOutputToken: number; // USD per 1M tokens
}

export interface IProvider {
  id: string;
  getCapabilities(model: string): ProviderCapabilities;
  execute(
    request: ProviderRequest,
    signal?: AbortSignal
  ): Promise<Response>; // Returns standard fetch Response to stream or consume
}
