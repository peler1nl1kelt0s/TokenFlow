import { describe, it, expect } from 'vitest';
import { classifyPromptComplexity } from './classifier.js';

describe('classifyPromptComplexity', () => {
  it('should classify simple greetings and short queries as standard', () => {
    const greeting = [{ role: 'user' as const, content: 'hello there' }];
    expect(classifyPromptComplexity(greeting)).toBe('standard');

    const simpleQuestion = [{ role: 'user' as const, content: 'what is the capital of Turkey?' }];
    expect(classifyPromptComplexity(simpleQuestion)).toBe('standard');

    const docsRequest = [{ role: 'user' as const, content: 'add comments explaining what this function does' }];
    expect(classifyPromptComplexity(docsRequest)).toBe('standard');
  });

  it('should classify coding tasks, architecture keywords, and long prompts as premium', () => {
    const refactorCode = [{ role: 'user' as const, content: 'refactor this function to fix a potential race condition' }];
    expect(classifyPromptComplexity(refactorCode)).toBe('premium');

    const longCodingRequest = [{
      role: 'user' as const,
      content: 'Write a compiler parser class. ' + 'a '.repeat(500)
    }];
    expect(classifyPromptComplexity(longCodingRequest)).toBe('premium');

    const structPatterns = [{
      role: 'user' as const,
      content: 'Here is some code:\nconst x = 5;\nfunction main() {\n  return class MyClass {};\n}\n' + 'a '.repeat(200)
    }];
    expect(classifyPromptComplexity(structPatterns)).toBe('premium');
  });
});
