import { describe, it, expect } from 'vitest';
import { TokenFlowCostTracker } from './costTracker.js';

describe('TokenFlowCostTracker', () => {
  it('should resolve correct pricing for registered models', () => {
    const tracker = new TokenFlowCostTracker();
    
    const claudePricing = tracker.getPricing('claude-3-5-sonnet-20240620');
    expect(claudePricing.inputPerMillion).toBe(3.0);
    expect(claudePricing.outputPerMillion).toBe(15.0);

    const gptPricing = tracker.getPricing('gpt-4o-mini');
    expect(gptPricing.inputPerMillion).toBe(0.15);
    expect(gptPricing.outputPerMillion).toBe(0.6);
  });

  it('should calculate cost accurately based on inputs and outputs', () => {
    const tracker = new TokenFlowCostTracker();
    
    // GPT-4o input: 1,000,000 tokens ($5.00), output: 1,000,000 tokens ($15.00)
    // 100k input ($0.50) + 10k output ($0.15) = $0.65
    const cost = tracker.calculateCost('gpt-4o', 100000, 10000);
    expect(cost).toBeCloseTo(0.65, 4);
  });

  it('should record transactions and check budget limits correctly', () => {
    const tracker = new TokenFlowCostTracker(1.0); // $1.00 budget limit
    
    expect(tracker.isBudgetExceeded()).toBe(false);

    // Record a transaction of $0.65
    tracker.recordTransaction('gpt-4o', 100000, 10000);
    expect(tracker.getCumulativeCost()).toBeCloseTo(0.65, 4);
    expect(tracker.isBudgetExceeded()).toBe(false);

    // Record another transaction of $0.65 (Total: $1.30, exceeding budget)
    tracker.recordTransaction('gpt-4o', 100000, 10000);
    expect(tracker.getCumulativeCost()).toBeCloseTo(1.30, 4);
    expect(tracker.isBudgetExceeded()).toBe(true);
  });
});
