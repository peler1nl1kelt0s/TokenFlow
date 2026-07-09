import { PIDController } from './pid.js';

export class AdaptiveController {
  private pid: PIDController;
  private currentMultiplier = 1.0;
  private transactionCount = 0;
  private lastUpdateTime: number;

  constructor() {
    // PID tuned to adjust the scaling multiplier.
    // Setpoint is 1.0 (actual / estimated ratio should ideally be 1.0).
    this.pid = new PIDController({
      kp: 0.3,
      ki: 0.1,
      kd: 0.05,
      minOutput: -2.0, // Allow negative correction output
      maxOutput: 2.0,  // Allow positive correction output
    });
    this.lastUpdateTime = Date.now();
  }

  /**
   * Record a completed execution transaction with actual token counts.
   * This computes the error ratio and updates the adaptive scale multiplier using the PID controller.
   */
  public recordTransaction(estimated: number, actual: number) {
    if (estimated <= 0 || actual <= 0) return;

    this.transactionCount++;
    const now = Date.now();
    const dtSeconds = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;

    // The ratio of actual consumption vs expected.
    // e.g. if actual=1200 and estimated=1000, ratio=1.2 (our estimate was too low).
    const actualRatio = actual / estimated;

    // Use PID to calculate the adjustment needed to reach target ratio of 1.0.
    // Since increasing the multiplier reduces the future error ratio, we swap arguments
    // (setpoint = actualRatio, processValue = 1.0) to invert control polarity.
    const correction = this.pid.calculate(actualRatio, 1.0, dtSeconds);

    // Dynamic update: adjust multiplier in direction of correction.
    // We scale the adjustment based on a smoothing factor to prevent sudden shifts.
    const alpha = 0.4; 
    this.currentMultiplier = Math.max(0.2, Math.min(5.0, this.currentMultiplier + correction * alpha));
  }

  public getScaleMultiplier(): number {
    return this.currentMultiplier;
  }

  public scaleEstimate(nominalEstimate: number): number {
    return Math.ceil(nominalEstimate * this.currentMultiplier);
  }

  public getTransactionCount(): number {
    return this.transactionCount;
  }

  public reset() {
    this.currentMultiplier = 1.0;
    this.transactionCount = 0;
    this.pid.reset();
    this.lastUpdateTime = Date.now();
  }
}
