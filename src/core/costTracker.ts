export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING_DATABASE: Record<string, ModelPricing> = {
  // Anthropic Models
  'claude-3-5-sonnet-20240620': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-haiku-20240307': { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  // OpenAI Models
  'gpt-4o': { inputPerMillion: 5.0, outputPerMillion: 15.0 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  // Default Fallback
  'default': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
};

export class TokenFlowCostTracker {
  private cumulativeCost: number = 0;
  private budgetLimit: number;

  constructor(budgetLimit: number = 0) {
    this.budgetLimit = budgetLimit;
  }

  public getPricing(model: string): ModelPricing {
    // Sort keys by length descending to match more specific keys (e.g. gpt-4o-mini) before shorter keys (e.g. gpt-4o)
    const sortedKeys = Object.keys(PRICING_DATABASE).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (model.includes(key)) {
        return PRICING_DATABASE[key];
      }
    }
    return PRICING_DATABASE['default'];
  }

  public calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = this.getPricing(model);
    const inputCost = (inputTokens / 1000000) * pricing.inputPerMillion;
    const outputCost = (outputTokens / 1000000) * pricing.outputPerMillion;
    return inputCost + outputCost;
  }

  public recordTransaction(model: string, inputTokens: number, outputTokens: number): number {
    const cost = this.calculateCost(model, inputTokens, outputTokens);
    this.cumulativeCost += cost;
    return cost;
  }

  public isBudgetExceeded(): boolean {
    if (this.budgetLimit <= 0) {
      return false;
    }
    return this.cumulativeCost >= this.budgetLimit;
  }

  public getCumulativeCost(): number {
    return this.cumulativeCost;
  }

  public getBudgetLimit(): number {
    return this.budgetLimit;
  }

  public getSummary() {
    return {
      cumulativeCost: this.cumulativeCost,
      budgetLimit: this.budgetLimit,
      isExceeded: this.isBudgetExceeded(),
    };
  }
}
