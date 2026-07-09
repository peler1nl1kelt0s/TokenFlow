import { describe, it, expect } from 'vitest';
import { injectAnthropicCache } from './promptCache.js';

describe('injectAnthropicCache', () => {
  it('should ignore non-claude models', () => {
    const originalRequest = {
      model: 'gpt-4o',
      system: 'Large system prompt...'.repeat(500),
      messages: [{ role: 'user', content: 'hello' }],
    };
    const result = injectAnthropicCache({ ...originalRequest });
    expect(result).toEqual(originalRequest);
  });

  it('should ignore small claude requests below minimum length threshold', () => {
    const originalRequest = {
      model: 'claude-3-5-sonnet-20240620',
      system: 'Small',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const result = injectAnthropicCache({ ...originalRequest });
    expect(result).toEqual(originalRequest);
  });

  it('should inject cache breakpoints in system prompt and messages for large requests', () => {
    const request = {
      model: 'claude-3-5-sonnet-20240620',
      system: 'Large system instructions...'.repeat(200), // > 5000 chars
      messages: [
        { role: 'user', content: 'Turn 1 user message' },
        { role: 'assistant', content: 'Turn 1 assistant message' },
        { role: 'user', content: 'Turn 2 user message' },
        { role: 'assistant', content: 'Turn 2 assistant message' },
        { role: 'user', content: 'Turn 3 user message' },
      ],
    };

    const result = injectAnthropicCache(request);

    // Verify system prompt block contains cache_control
    expect(Array.isArray(result.system)).toBe(true);
    expect(result.system[0].cache_control).toEqual({ type: 'ephemeral' });

    // Verify last message (Turn 3 user message) has cache_control
    const lastMsg = result.messages[4];
    expect(Array.isArray(lastMsg.content)).toBe(true);
    expect(lastMsg.content[0].cache_control).toEqual({ type: 'ephemeral' });

    // Verify message 4 turns back (Turn 1 user message) has cache_control
    const pastMsg = result.messages[0];
    expect(Array.isArray(pastMsg.content)).toBe(true);
    expect(pastMsg.content[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});
