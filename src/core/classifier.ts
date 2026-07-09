import { Message } from '../providers/types.js';

const COMPLEXITY_KEYWORDS = [
  'refactor', 'architect', 'optimize', 'algorithms', 'codegen', 'database schema',
  'memory leak', 'race condition', 'multithreading', 'concurrency', 'deadlock',
  'performance issue', 'complex logic', 'compiler', 'parser', 'lexer', 'ast',
  'binary search tree', 'recursively', 'polymorphism', 'design patterns', 'solid principles',
  'dependency injection', 'async io', 'socket', 'crypto', 'rsa', 'aes', 'handshake'
];

const SIMPLE_KEYWORDS = [
  'explain', 'what is', 'how does', 'why', 'meaning of', 'define', 'hello', 'hi',
  'thanks', 'thank you', 'ok', 'clear', 'format', 'comment', 'docstring', 'prettify',
  'indent', 'translate', 'typo', 'grammar', 'summary', 'summarize'
];

export function classifyPromptComplexity(messages: Message[]): 'premium' | 'standard' {
  if (!messages || messages.length === 0) {
    return 'standard';
  }

  // Combine content from the last 2 messages to analyze context
  const recentMessages = messages.slice(-2);
  let text = '';
  for (const msg of recentMessages) {
    if (typeof msg.content === 'string') {
      text += ' ' + msg.content.toLowerCase();
    } else if (Array.isArray(msg.content)) {
      text += ' ' + msg.content.map((c: any) => c.text || '').join(' ').toLowerCase();
    }
  }

  // Count matches
  let complexScore = 0;
  let simpleScore = 0;

  for (const word of COMPLEXITY_KEYWORDS) {
    if (text.includes(word)) {
      complexScore += 2; // High complexity weight
    }
  }

  for (const word of SIMPLE_KEYWORDS) {
    if (text.includes(word)) {
      simpleScore += 1;
    }
  }

  // Heuristics:
  // 1. If contains structural code patterns (e.g. function declarations, class structures) AND is long
  const hasCodeBlocks = text.includes('```') || text.includes('function ') || text.includes('class ') || text.includes('const ');
  if (hasCodeBlocks && text.length > 500) {
    complexScore += 3;
  }

  // 2. Length-based heuristic
  if (text.length > 2000) {
    complexScore += 2; // Very long contexts default to premium
  } else if (text.length < 150) {
    simpleScore += 2; // Very short messages default to standard
  }

  // Final classification decision
  return complexScore >= simpleScore ? 'premium' : 'standard';
}
