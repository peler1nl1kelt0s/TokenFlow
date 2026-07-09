# TokenFlow

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Test Suite](https://img.shields.io/badge/tests-15%20passed-brightgreen)](#)

TokenFlow is a production-grade, provider-agnostic **AI Execution Scheduler and Traffic-Shaping Proxy** designed to run seamlessly between autonomous coding agents (such as Claude Code, Aider, Cline, Antigravity, and Cursor) and upstream model providers (Anthropic, OpenAI, Gemini, etc.).

Instead of optimizing for raw, bursty throughput that leads to rate-limiting failures (HTTP 429) and session starvation, TokenFlow schedules and paces AI resources (tokens, costs, request slots, and context window limits) to guarantee **continuous, uninterrupted agent progress**.

```
+-----------------------------------------------------------+
|                    Agent / User Prompt                    |
+-----------------------------------------------------------+
                              |
                              v
+-----------------------------------------------------------+
|                    TokenFlow Scheduler                    |
|                                                           |
|   +-------------------+             +-----------------+   |
|   |   Local Scanner   |  Priors     | Dynamic Pacing  |   |
|   |   (Zero-Token)    |------------>| Queue (DRR/WFQ) |   |
|   +-------------------+             +-----------------+   |
|             |                                |            |
|             +------------+     +-------------+            |
|                          |     |                          |
|                          v     v                          |
|   +---------------------------------------------------+   |
|   |         Closed-Loop PID Adaptive Controller       |   |
|   +---------------------------------------------------+   |
+-----------------------------------------------------------+
                              |
                              v
+-----------------------------------------------------------+
|                 Provider Routing Proxy                    |
+-----------------------------------------------------------+
         /                    |                    \
        v                     v                     v
 +-------------+       +-------------+       +-------------+
 |  Anthropic  |       |   OpenAI    |       |  Local LLM  |
 +-------------+       +-------------+       +-------------+
```

---

## Key Features

*   **Closed-Loop PID Control**: Dynamically adjusts token allocation rates and queuing delays using a mathematical Proportional-Integral-Derivative (PID) controller. This shapes traffic, eliminating HTTP 429 rate limit exceptions before they happen.
*   **Adaptive Estimation Calibration**: Learns from transaction execution errors in real-time. If the agent's actual consumption is significantly lower than estimated (e.g., fast failures or small replies), the scheduler scales down enqueued allocations, allowing more queries to pack into the active rate window.
*   **Zero-Token Repository Scanner**: Recursively compiles Lines of Code (LOC), directory depth, file counts, and dependency imports locally using a high-speed AST/metadata parser. It sends a highly compressed summary matrix under 200 tokens, avoiding sending whole directory trees to LLMs.
*   **Context Window Governance & Deflation**: Monitors context window pressure ($P_c$). When the threshold is exceeded (default: 80%), it automatically compresses intermediate message logs into a system-guided summary while keeping recent turns intact.
*   **Zero-Config Interceptor Runner (`tf exec`)**: Allows any terminal agent (like Claude Code) to run scheduled out-of-the-box. TokenFlow starts a local proxy, injects base URL redirection overrides into the environment, and spawns the agent cleanly.
*   **Autopilot Installation & Skill Injector**: The global installer automatically appends shell aliases to your profiles and detects which of the **60+ supported coding agents** are installed on your machine, injecting the custom TokenFlow `SKILL.md` directly into their configurations.
*   **Dual-Mode Visualizer**:
    *   *Terminal HUD & Telemetry*: Prints interactive queue warnings and a rich ASCII Telemetry Summary report upon command exit.
    *   *HTML Web Dashboard*: Serves a beautiful glassmorphism real-time dashboard at `http://localhost:8080/dashboard`.

---

## Supported Agents

TokenFlow automatically injects global skill definitions into **60+ popular agents** upon installation, including:
*   **Claude Code** (`~/.claude/skills/`)
*   **Cline / Roo Code** (`~/.agents/skills/` / `~/.roo/skills/`)
*   **Cursor** (`~/.cursor/skills/`)
*   **Windsurf** (`~/.codeium/windsurf/skills/`)
*   **GitHub Copilot** (`~/.copilot/skills/`)
*   **Continue** (`~/.continue/skills/`)
*   **Antigravity & Antigravity CLI** (`~/.gemini/antigravity/skills/`)
*   *And 50+ other agent CLI systems.*

---

## Getting Started

### 1. Interactive Installation (Recommended)
To launch the interactive setup wizard directly in your terminal (using `npx` to run without global binary installation warnings):

```bash
npx @peler1nl1kelt0s/tokenflow
```

*This parses your active environment, checks your PATH for installed coding CLI agents (claude, aider, etc.), and allows you to selectively choose which commands to alias and which agent directories to configure with the TokenFlow skill.*

*Note: Restart your terminal or run `source ~/.zshrc` to activate the shell aliases immediately.*

### 2. Basic Usage (Zero-Config)
To run your favorite terminal agent under TokenFlow's adaptive pacing queues:

```bash
# Wrap Claude Code
claude

# Wrap Aider
aider --git
```

*These run the commands wrapped through the `tf exec` interceptor proxy automatically.*

### 3. Manual Server Execution
Start the reverse proxy server on a custom port with specific TPM and RPM quotas:

```bash
tf start --port 8080 --tpm 40000 --rpm 3
```

### 4. Running a Local Scan
Scan any directory locally to generate high-speed complexity and file import telemetry:

```bash
tf scan ./src
```

### 5. Installing Local Workspace Skills
To explicitly add the TokenFlow custom skill block to a specific project directory (e.g., to share with your team in Git):

```bash
tf add-skill --dir .agents/skills
```

### 6. Accessing the Dashboard
Open your browser and navigate to the local dashboard to monitor real-time enqueues, uptime, and multiplier scaling values:
```text
http://localhost:8080/dashboard
```

---

## CLI Telemetry Report Output

When you quit a wrapped agent execution, TokenFlow prints a rich ASCII report summary directly in your shell:

```text
=========================================
      TokenFlow Session Telemetry       
=========================================
Uptime:             45s
Total Requests:     4
Actual Tokens:      1,532
Estimated Tokens:   8,500
Tokens Saved:       6,968
Adaptive Scale Mult: 0.46
=========================================
```

---

## Project Structure

```
tokenflow/
├── bin/
│   └── tf.js                  # CLI global bin executable
├── src/
│   ├── cli/
│   │   ├── index.ts           # Commander CLI registry
│   │   └── exec.ts            # Redirection process spawner
│   ├── core/
│   │   ├── limiter.ts         # Sliding window TPM/RPM rate limiter
│   │   ├── scheduler.ts       # Priority execution queue
│   │   ├── pid.ts             # Math feedback PID loop
│   │   └── contextManager.ts  # Pressure deflation engine
│   ├── estimators/
│   │   └── repoScanner.ts     # Local dependency import mapper
│   └── proxy/
│       ├── router.ts          # Complexity routing manager
│       ├── server.ts          # Express reverse proxy server
│       └── dashboard.html     # Glassmorphism HTML page
└── tsconfig.json
```

---

## Contributing

TokenFlow is open-source software licensed under the **Apache 2.0 License**. We welcome contributions to provider adapters, routing policies, and control loop tuning.

To run the Vitest unit test suite locally:
```bash
npm run test
```