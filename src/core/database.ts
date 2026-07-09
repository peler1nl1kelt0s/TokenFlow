import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface ModelConfig {
  premium: string;
  standard: string;
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface TokenFlowConfig {
  models: Record<string, ModelConfig>;
  activeProvider: 'anthropic' | 'openai' | 'hybrid';
  budgetLimit: number;
}

export interface SessionRecord {
  id: string;
  startTime: number;
  endTime: number;
  totalRequests: number;
  actualTokens: number;
  estimatedTokens: number;
  savedTokens: number;
  cost: number;
}

const DEFAULT_CONFIG: TokenFlowConfig = {
  models: {
    // Anthropic Tiers
    'claude-3-5-sonnet-20240620': { premium: 'claude-3-5-sonnet-20240620', standard: 'claude-3-haiku-20240307', inputPerMillion: 3.0, outputPerMillion: 15.0 },
    'claude-3-haiku-20240307': { premium: 'claude-3-5-sonnet-20240620', standard: 'claude-3-haiku-20240307', inputPerMillion: 0.25, outputPerMillion: 1.25 },
    'claude-3-opus-20240229': { premium: 'claude-3-opus-20240229', standard: 'claude-3-haiku-20240307', inputPerMillion: 15.0, outputPerMillion: 75.0 },
    // OpenAI Tiers
    'gpt-4o': { premium: 'gpt-4o', standard: 'gpt-4o-mini', inputPerMillion: 5.0, outputPerMillion: 15.0 },
    'gpt-4o-mini': { premium: 'gpt-4o', standard: 'gpt-4o-mini', inputPerMillion: 0.15, outputPerMillion: 0.60 },
  },
  activeProvider: 'hybrid',
  budgetLimit: 0,
};

export class TokenFlowDatabase {
  private configDir: string;
  private configFile: string;
  private historyFile: string;

  constructor() {
    const homeDir = os.homedir();
    this.configDir = path.join(homeDir, '.tokenflow');
    this.configFile = path.join(this.configDir, 'config.json');
    this.historyFile = path.join(this.configDir, 'history.json');
  }

  private async ensureDir() {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch {}
  }

  public async getConfig(): Promise<TokenFlowConfig> {
    await this.ensureDir();
    try {
      const data = await fs.readFile(this.configFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      // If config is missing, write default config and return it
      await this.saveConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
  }

  public async saveConfig(config: TokenFlowConfig): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
  }

  public async getHistory(): Promise<SessionRecord[]> {
    await this.ensureDir();
    try {
      const data = await fs.readFile(this.historyFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  public async saveHistory(records: SessionRecord[]): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.historyFile, JSON.stringify(records, null, 2), 'utf-8');
  }

  public async recordSession(record: SessionRecord): Promise<void> {
    const history = await this.getHistory();
    history.push(record);
    // Keep only last 100 sessions to prevent history file from growing indefinitely
    if (history.length > 100) {
      history.shift();
    }
    await this.saveHistory(history);
  }

  public async getPricingForModel(modelName: string): Promise<{ inputPerMillion: number; outputPerMillion: number }> {
    const config = await this.getConfig();
    const model = modelName.toLowerCase();

    // 1. Direct match in persistent configuration (sorted by length descending to prevent prefix collisions)
    const sortedKeys = Object.keys(config.models).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (model.includes(key.toLowerCase())) {
        return {
          inputPerMillion: config.models[key].inputPerMillion,
          outputPerMillion: config.models[key].outputPerMillion,
        };
      }
    }

    // 2. Keyword-based Dynamic Fallback Classifications (Regex Heuristics)
    if (model.includes('haiku') || model.includes('mini') || model.includes('flash')) {
      // Standard / cheap pricing tier fallback
      return { inputPerMillion: 0.25, outputPerMillion: 1.25 };
    }
    if (model.includes('opus') || model.includes('fable') || model.includes('o1-pro')) {
      // Ultra-premium pricing tier fallback
      return { inputPerMillion: 15.0, outputPerMillion: 75.0 };
    }
    
    // Premium tier fallback (default)
    return { inputPerMillion: 3.0, outputPerMillion: 15.0 };
  }

  public async getTierForModel(modelName: string): Promise<'premium' | 'standard'> {
    const model = modelName.toLowerCase();
    if (model.includes('haiku') || model.includes('mini') || model.includes('flash')) {
      return 'standard';
    }
    return 'premium';
  }
}
