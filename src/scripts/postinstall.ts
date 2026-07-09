import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SKILL_MD_CONTENT } from './skillTemplate.js';

const ALIAS_BLOCK = `
# === TokenFlow Auto-Scheduler Integration ===
if [ -n "$(command -v tf)" ]; then
  alias claude="tf exec claude"
  alias aider="tf exec aider"
fi
# ============================================
`;

const AGENTS_LIST = [
  { name: 'aider-desk', path: '.aider-desk/skills/' },
  { name: 'amp, replit, universal', path: '.config/agents/skills/' },
  { name: 'antigravity', path: '.gemini/antigravity/skills/' },
  { name: 'antigravity-cli', path: '.gemini/antigravity-cli/skills/' },
  { name: 'astrbot', path: '.astrbot/data/skills/' },
  { name: 'autohand-code', path: '.autohand/skills/' },
  { name: 'augment', path: '.augment/skills/' },
  { name: 'bob', path: '.bob/skills/' },
  { name: 'claude-code', path: '.claude/skills/' },
  { name: 'openclaw', path: '.openclaw/skills/' },
  { name: 'cline', path: '.agents/skills/' },
  { name: 'codearts-agent', path: '.codeartsdoer/skills/' },
  { name: 'codebuddy', path: '.codebuddy/skills/' },
  { name: 'codemaker', path: '.codemaker/skills/' },
  { name: 'codestudio', path: '.codestudio/skills/' },
  { name: 'codex', path: '.codex/skills/' },
  { name: 'command-code', path: '.commandcode/skills/' },
  { name: 'continue', path: '.continue/skills/' },
  { name: 'cortex', path: '.snowflake/cortex/skills/' },
  { name: 'crush', path: '.config/crush/skills/' },
  { name: 'cursor', path: '.cursor/skills/' },
  { name: 'deepagents', path: '.deepagents/agent/skills/' },
  { name: 'devin', path: '.config/devin/skills/' },
  { name: 'droid', path: '.factory/skills/' },
  { name: 'firebender', path: '.firebender/skills/' },
  { name: 'forgecode', path: '.forge/skills/' },
  { name: 'gemini-cli', path: '.gemini/skills/' },
  { name: 'github-copilot', path: '.copilot/skills/' },
  { name: 'goose', path: '.config/goose/skills/' },
  { name: 'hermes-agent', path: '.hermes/skills/' },
  { name: 'inference-sh', path: '.inferencesh/skills/' },
  { name: 'jazz', path: '.jazz/skills/' },
  { name: 'junie', path: '.junie/skills/' },
  { name: 'iflow-cli', path: '.iflow/skills/' },
  { name: 'kilo', path: '.kilocode/skills/' },
  { name: 'kiro-cli', path: '.kiro/skills/' },
  { name: 'kode', path: '.kode/skills/' },
  { name: 'lingma', path: '.lingma/skills/' },
  { name: 'mcpjam', path: '.mcpjam/skills/' },
  { name: 'mistral-vibe', path: '.vibe/skills/' },
  { name: 'moxby', path: '.moxby/skills/' },
  { name: 'mux', path: '.mux/skills/' },
  { name: 'opencode', path: '.config/opencode/skills/' },
  { name: 'openhands', path: '.openhands/skills/' },
  { name: 'ona', path: '.ona/skills/' },
  { name: 'pi', path: '.pi/agent/skills/' },
  { name: 'qoder', path: '.qoder/skills/' },
  { name: 'qoder-cn', path: '.qoder-cn/skills/' },
  { name: 'qwen-code', path: '.qwen/skills/' },
  { name: 'reasonix', path: '.reasonix/skills/' },
  { name: 'rovodev', path: '.rovodev/skills/' },
  { name: 'roo', path: '.roo/skills/' },
  { name: 'tabnine-cli', path: '.tabnine/agent/skills/' },
  { name: 'terramind', path: '.terramind/skills/' },
  { name: 'tinycloud', path: '.tinycloud/skills/' },
  { name: 'trae', path: '.trae/skills/' },
  { name: 'trae-cn', path: '.trae-cn/skills/' },
  { name: 'windsurf', path: '.codeium/windsurf/skills/' },
  { name: 'zencoder, zenflow', path: '.zencoder/skills/' },
  { name: 'neovate', path: '.neovate/skills/' },
  { name: 'pochi', path: '.pochi/skills/' },
  { name: 'adal', path: '.adal/skills/' },
];

async function integrateShell() {
  const homeDir = os.homedir();
  const profiles = [
    path.join(homeDir, '.zshrc'),
    path.join(homeDir, '.bashrc'),
    path.join(homeDir, '.bash_profile'),
    path.join(homeDir, '.profile'),
  ];

  let integrated = false;

  // 1. Inject shell aliases
  for (const profile of profiles) {
    try {
      await fs.access(profile);
    } catch {
      continue;
    }

    try {
      const content = await fs.readFile(profile, 'utf-8');
      if (content.includes('TokenFlow Auto-Scheduler Integration')) {
        continue;
      }
      await fs.appendFile(profile, ALIAS_BLOCK);
      console.log(`[TokenFlow] Automatically integrated with shell profile: ${profile}`);
      integrated = true;
    } catch (err: any) {
      console.error(`[TokenFlow] Failed to write to profile ${profile}: ${err.message}`);
    }
  }

  // 2. Automatically copy custom skill to active agents on this machine
  for (const agent of AGENTS_LIST) {
    const skillsDir = path.join(homeDir, agent.path);
    const parentDir = path.dirname(skillsDir);

    try {
      // If the agent configuration folder exists, inject custom skill
      await fs.access(parentDir);
      const targetSkillDir = path.join(skillsDir, 'tokenflow');
      await fs.mkdir(targetSkillDir, { recursive: true });
      await fs.writeFile(path.join(targetSkillDir, 'SKILL.md'), SKILL_MD_CONTENT);
      console.log(`[TokenFlow] Automatically installed custom skill for: ${agent.name} at ${targetSkillDir}`);
    } catch {
      // Agent is not installed, skip silently
    }
  }

  if (integrated) {
    console.log('\n🚀 [TokenFlow] Installation completed successfully!');
    console.log('🤖 Your terminal agents (claude, aider) will now automatically run under TokenFlow scheduling.');
    console.log('💡 Please restart your terminal or run "source ~/.zshrc" (or your shell config) to apply the changes immediately.\n');
  }
}

integrateShell().catch(() => {});
