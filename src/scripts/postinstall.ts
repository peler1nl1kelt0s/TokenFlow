import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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

  for (const profile of profiles) {
    try {
      // Check if profile file exists
      await fs.access(profile);
    } catch {
      continue; // Skip if file doesn't exist
    }

    try {
      const content = await fs.readFile(profile, 'utf-8');
      if (content.includes('TokenFlow Auto-Scheduler Integration')) {
        continue; // Already integrated
      }

      // Append alias block safely to the profile
      await fs.appendFile(profile, ALIAS_BLOCK);
      console.log(`[TokenFlow] Automatically integrated with shell profile: ${profile}`);
      integrated = true;
    } catch (err: any) {
      console.error(`[TokenFlow] Failed to write to profile ${profile}: ${err.message}`);
    }
  }

  if (integrated) {
    console.log('\n🚀 [TokenFlow] Installation completed successfully!');
    console.log('🤖 Your terminal agents (claude, aider) will now automatically run under TokenFlow scheduling.');
    console.log('💡 Please restart your terminal or run "source ~/.zshrc" (or your shell config) to apply the changes immediately.\n');
  }
}

integrateShell().catch(() => {});
