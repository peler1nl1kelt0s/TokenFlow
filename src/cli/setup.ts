import * as p from '@clack/prompts';
import picocolors from 'picocolors';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';
import { SKILL_MD_CONTENT, AGENTS_LIST } from '../scripts/skillTemplate.js';

const BANNER = `
${picocolors.cyan('████████╗ ██████╗ ██╗  ██╗███████╗███╗   ██╗███████╗██╗      ██████╗ ██╗    ██╗')}
${picocolors.cyan('╚══██╔══╝██╔═══██╗██║ ██╔╝██╔════╝████╗  ██║██╔════╝██║     ██╔═══██╗██║    ██║')}
${picocolors.cyan('   ██║   ██║   ██║█████╔╝ █████╗  ██╔██╗ ██║█████╗  ██║     ██║   ██║██║ █╗ ██║')}
${picocolors.cyan('   ██║   ██║   ██║██╔═██╗ ██╔══╝  ██║╚██╗██║██╔══╝  ██║     ██║   ██║██║███╗██║')}
${picocolors.cyan('   ██║   ╚██████╔╝██║  ██╗███████╗██║ ╚████║██║     ███████╗╚██████╔╝╚███╔███╔╝')}
${picocolors.cyan('   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝ ')}
`;

const SUPPORTED_CLI_COMMANDS = [
  { value: 'claude', label: 'Claude Code (claude)' },
  { value: 'aider', label: 'Aider (aider)' },
  { value: 'gemini-cli', label: 'Gemini CLI (gemini-cli)' },
  { value: 'codex', label: 'Codex (codex)' },
];

function isCommandInstalled(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function runInteractiveSetup() {
  console.log(BANNER);

  p.intro(picocolors.bold(picocolors.green('TokenFlow Interactive Setup Wizard')));

  // 1. Ask if the user wants to set up shell aliases
  const installShell = await p.confirm({
    message: 'Do you want to configure TokenFlow shell aliases for your terminal coding agents?',
    initialValue: true,
  });

  if (p.isCancel(installShell)) {
    p.cancel('Setup canceled.');
    process.exit(0);
  }

  // 2. If yes, check which commands are installed and prompt for multiselect
  let selectedAliases: string[] = [];
  if (installShell) {
    // Detect which commands are installed locally to pre-select them
    const detectedAliases = SUPPORTED_CLI_COMMANDS.filter((cmd) => isCommandInstalled(cmd.value)).map((cmd) => cmd.value);

    const aliasSelection = await p.multiselect({
      message: 'Select which terminal agents you want to wrap with TokenFlow (installed agents are pre-selected):',
      options: SUPPORTED_CLI_COMMANDS,
      initialValues: detectedAliases,
      required: false,
    });

    if (p.isCancel(aliasSelection)) {
      p.cancel('Setup canceled.');
      process.exit(0);
    }

    selectedAliases = aliasSelection as string[];
  }

  // 3. Scan home directory to detect installed coding agents for skills copying
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

  // 4. Prompt user to select which agents to inject skills to (pre-selecting all detected)
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

  // 5. Perform actions with visual spinner feedback
  const executionSpinner = p.spinner();
  executionSpinner.start('Applying configuration settings...');

  let shellIntegrated = false;
  if (installShell && selectedAliases.length > 0) {
    // Construct alias lines dynamically using npx instead of tf
    let dynamicAliases = '\n# === TokenFlow Auto-Scheduler Integration ===\n';
    for (const cmd of selectedAliases) {
      dynamicAliases += `alias ${cmd}="npx -y @peler1nl1kelt0s/tokenflow exec ${cmd}"\n`;
    }
    dynamicAliases += '# ============================================\n';

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
          await fs.appendFile(profile, dynamicAliases);
          shellIntegrated = true;
        }
      } catch {}
    }
  }

  // Step 5b: Copy skills
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

  // 6. Outro summary
  p.note(
    `Shell Profile: ${
      shellIntegrated
        ? picocolors.green('Integrated successfully')
        : picocolors.gray('No changes needed / skipped')
    }\nActive Aliases: ${picocolors.cyan(selectedAliases.join(', ') || 'none')}\nSkills Injected: ${picocolors.green(`${skillsInstalled} agents configured`)}`,
    'Configuration Summary'
  );

  p.outro(
    picocolors.bold(
      picocolors.green('🎉 Setup complete! Please restart your terminal to activate changes.')
    )
  );
}
