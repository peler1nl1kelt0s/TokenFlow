import { Message } from '../providers/types.js';

export interface ContextManagerConfig {
  maxContextTokens: number;
  pressureThreshold?: number; // default: 0.80 (80%)
}

export class ContextManager {
  private maxContextTokens: number;
  private pressureThreshold: number;

  constructor(config: ContextManagerConfig) {
    this.maxContextTokens = config.maxContextTokens;
    this.pressureThreshold = config.pressureThreshold ?? 0.80;
  }

  /**
   * Simple character-based token estimator for messages
   */
  public estimateTokens(messages: Message[]): number {
    let charCount = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        charCount += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        charCount += JSON.stringify(msg.content).length;
      }
    }
    return Math.ceil(charCount / 4);
  }

  public getPressure(messages: Message[]): number {
    const currentTokens = this.estimateTokens(messages);
    return currentTokens / this.maxContextTokens;
  }

  public shouldCompress(messages: Message[]): boolean {
    return this.getPressure(messages) > this.pressureThreshold;
  }

  /**
   * Deflates the message context history to reduce token pressure.
   * Keeps the system prompt (if any) and the last N turns intact.
   * Summarizes or drops intermediate turns to fit within safe limits.
   */
  public deflate(messages: Message[], keepLastTurns = 4): Message[] {
    if (!this.shouldCompress(messages)) {
      return messages;
    }

    const systemPrompt = messages.find(m => m.role === 'system');
    const userAndAssistantMessages = messages.filter(m => m.role !== 'system');

    if (userAndAssistantMessages.length <= keepLastTurns) {
      return messages; // Can't compress further without cutting recent turns
    }

    const systemMsgList = systemPrompt ? [systemPrompt] : [];
    
    // Split into historical turns (to be compressed) and recent turns (to keep intact)
    const splitIndex = userAndAssistantMessages.length - keepLastTurns;
    const historyToCompress = userAndAssistantMessages.slice(0, splitIndex);
    const recentMessages = userAndAssistantMessages.slice(splitIndex);

    // Formulate a single summarized replacement message for the oldest history
    let summaryText = '[SYSTEM: Early conversation history deflated to save context window space. Summary of past turns: ';
    
    const summaries: string[] = [];
    for (const msg of historyToCompress) {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const snippet = text.substring(0, 60) + (text.length > 60 ? '...' : '');
      summaries.push(`${msg.role.toUpperCase()}: ${snippet}`);
    }
    
    summaryText += summaries.join(' -> ') + ']';

    const deflatedHistoryMessage: Message = {
      role: 'system',
      content: summaryText,
    };

    return [...systemMsgList, deflatedHistoryMessage, ...recentMessages];
  }
}
