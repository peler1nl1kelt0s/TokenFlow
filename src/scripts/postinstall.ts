import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SKILL_MD_CONTENT, AGENTS_LIST } from './skillTemplate.js';

const ALIAS_BLOCK = `
# === TokenFlow Auto-Scheduler Integration ===
if [ -n "$(command -v tf)" ]; then
  alias claude="tf exec claude"
  alias aider="tf exec aider"
fi
# ============================================
`;

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
