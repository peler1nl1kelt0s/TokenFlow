import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { SKILL_MD_CONTENT, AGENTS_LIST } from './skillTemplate.js';
import { runInteractiveSetup } from '../cli/setup.js';

function isCommandInstalled(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function integrateShell() {
  const homeDir = os.homedir();
  const profiles = [
    path.join(homeDir, '.zshrc'),
    path.join(homeDir, '.bashrc'),
    path.join(homeDir, '.bash_profile'),
    path.join(homeDir, '.profile'),
  ];

  // Detect which commands are installed locally
  const supportedClis = ['claude', 'aider', 'gemini-cli', 'codex'];
  const installedClis = supportedClis.filter(isCommandInstalled);

  if (installedClis.length === 0) {
    return; // No terminal coding agents installed, skip shell aliases
  }

  // Construct dynamic alias block
  let dynamicAliases = '\n# === TokenFlow Auto-Scheduler Integration ===\nif [ -n "$(command -v tf)" ]; then\n';
  for (const cmd of installedClis) {
    dynamicAliases += `  alias ${cmd}="tf exec ${cmd}"\n`;
  }
  dynamicAliases += 'fi\n# ============================================\n';

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
      await fs.appendFile(profile, dynamicAliases);
      console.log(`[TokenFlow] Automatically integrated aliases for [${installedClis.join(', ')}] with shell profile: ${profile}`);
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

async function runInstaller() {
  // If it's a TTY terminal and running interactively, run the beautiful CLI Wizard!
  if (process.stdin.isTTY && process.stdout.isTTY) {
    try {
      await runInteractiveSetup();
      return;
    } catch {
      // Fallback to silent installation if wizard throws
    }
  }

  // Fallback to silent automatic installation
  await integrateShell();
}

runInstaller().catch(() => {});
