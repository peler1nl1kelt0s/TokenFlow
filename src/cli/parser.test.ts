import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('CLI Parser Option Pass-Through', () => {
  it('should pass unrecognized option-like flags to the spawned command without Commander throwing an error', () => {
    // Run the CLI through tsx with a custom command that includes flags.
    // We run it with --dry-run and on a unique port to avoid side effects.
    const output = execSync(
      'npx tsx src/cli/index.ts exec --port 9876 --dry-run echo --some-unrecognized-flag',
      { encoding: 'utf-8', stdio: 'pipe' }
    );

    // Verify that commander did not crash with "error: unknown option"
    expect(output).not.toContain('error: unknown option');
    
    // Verify that the command wrapper spawned the child agent with the correct arguments
    expect(output).toContain('[Wrapper] Spawning child agent process: echo --some-unrecognized-flag');
    expect(output).toContain('--some-unrecognized-flag');
  });
});
