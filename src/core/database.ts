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
    // Anthropic 2026 Tiers
    'claude-5-fable': { premium: 'claude-5-fable', standard: 'claude-4-5-haiku', inputPerMillion: 10.0, outputPerMillion: 50.0 },
    'claude-4-8-opus': { premium: 'claude-4-8-opus', standard: 'claude-4-5-haiku', inputPerMillion: 5.0, outputPerMillion: 25.0 },
    'claude-5-sonnet': { premium: 'claude-5-sonnet', standard: 'claude-4-5-haiku', inputPerMillion: 2.0, outputPerMillion: 10.0 },
    'claude-4-5-haiku': { premium: 'claude-5-sonnet', standard: 'claude-4-5-haiku', inputPerMillion: 1.0, outputPerMillion: 5.0 },
    
    // Legacy/Existing Anthropic Tiers
    'claude-3-5-sonnet-20240620': { premium: 'claude-3-5-sonnet-20240620', standard: 'claude-3-haiku-20240307', inputPerMillion: 3.0, outputPerMillion: 15.0 },
    'claude-3-haiku-20240307': { premium: 'claude-3-5-sonnet-20240620', standard: 'claude-3-haiku-20240307', inputPerMillion: 0.25, outputPerMillion: 1.25 },
    'claude-3-opus-20240229': { premium: 'claude-3-opus-20240229', standard: 'claude-3-haiku-20240307', inputPerMillion: 15.0, outputPerMillion: 75.0 },
    
    // OpenAI 2026 Tiers
    'gpt-5.6-sol': { premium: 'gpt-5.6-sol', standard: 'gpt-5.6-luna', inputPerMillion: 5.0, outputPerMillion: 30.0 },
    'gpt-5.6-terra': { premium: 'gpt-5.6-terra', standard: 'gpt-5.6-luna', inputPerMillion: 2.5, outputPerMillion: 15.0 },
    'gpt-5.6-luna': { premium: 'gpt-5.6-sol', standard: 'gpt-5.6-luna', inputPerMillion: 1.0, outputPerMillion: 6.0 },
    'gpt-5.4-nano': { premium: 'gpt-5.6-sol', standard: 'gpt-5.4-nano', inputPerMillion: 0.20, outputPerMillion: 1.25 },

    // Legacy/Existing OpenAI Tiers
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
      const loaded = JSON.parse(data);
      
      // Dynamic auto-merge default config values into existing config files
      let changed = false;
      if (!loaded.models) {
        loaded.models = {};
        changed = true;
      }
      for (const [key, value] of Object.entries(DEFAULT_CONFIG.models)) {
        if (!loaded.models[key]) {
          loaded.models[key] = value;
          changed = true;
        }
      }
      if (changed) {
        await this.saveConfig(loaded);
      }
      
      return loaded;
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
