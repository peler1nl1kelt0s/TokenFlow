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
