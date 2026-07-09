import { TokenFlowDatabase } from './database.js';

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export class TokenFlowCostTracker {
  private cumulativeCost: number = 0;
  private budgetLimit: number;
  private db: TokenFlowDatabase;

  constructor(budgetLimit: number = 0) {
    this.budgetLimit = budgetLimit;
    this.db = new TokenFlowDatabase();
  }

  public async getPricing(model: string): Promise<ModelPricing> {
    return this.db.getPricingForModel(model);
  }

  public async calculateCost(model: string, inputTokens: number, outputTokens: number): Promise<number> {
    const pricing = await this.getPricing(model);
    const inputCost = (inputTokens / 1000000) * pricing.inputPerMillion;
    const outputCost = (outputTokens / 1000000) * pricing.outputPerMillion;
    return inputCost + outputCost;
  }

  public async recordTransaction(model: string, inputTokens: number, outputTokens: number): Promise<number> {
    const cost = await this.calculateCost(model, inputTokens, outputTokens);
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

  public updateBudgetLimit(limit: number) {
    this.budgetLimit = limit;
  }

  public getSummary() {
    return {
      cumulativeCost: this.cumulativeCost,
      budgetLimit: this.budgetLimit,
      isExceeded: this.isBudgetExceeded(),
    };
  }
}
