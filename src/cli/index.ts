import { Command } from 'commander';
import dotenv from 'dotenv';
import { startProxyServer } from '../proxy/server.js';
import { scanRepository } from '../estimators/repoScanner.js';
import { runExecCommand } from './exec.js';
import { runInteractiveSetup } from './setup.js';
import { SKILL_MD_CONTENT } from '../scripts/skillTemplate.js';
import fs from 'fs/promises';
import path from 'path';
import picocolors from 'picocolors';

// Load local environment variables from .env
dotenv.config();

const program = new Command();

program
  .name('tf')
  .description('TokenFlow AI Execution Scheduler CLI')
  .version('0.1.0');

program
  .command('start')
  .description('Start the TokenFlow local reverse proxy')
  .option('-p, --port <number>', 'Port to run the proxy server on', '8080')
  .option('--tpm <number>', 'Token Per Minute Limit', '40000')
  .option('--rpm <number>', 'Requests Per Minute Limit', '3')
  .action((options) => {
    const port = parseInt(options.port, 10);
    const tpm = parseInt(options.tpm, 10);
    const rpm = parseInt(options.rpm, 10);

    console.log(picocolors.bold(picocolors.green('=== TokenFlow Scheduler Server ===')));
    
    // Warn if API keys are missing in the local environment
    if (!process.env.OPENAI_API_KEY) {
      console.log(picocolors.yellow('[Warning] OPENAI_API_KEY is not defined in env variables. Client must supply it via Authorization header.'));
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log(picocolors.yellow('[Warning] ANTHROPIC_API_KEY is not defined in env variables. Client must supply it via x-api-key header.'));
    }

    try {
      startProxyServer({ port, tpm, rpm });
    } catch (err: any) {
      console.error(picocolors.red(`[Error] Failed to start server: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('scan')
  .description('Scan a directory to compute LOC, file counts, imports, and complexity metrics')
  .argument('[dir]', 'Directory path to scan', './')
  .action(async (dir) => {
    console.log(picocolors.bold(picocolors.cyan(`\n🔍 Scanning repository: ${dir}...`)));
    try {
      const summary = await scanRepository(dir);
      console.log(picocolors.green('\n=== Complexity Analysis Summary ==='));
      console.log(`Total Source Files:   ${picocolors.bold(summary.fileCount)}`);
      console.log(`Total Lines of Code:  ${picocolors.bold(summary.totalLinesOfCode)}`);
      console.log(`Average Lines/File:   ${picocolors.bold(summary.avgFileLines)}`);
      console.log(`Total Import Calls:   ${picocolors.bold(summary.importCount)}`);
      console.log(`God Files (>500 LOC): [${summary.godFiles.length}]`);
      if (summary.godFiles.length > 0) {
        for (const file of summary.godFiles) {
          console.log(`  - ${picocolors.yellow(file)}`);
        }
      }
      console.log();
    } catch (err: any) {
      console.error(picocolors.red(`[Error] Failed to scan repository: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('exec')
  .description('Run a local agent command with TokenFlow automatic redirection proxy')
  .option('-p, --port <number>', 'Port to run the proxy server on', '8080')
  .option('--tpm <number>', 'Token Per Minute Limit', '40000')
  .option('--rpm <number>', 'Requests Per Minute Limit', '3')
  .argument('<command...>', 'The agent command to execute')
  .action((command, options) => {
    const port = parseInt(options.port, 10);
    const tpm = parseInt(options.tpm, 10);
    const rpm = parseInt(options.rpm, 10);
    runExecCommand(command, { port, tpm, rpm });
  });

program
  .command('add-skill')
  .description('Install the TokenFlow custom skill locally in the current repository')
  .option('-d, --dir <path>', 'Custom directory to write the skill to', '.agents/skills')
  .action(async (options) => {
    const skillDir = path.join(process.cwd(), options.dir, 'tokenflow');
    console.log(picocolors.cyan(`[Skill] Installing TokenFlow skill locally in ${skillDir}...`));
    try {
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), SKILL_MD_CONTENT);
      console.log(picocolors.green(`\n🚀 [Success] TokenFlow skill installed successfully at ${path.join(skillDir, 'SKILL.md')}\n`));
    } catch (err: any) {
      console.error(picocolors.red(`[Error] Failed to install skill: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('setup')
  .description('Run the interactive TokenFlow multi-agent setup wizard')
  .action(async () => {
    await runInteractiveSetup();
  });

program.parse(process.argv);
