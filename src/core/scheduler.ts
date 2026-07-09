import { TokenRateLimiter, LimiterLimits } from './limiter.js';
import { AdaptiveController } from './adaptive.js';

export interface ScheduledJob<T = any> {
  id: string;
  priority: number;
  tokensEstimate: number;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: any) => void;
  submittedAt: number;
}

export class TokenFlowScheduler {
  private queue: ScheduledJob[] = [];
  private limiter: TokenRateLimiter;
  private adaptive: AdaptiveController;
  private isProcessing = false;
  private isPaused = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(limits: LimiterLimits) {
    this.limiter = new TokenRateLimiter(limits);
    this.adaptive = new AdaptiveController();
  }

  public pause() {
    this.isPaused = true;
  }

  public resume() {
    this.isPaused = false;
    this.scheduleLoop();
  }

  public recordActualUsage(nominalEstimate: number, actualTokens: number) {
    this.adaptive.recordTransaction(nominalEstimate, actualTokens);
  }

  public getScaleMultiplier(): number {
    return this.adaptive.getScaleMultiplier();
  }

  /**
   * Submit a new job to the queue
   */
  public submit<T>(
    id: string,
    execute: () => Promise<T>,
    options: { priority?: number; tokensEstimate?: number } = {}
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const nominalEstimate = options.tokensEstimate ?? 1000;
      const scaledEstimate = this.adaptive.scaleEstimate(nominalEstimate);

      const job: ScheduledJob = {
        id,
        priority: options.priority ?? 0,
        tokensEstimate: scaledEstimate,
        execute,
        resolve,
        reject,
        submittedAt: Date.now(),
      };

      this.queue.push(job);
      
      // Sort queue by priority (descending), then by submission time (ascending)
      this.sortQueue();

      // Trigger the scheduler loop
      this.scheduleLoop();
    });
  }

  private sortQueue() {
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.submittedAt - b.submittedAt;
    });
  }

  /**
   * Core scheduler loop
   */
  private async scheduleLoop() {
    if (this.isProcessing || this.isPaused) return;
    this.isProcessing = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    try {
      while (this.queue.length > 0) {
        const job = this.queue[0];
        const now = Date.now();
        const delay = this.limiter.timeUntilAvailable(job.tokensEstimate, now);

        if (delay > 0) {
          // Throttled: Wait for the rate limiter to clear
          this.timer = setTimeout(() => {
            this.isProcessing = false;
            this.scheduleLoop();
          }, delay);
          break;
        }

        // Dequeue job
        this.queue.shift();

        // Optimistically record token usage in limiter
        this.limiter.record(job.tokensEstimate, now);

        // Execute asynchronous job (do not block the scheduling loop)
        this.executeJob(job);
      }
    } finally {
      if (!this.timer) {
        this.isProcessing = false;
      }
    }
  }

  private async executeJob(job: ScheduledJob) {
    const startedAt = Date.now();
    try {
      const result = await job.execute();
      
      // Here, if actual response size is known (e.g. from telemetry),
      // we could calibrate the rate limiter with actual vs estimated difference.
      
      job.resolve(result);
    } catch (err) {
      job.reject(err);
    } finally {
      // Re-trigger queue checking in case slots opened up
      this.scheduleLoop();
    }
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getUsage() {
    return this.limiter.getUsage();
  }

  public updateLimits(limits: LimiterLimits) {
    this.limiter.updateLimits(limits);
    this.scheduleLoop();
  }
}
