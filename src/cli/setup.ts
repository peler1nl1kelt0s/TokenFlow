import * as p from '@clack/prompts';
import picocolors from 'picocolors';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { SKILL_MD_CONTENT, AGENTS_LIST } from '../scripts/skillTemplate.js';

const BANNER = `
${picocolors.cyan('████████╗ ██████╗ ██╗  ██╗███████╗███╗   ██╗███████╗██╗      ██████╗ ██╗    ██╗')}
${picocolors.cyan('╚══██╔══╝██╔═══██╗██║ ██╔╝██╔════╝████╗  ██║██╔════╝██║     ██╔═══██╗██║    ██║')}
${picocolors.cyan('   ██║   ██║   ██║█████╔╝ █████╗  ██╔██╗ ██║█████╗  ██║     ██║   ██║██║ █╗ ██║')}
${picocolors.cyan('   ██║   ██║   ██║██╔═██╗ ██╔══╝  ██║╚██╗██║██╔══╝  ██║     ██║   ██║██║███╗██║')}
${picocolors.cyan('   ██║   ╚██████╔╝██║  ██╗███████╗██║ ╚████║██║     ███████╗╚██████╔╝╚███╔███╔╝')}
${picocolors.cyan('   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝ ')}
`;

const ALIAS_BLOCK = `
# === TokenFlow Auto-Scheduler Integration ===
if [ -n "$(command -v tf)" ]; then
  alias claude="tf exec claude"
  alias aider="tf exec aider"
fi
# ============================================
`;

export async function runInteractiveSetup() {
  console.log(BANNER);

  p.intro(picocolors.bold(picocolors.green('TokenFlow Interactive Setup Wizard')));

  // 1. Prompt for shell profile aliases integration
  const installShell = await p.confirm({
    message: 'Do you want to integrate TokenFlow shell aliases (claude, aider) into your profile?',
    initialValue: true,
  });

  if (p.isCancel(installShell)) {
    p.cancel('Setup canceled.');
    process.exit(0);
  }

  // 2. Scan home directory to detect installed coding agents
  const s = p.spinner();
  s.start('Scanning system for active coding agents...');

  const homeDir = os.homedir();
  const detectedAgents: typeof AGENTS_LIST = [];

  for (const agent of AGENTS_LIST) {
    const skillsDir = path.join(homeDir, agent.path);
    const parentDir = path.dirname(skillsDir);
    try {
      await fs.access(parentDir);
      detectedAgents.push(agent);
    } catch {}
  }

  s.stop(
    detectedAgents.length > 0
      ? `Found ${detectedAgents.length} active coding agents on your machine!`
      : 'No active agent installations detected in home directory.'
  );

  // 3. Prompt user to select which agents to inject skills to (pre-selecting all detected)
  let selectedAgents: string[] = [];
  if (detectedAgents.length > 0) {
    const options = detectedAgents.map((agent) => ({
      value: agent.name,
      label: `${agent.name} (${picocolors.gray(agent.path)})`,
    }));

    const selection = await p.multiselect({
      message: 'Select which agents you want to install the TokenFlow skill to:',
      options,
      initialValues: detectedAgents.map((a) => a.name),
    });

    if (p.isCancel(selection)) {
      p.cancel('Setup canceled.');
      process.exit(0);
    }

    selectedAgents = selection as string[];
  }

  // 4. Perform actions with visual spinner feedback
  const executionSpinner = p.spinner();
  executionSpinner.start('Applying configuration settings...');

  // Step 4a: Integrate shell profile
  let shellIntegrated = false;
  if (installShell) {
    const profiles = [
      path.join(homeDir, '.zshrc'),
      path.join(homeDir, '.bashrc'),
      path.join(homeDir, '.bash_profile'),
      path.join(homeDir, '.profile'),
    ];

    for (const profile of profiles) {
      try {
        await fs.access(profile);
        const content = await fs.readFile(profile, 'utf-8');
        if (!content.includes('TokenFlow Auto-Scheduler Integration')) {
          await fs.appendFile(profile, ALIAS_BLOCK);
          shellIntegrated = true;
        }
      } catch {}
    }
  }

  // Step 4b: Copy skills
  let skillsInstalled = 0;
  for (const agentName of selectedAgents) {
    const agent = AGENTS_LIST.find((a) => a.name === agentName);
    if (!agent) continue;

    const skillsDir = path.join(homeDir, agent.path);
    const targetSkillDir = path.join(skillsDir, 'tokenflow');
    try {
      await fs.mkdir(targetSkillDir, { recursive: true });
      await fs.writeFile(path.join(targetSkillDir, 'SKILL.md'), SKILL_MD_CONTENT);
      skillsInstalled++;
    } catch (err: any) {
      p.log.error(`Failed to install skill for ${agent.name}: ${err.message}`);
    }
  }

  executionSpinner.stop('All configurations applied!');

  // 5. Outro summary
  p.note(
    `Shell Profile: ${
      shellIntegrated
        ? picocolors.green('Integrated successfully')
        : picocolors.gray('No changes needed / skipped')
    }\nSkills Injected: ${picocolors.green(`${skillsInstalled} agents configured`)}`,
    'Configuration Summary'
  );

  p.outro(
    picocolors.bold(
      picocolors.green('🎉 Setup complete! Please restart your terminal to activate changes.')
    )
  );
}
