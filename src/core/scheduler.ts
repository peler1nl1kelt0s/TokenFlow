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
  sessionId: string; // Grouping identifier for tab/client session isolation
}

export class TokenFlowScheduler {
  private queue: ScheduledJob[] = [];
  private limiter: TokenRateLimiter;
  private adaptive: AdaptiveController;
  private isProcessing = false;
  private isPaused = false;
  private timer: NodeJS.Timeout | null = null;

  // Deficit Round Robin (DRR) State variables
  private deficits: Record<string, number> = {};
  private quantum = 10000; // Base token quantum allocated per session round-robin turn

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
    options: { priority?: number; tokensEstimate?: number; sessionId?: string } = {}
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
        sessionId: options.sessionId || 'default_session',
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
   * Core scheduler loop using Deficit Round Robin (DRR) scheduling policy
   */
  private async scheduleLoop() {
    if (this.isProcessing || this.isPaused) return;
    this.isProcessing = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    try {
      let madeProgress = true;

      while (this.queue.length > 0 && madeProgress) {
        madeProgress = false;

        // Retrieve active session IDs currently having jobs in the queue
        const activeSessions = Array.from(new Set(this.queue.map(j => j.sessionId)));
        if (activeSessions.length === 0) break;

        for (const sessionId of activeSessions) {
          // Allocate quantum tokens to this session for the current round
          this.deficits[sessionId] = (this.deficits[sessionId] || 0) + this.quantum;

          // Process jobs belonging to this session while deficit allows
          while (true) {
            // Find first job in the sorted queue for the current session
            const jobIndex = this.queue.findIndex(j => j.sessionId === sessionId);
            if (jobIndex === -1) {
              // Reset deficit if queue is empty for this session
              this.deficits[sessionId] = 0;
              break;
            }

            const job = this.queue[jobIndex];
            const now = Date.now();

            // Check if session has accumulated enough deficit quota to execute the job
            if (job.tokensEstimate > this.deficits[sessionId]) {
              // Insufficient deficit token quota, wait for next round
              break;
            }

            // Verify rate-limiting window availability
            const delay = this.limiter.timeUntilAvailable(job.tokensEstimate, now);
            if (delay > 0) {
              // Globally throttled: Wait for the rate-limiting window to clear
              this.timer = setTimeout(() => {
                this.isProcessing = false;
                this.scheduleLoop();
              }, delay);
              return; // Stop processing loop and wait for timer to fire
            }

            // Dequeue job from the queue
            this.queue.splice(jobIndex, 1);

            // Deduct tokens from session's deficit accumulator
            this.deficits[sessionId] -= job.tokensEstimate;

            // Optimistically record usage in rate limiter
            this.limiter.record(job.tokensEstimate, now);

            // Trigger asynchronous job execution
            this.executeJob(job);

            madeProgress = true;
          }
        }
      }
    } finally {
      if (!this.timer) {
        this.isProcessing = false;
      }
    }
  }

  private async executeJob(job: ScheduledJob) {
    try {
      const result = await job.execute();
      job.resolve(result);
    } catch (err) {
      job.reject(err);
    } finally {
      // Re-trigger scheduler loop
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
