import { describe, it, expect } from 'vitest';
import { ContextManager } from '../core/contextManager.js';
import { MultiModelRouter } from './router.js';
import { ProviderRequest } from '../providers/types.js';

describe('ContextManager', () => {
  it('should estimate token count and calculate pressure correctly', () => {
    const manager = new ContextManager({ maxContextTokens: 100 });
    const messages = [
      { role: 'system' as const, content: 'system instructions' }, // 19 chars -> ~5 tokens
      { role: 'user' as const, content: 'hello world!' }, // 12 chars -> ~3 tokens
    ];

    const tokens = manager.estimateTokens(messages);
    expect(tokens).toBe(8);
    expect(manager.getPressure(messages)).toBe(0.08);
    expect(manager.shouldCompress(messages)).toBe(false);
  });

  it('should deflate message history when pressure is high', () => {
    // Max context 10 tokens, threshold 0.80 -> Limit 8 tokens
    const manager = new ContextManager({ maxContextTokens: 10, pressureThreshold: 0.80 });

    const messages = [
      { role: 'system' as const, content: 'SYS' }, // 1 token
      { role: 'user' as const, content: 'Turn 1' }, // 2 tokens
      { role: 'assistant' as const, content: 'Response 1' }, // 3 tokens
      { role: 'user' as const, content: 'Turn 2' }, // 2 tokens
      { role: 'assistant' as const, content: 'Response 2' }, // 3 tokens
      { role: 'user' as const, content: 'Turn 3' }, // 2 tokens
      { role: 'assistant' as const, content: 'Response 3' }, // 3 tokens
    ];

    expect(manager.shouldCompress(messages)).toBe(true);

    // Deflate keeping last 2 turns
    const deflated = manager.deflate(messages, 2);

    // Expect system message, replacement summary, and last 2 turns (4 messages total)
    expect(deflated.length).toBe(4);
    expect(deflated[0].content).toBe('SYS');
    expect(deflated[1].role).toBe('system');
    expect(deflated[1].content).toContain('history deflated');
    
    // Recent turns should remain intact (last 2 turns: Turn 3 and Response 3)
    expect(deflated[2].content).toBe('Turn 3');
    expect(deflated[3].content).toBe('Response 3');
  });
});

describe('MultiModelRouter', () => {
  const router = new MultiModelRouter('premium-model', 'cheap-model');

  it('should route simple/greeting prompts to cheap model', async () => {
    const request: ProviderRequest = {
      model: 'any',
      messages: [{ role: 'user', content: 'hello' }],
    };

    const route = await router.route(request);
    expect(route.model).toBe('cheap-model');
  });

  it('should route long/complex prompts to premium model', async () => {
    const request: ProviderRequest = {
      model: 'any',
      messages: [
        { 
          role: 'user', 
          content: 'Write a full compiler infrastructure in Rust using inkwell llvm bindings. Please make sure to cover lexical analysis, parsing, AST generation, and codegen for simple expressions. Provide complete modules.' 
        },
      ],
    };

    const route = await router.route(request);
    expect(route.model).toBe('premium-model');
  });

  it('should respect complexity headers', async () => {
    const request: ProviderRequest = {
      model: 'any',
      messages: [{ role: 'user', content: 'hi' }],
    };

    const route = await router.route(request, 'high');
    expect(route.model).toBe('premium-model');
  });
});
