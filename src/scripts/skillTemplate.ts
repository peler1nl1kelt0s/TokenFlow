export const SKILL_MD_CONTENT = `---
name: tokenflow
description: Enables the agent to optimize token usage, check context pressure, route requests dynamically, and scan directories using local TokenFlow complexity metrics.
---

# TokenFlow Skill

This skill teaches the agent how to run commands and analyze codebases using the local **TokenFlow** execution scheduler.

## Capabilities
1. **Local Repository Complexity Scanning**: Run 'tf scan [directory]' to scan files, LOC, and dependency metrics locally with zero tokens.
2. **Scheduled Interceptor Spawning**: Run terminal coding agents under TokenFlow queue wrapping with 'tf exec -- [command] [args...]'.
3. **Local Proxy Server**: Boot a persistent token-shaping HTTP Reverse Proxy locally with 'tf start'.
`;

export const AGENTS_LIST = [
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
