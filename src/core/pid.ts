export interface PIDConfig {
  kp: number;
  ki: number;
  kd: number;
  minOutput: number;
  maxOutput: number;
}

export class PIDController {
  private kp: number;
  private ki: number;
  private kd: number;
  private minOutput: number;
  private maxOutput: number;

  private integral = 0;
  private lastError = 0;

  constructor(config: PIDConfig) {
    this.kp = config.kp;
    this.ki = config.ki;
    this.kd = config.kd;
    this.minOutput = config.minOutput;
    this.maxOutput = config.maxOutput;
  }

  /**
   * Calculate control output based on setpoint, actual process value, and time delta.
   * Includes anti-windup clamping for the integral term.
   */
  public calculate(setpoint: number, processValue: number, dtSeconds: number): number {
    if (dtSeconds <= 0) dtSeconds = 1;

    const error = setpoint - processValue;

    // Proportional term
    const pTerm = this.kp * error;

    // Integral term (with basic anti-windup limit clamping)
    this.integral += error * dtSeconds;
    const iTerm = this.ki * this.integral;

    // Derivative term
    const dTerm = this.kd * ((error - this.lastError) / dtSeconds);

    this.lastError = error;

    // Calculate total output
    let output = pTerm + iTerm + dTerm;

    // Clamp output and prevent integral windup if saturated
    if (output > this.maxOutput) {
      output = this.maxOutput;
      // Undo last integral accumulation if it contributed to saturation
      if (error > 0) {
        this.integral -= error * dtSeconds;
      }
    } else if (output < this.minOutput) {
      output = this.minOutput;
      if (error < 0) {
        this.integral -= error * dtSeconds;
      }
    }

    return output;
  }

  public reset() {
    this.integral = 0;
    this.lastError = 0;
  }
}
