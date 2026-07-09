export interface LimiterLimits {
  tpm: number; // Tokens Per Minute
  rpm: number; // Requests Per Minute
}

interface Transaction {
  timestamp: number;
  tokens: number;
}

export class TokenRateLimiter {
  private transactions: Transaction[] = [];
  private tpmLimit: number;
  private rpmLimit: number;

  constructor(limits: LimiterLimits) {
    this.tpmLimit = limits.tpm;
    this.rpmLimit = limits.rpm;
  }

  /**
   * Remove transactions older than the window (60 seconds)
   */
  private clean(now: number = Date.now()) {
    const cutoff = now - 60000;
    this.transactions = this.transactions.filter(t => t.timestamp > cutoff);
  }

  /**
   * Get current usage totals in the last 60 seconds
   */
  public getUsage(now: number = Date.now()): { tokens: number; requests: number } {
    this.clean(now);
    let totalTokens = 0;
    for (const t of this.transactions) {
      totalTokens += t.tokens;
    }
    return {
      tokens: totalTokens,
      requests: this.transactions.length,
    };
  }

  /**
   * Check if request can be accepted within rate limits
   */
  public canAccept(tokens: number, now: number = Date.now()): boolean {
    const usage = this.getUsage(now);
    const wouldExceedTPM = usage.tokens + tokens > this.tpmLimit;
    const wouldExceedRPM = usage.requests + 1 > this.rpmLimit;
    return !wouldExceedTPM && !wouldExceedRPM;
  }

  /**
   * Record a request usage
   */
  public record(tokens: number, now: number = Date.now()) {
    this.clean(now);
    this.transactions.push({ timestamp: now, tokens });
  }

  /**
   * Returns estimated milliseconds to wait until the requested tokens/request slot becomes available.
   * If available immediately, returns 0.
   */
  public timeUntilAvailable(tokens: number, now: number = Date.now()): number {
    if (this.canAccept(tokens, now)) {
      return 0;
    }

    this.clean(now);
    const sorted = [...this.transactions].sort((a, b) => a.timestamp - b.timestamp);
    const windowStart = now - 60000;

    let tempUsage = this.getUsage(now);
    let delayMs = 0;

    // Simulate sliding the window forward until limits are satisfied
    for (const tx of sorted) {
      if (tempUsage.tokens + tokens <= this.tpmLimit && tempUsage.requests + 1 <= this.rpmLimit) {
        break;
      }
      
      // Slide window to right after this transaction
      const releaseTime = tx.timestamp + 60000;
      delayMs = Math.max(delayMs, releaseTime - now);
      
      // Subtract this transaction
      tempUsage.tokens -= tx.tokens;
      tempUsage.requests -= 1;
    }

    return delayMs;
  }

  public updateLimits(limits: LimiterLimits) {
    this.tpmLimit = limits.tpm;
    this.rpmLimit = limits.rpm;
  }
}
