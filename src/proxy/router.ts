import { ProviderRequest } from '../providers/types.js';
import { TokenFlowDatabase } from '../core/database.js';
import { classifyPromptComplexity } from '../core/classifier.js';

export interface RouteTarget {
  model: string;
  provider: 'openai' | 'anthropic';
}

export class MultiModelRouter {
  private defaultPremium: string;
  private defaultCheap: string;
  private db: TokenFlowDatabase;

  constructor(defaultPremium: string = 'claude-sonnet-5', defaultCheap: string = 'gpt-5.6-luna') {
    this.defaultPremium = defaultPremium;
    this.defaultCheap = defaultCheap;
    this.db = new TokenFlowDatabase();
  }

  /**
   * Determine the routing target model and provider based on request complexity,
   * active API keys presence (provider isolation), and persistent DB mappings.
   */
  public async route(
    request: ProviderRequest,
    complexityHeader?: string,
    activeKeys: { hasOpenAi: boolean; hasAnthropic: boolean } = { hasOpenAi: true, hasAnthropic: true }
  ): Promise<RouteTarget> {
    let isLowComplexity = false;

    // 1. Analyze request complexity (Heuristics or Header overrides)
    if (complexityHeader) {
      isLowComplexity = complexityHeader.toLowerCase() === 'low';
    } else {
      isLowComplexity = classifyPromptComplexity(request.messages) === 'standard';
    }

    const config = await this.db.getConfig();

    // 2. Resolve target mapping based on provider isolation
    let selectedModel = isLowComplexity ? this.defaultCheap : this.defaultPremium;

    // If client only has Anthropic API keys, force routing within Anthropic family (Sonnet / Haiku)
    if (activeKeys.hasAnthropic && !activeKeys.hasOpenAi) {
      selectedModel = isLowComplexity ? 'claude-haiku-4-5' : 'claude-sonnet-5';
    }
    // If client only has OpenAI API keys, force routing within OpenAI family (GPT-5.6-luna / GPT-5.6-sol)
    else if (activeKeys.hasOpenAi && !activeKeys.hasAnthropic) {
      selectedModel = isLowComplexity ? 'gpt-5.6-luna' : 'gpt-5.6-sol';
    }

    // Resolve mapped model names from custom DB configuration overrides if available
    const mapped = config.models[selectedModel];
    const finalModelName = isLowComplexity 
      ? (mapped?.standard || selectedModel)
      : (mapped?.premium || selectedModel);

    const provider: 'openai' | 'anthropic' = 
      finalModelName.includes('claude') ? 'anthropic' : 'openai';

    return {
      model: finalModelName,
      provider,
    };
  }
}
