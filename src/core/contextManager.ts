import { Message } from '../providers/types.js';
import { isOllamaRunning } from '../providers/ollama.js';

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

  private async generateLocalSummary(messagesToCompress: Message[]): Promise<string | null> {
    try {
      const running = await isOllamaRunning();
      if (!running) return null;

      const chatHistoryText = messagesToCompress.map(m => {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `${m.role.toUpperCase()}: ${text}`;
      }).join('\n\n');

      const prompt = `Summarize the following coding agent conversation turns into a single short paragraph recapping key topics discussed, goals achieved, and code changes: \n\n${chatHistoryText}\n\nSummary paragraph:`;

      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3',
          prompt,
          stream: false,
        }),
        signal: AbortSignal.timeout(3000), // strict timeout to keep proxy fast
      });

      if (res.ok) {
        const data = await res.json();
        return data.response?.trim() || null;
      }
    } catch {}
    return null;
  }

  /**
   * Deflates the message context history to reduce token pressure.
   * Keeps the system prompt (if any) and the last N turns intact.
   * Summarizes or drops intermediate turns to fit within safe limits.
   */
  public async deflate(messages: Message[], keepLastTurns = 4): Promise<Message[]> {
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

    // Try generating local semantic summary using Ollama
    let summaryText = await this.generateLocalSummary(historyToCompress);

    if (!summaryText) {
      // Fallback: Formulate a single summarized replacement message for the oldest history
      let fallbackText = '[SYSTEM: Early conversation history deflated to save context window space. Summary of past turns: ';
      const summaries: string[] = [];
      for (const msg of historyToCompress) {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const snippet = text.substring(0, 60) + (text.length > 60 ? '...' : '');
        summaries.push(`${msg.role.toUpperCase()}: ${snippet}`);
      }
      fallbackText += summaries.join(' -> ') + ']';
      summaryText = fallbackText;
    } else {
      summaryText = `[SYSTEM: Early conversation history deflated. Context summary of past turns: ${summaryText}]`;
    }

    const deflatedHistoryMessage: Message = {
      role: 'system',
      content: summaryText,
    };

    return [...systemMsgList, deflatedHistoryMessage, ...recentMessages];
  }
}
