---
name: tokenflow
description: Enables the agent to optimize token usage, check context pressure, route requests dynamically, and scan directories using local TokenFlow complexity metrics.
---

# TokenFlow Skill

This skill teaches the agent how to run commands and analyze codebases using the local **TokenFlow** execution scheduler.

## Capabilities

When this skill is active, the agent can use local TokenFlow tools to perform tasks efficiently, bypassing raw LLM context usage:

1. **Local Repository Complexity Scanning**:
   Instead of reading large file structures or line counts using raw LLM calls, run:
   ```bash
   tf scan [directory]
   ```
   This compiles lines of code (LOC), average file sizes, import counts, and God files locally using zero tokens.

2. **Scheduled Interceptor Spawning**:
   To run terminal-based coding agents (like Aider, Claude Code, or Codex) under TokenFlow's rate-limiting queues and feedback loops, execute them using the wrapper:
   ```bash
   tf exec -- [command] [args...]
   ```

3. **Running the Local Proxy Server**:
   To boot a persistent token-shaping HTTP Reverse Proxy locally:
   ```bash
   tf start --port 8080 --tpm 40000 --rpm 3
   ```
