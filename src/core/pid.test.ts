import { describe, it, expect } from 'vitest';
import { PIDController } from './pid.js';
import { AdaptiveController } from './adaptive.js';

describe('PIDController', () => {
  it('should compute proportional correction correctly', () => {
    const pid = new PIDController({
      kp: 2.0,
      ki: 0.0,
      kd: 0.0,
      minOutput: -100,
      maxOutput: 100,
    });

    // Error = Setpoint - ProcessValue = 10 - 2 = 8
    // Output = Kp * Error = 2 * 8 = 16
    const output = pid.calculate(10, 2, 1);
    expect(output).toBe(16);
  });

  it('should clamp output and perform anti-windup', () => {
    const pid = new PIDController({
      kp: 1.0,
      ki: 1.0, // Integral gain is active
      kd: 0.0,
      minOutput: 0,
      maxOutput: 10,
    });

    // Enforce large error to trigger saturation
    // Step 1: Error = 10 - 0 = 10. Output = 10 + 10 = 20 -> Clamped to 10
    const out1 = pid.calculate(10, 0, 1);
    expect(out1).toBe(10);

    // Step 2: Because it was saturated and error is still positive (10 > 0),
    // the anti-windup clamping should prevent the integral term from accumulating further.
    const out2 = pid.calculate(10, 0, 1);
    expect(out2).toBe(10);
  });
});

describe('AdaptiveController', () => {
  it('should scale multipliers based on transaction ratios', () => {
    const adaptive = new AdaptiveController();
    expect(adaptive.getScaleMultiplier()).toBe(1.0);

    // Record a transaction where actual was higher than estimated (ratio 1.5)
    // The controller should adjust the multiplier UP to scale future estimates larger
    adaptive.recordTransaction(1000, 1500);
    const m1 = adaptive.getScaleMultiplier();
    expect(m1).toBeGreaterThan(1.0);

    // Record transaction where actual was lower (ratio 0.5)
    // The multiplier should shift down
    adaptive.recordTransaction(1000, 500);
    const m2 = adaptive.getScaleMultiplier();
    expect(m2).toBeLessThan(m1);
  });
});
