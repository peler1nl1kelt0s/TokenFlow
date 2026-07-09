import { ProviderRequest } from '../providers/types.js';

export interface RouteTarget {
  model: string;
  provider: 'openai' | 'anthropic';
}

export class MultiModelRouter {
  private premiumModel = 'claude-3-5-sonnet-20240620';
  private cheapModel = 'gpt-4o-mini';

  constructor(premiumModel?: string, cheapModel?: string) {
    if (premiumModel) this.premiumModel = premiumModel;
    if (cheapModel) this.cheapModel = cheapModel;
  }

  /**
   * Determine the routing target model and provider based on request contents and complexity metadata.
   */
  public route(request: ProviderRequest, complexityHeader?: string): RouteTarget {
    let isLowComplexity = false;

    if (complexityHeader) {
      isLowComplexity = complexityHeader.toLowerCase() === 'low';
    } else {
      // Heuristic: If prompt content is very short or is a basic hello, classify as low complexity.
      const lastMessage = request.messages[request.messages.length - 1];
      const contentText = typeof lastMessage?.content === 'string' 
        ? lastMessage.content 
        : JSON.stringify(lastMessage?.content || '');

      const isShort = contentText.length < 150;
      const isSimpleGreeting = /^(hello|hi|hey|thanks|thank you|ok|yes|no)\b/i.test(contentText.trim());

      isLowComplexity = isShort || isSimpleGreeting;
    }

    if (isLowComplexity) {
      return {
        model: this.cheapModel,
        provider: 'openai', // Route to cheaper mini model
      };
    }

    // Default premium route
    return {
      model: this.premiumModel,
      provider: this.premiumModel.startsWith('claude') ? 'anthropic' : 'openai',
    };
  }
}
