# vibetrace

![version](https://img.shields.io/badge/version-0.1.0-blue)
![npm](https://img.shields.io/npm/v/vibetrace)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%3E%3D16-brightgreen)

> **AI wrote it. vibetrace sees what it actually does.**

You're vibe coding. AI is writing your project.  
It installs packages, modifies files, runs commands.  
You have no idea what's actually happening.

**vibetrace fixes that.**

```
AI modifies auth.js
  → vibetrace: "3 modules affected. Risk: HIGH. Stop and review."

AI runs rm -rf node_modules
  → vibetrace: "BLOCKED. Dangerous command detected."

App crashes after AI patch
  → vibetrace: "Here's the prompt. Paste it to your AI."
```

---

## The Problem With Vibe Coding

```
AI fix → another fix → another fix → project structure collapse
```

Git tracks changes. SonarQube checks quality.  
But nothing watches **AI changes in real time** and tells you when to stop.

vibetrace does.

```
Not for humans to read. For AI to understand.
```

---

## Quick Start

**New project:**
```bash
npm install -g vibetrace
cd your-project
vibetrace init
vibetrace watch --intent="Build auth system"
```

**Existing project (3~5 years old):**
```bash
npm install -g vibetrace
cd your-project
vibetrace scan      # current state — health score, risk files
vibetrace hotspot   # files AI should review first
vibetrace watch     # start tracking from here
```

---

## How It Works

```
Existing project
      ↓
vibetrace scan      → health score, risk files, unused deps
      ↓
vibetrace hotspot   → files ranked by change freq + risk + deps
      ↓
vibetrace watch     → auto diff+risk on every file change
      ↓
AI Intention Tracker → "fix login" but modified webpack? flagged
      ↓
Diff Analysis       → what changed, which lines, change type
      ↓
Impact Graph        → which modules are affected
      ↓
Risk Scoring        → LOW / MED / HIGH
      ↓
Shell Wrapper       → auto-intercept npm/node commands
      ↓
Command Guard       → blocks dangerous commands
      ↓
Project Score       → completeness / stability / AI confidence
      ↓
Prompt Builder      → error + stack trace → AI-ready prompt
      ↓
Growth Tracker      → AI% vs me% over time
      ↓
History             → project evolution log

── Extension ─────────────────────────────────────
MCP Server          → Claude Desktop / Cursor integration
                      should_proceed → agent stops when risk HIGH
```

---

## Features

### Project Scan — Start Here for Existing Projects
```bash
vibetrace scan
```
```
════════════════════════════════════════════════════
  vibetrace — Project Scan
════════════════════════════════════════════════════
  Files scanned   : 234
  Total lines     : 48,291
  Packages used   : 87
  Test files      : 12

  Code health     : 71%
  Stability       : 63%
  Test coverage   : 22%
  Dep health      : 84%

  ⚠  unhandled promise: 47
  ⚠  possible null access: 31
  ⚠  Unused dependencies: 12

  High risk files:
  → src/auth/login.js
  → src/payment/stripe.js
  → src/db/query.js

  Next: vibetrace hotspot  (find files to review first)
        vibetrace watch    (start tracking changes)
════════════════════════════════════════════════════
```

### Hotspot Analysis — Files AI Should Review First
```bash
vibetrace hotspot
```
```
══════════════════════════════════════════════════════════════════════
  vibetrace — Hotspot Analysis
  Files AI should review first before modifying
──────────────────────────────────────────────────────────────────────
  File                            Changes   Deps    Risk
──────────────────────────────────────────────────────────────────────
  src/auth/login.js               47        12      HIGH
  → authentication · changed 47x · 5 stability issues
  src/api/user.js                 38        9       HIGH
  src/db/query.js                 29        15      MED
  src/middleware/auth.js          21        8       MED
══════════════════════════════════════════════════════════════════════
  ⚠  2 high-risk files — review before AI modification
  Next: vibetrace watch  (start tracking changes)
```

### File Watcher — Auto Diff on Every Change
```bash
vibetrace watch
vibetrace watch --intent="Fix login bug"
```
```
  [HIGH] src/auth/login.js  7 lines changed
  ⚠  critical: authentication
  → affects: session.js, user.js

  ⚠  Intent Mismatch Detected
  Intent  : "Fix login bug"
  Modified: webpack.config.js  (build config)
  → AI modified build config while intent was "Fix login bug"
```

### AI Diff Tracker
```bash
vibetrace diff src/auth.js
```
```
═══════════════════════════════════════════════════════════
  vibetrace — AI Diff Analysis
═══════════════════════════════════════════════════════════
  File:          src/auth.js
  Changed lines: 7
  Change type:   null safety fix, error handling added

  ~ [81]  return data.profile.name
    [81]  return data.profile?.name

  Impact:
  → src/middleware/session.js
  → src/api/user.js

  AI Change Risk: HIGH
  · critical path: authentication
  · 3 modules affected

  ⚠  AI modified critical module — recommend review
═══════════════════════════════════════════════════════════
```

### Command Guard — Block Dangerous Commands
```bash
vibetrace run-cmd "npm install axios"     # LOW → allowed
vibetrace run-cmd "rm -rf node_modules"  # HIGH → BLOCKED
vibetrace run-cmd "git push --force"     # HIGH → BLOCKED
vibetrace cmdlog                          # execution history
vibetrace setup-wrapper                   # auto-intercept npm/node
```
```
  ✓ npm install axios                              LOW
  ✗ rm -rf node_modules                            HIGH  (blocked)
  ⚠ git reset --hard                              MED
```

### Project Score
```bash
vibetrace score
```
```
  API completeness  ████████████░░░░░░░░  75%
  Architecture      █████████████████░░░  83%
  Dependency health ██████████████░░░░░░  68%
  Runtime stability ████████████████░░░░  81%
  Test coverage     ██████████████░░░░░░  68%

  completeness      ████████████████░░░░  79%
  stability         ████████████████░░░░  74%
  AI confidence     ████████████████░░░░  76%

  Overall project health: 76%
```

### AI-Ready Prompt
```bash
vibetrace prompt
```
```
─────────────────────────────────────────────────────
  vibetrace — AI-Ready Prompt
  Copy and paste this to your AI assistant:
─────────────────────────────────────────────────────
I encountered an error in my Node.js project.

## Environment
- Node: v20.10.0
- OS: win32
- Command: npm run dev

## Error
Module not found: Can't resolve 'core-js-pure'

## Stack Trace
  at Object.<anonymous> (src/app.js:12:1)
  at Module._compile (node:internal/modules/cjs/loader:1376)

## Recent AI Changes
- File: src/service.js
- Changed lines: 12
- Change type: dependency change
- Risk level: MED

## High Risk Files
- src/auth/login.js  [HIGH]  deps: 12
- src/api/user.js    [HIGH]  deps: 9

## Request
Please identify the root cause and provide the exact fix.
─────────────────────────────────────────────────────
```

### Vibe Growth Tracker
```bash
vibetrace growth
```
```
  AI  ████████████░░░░░░░░  61%
  Me  ████████░░░░░░░░░░░░  39%

  Weekly progress
  week 8   AI: 89%  me: 11%
  week 9   AI: 71%  me: 29%  ↑
  week 10  AI: 61%  me: 39%  ↑

  → Getting there. Keep reviewing AI changes.
```

### MCP Integration — Extension for AI Agent Control
```bash
vibetrace mcp
```

Connect Claude Desktop / Cursor to vibetrace:

```json
{
  "mcpServers": {
    "vibetrace": {
      "url": "http://localhost:3741"
    }
  }
}
```

| Tool | Description |
|---|---|
| `analyze_diff` | Analyze AI code changes, get risk level |
| `should_proceed` | Returns `proceed: false` when risk is HIGH → agent stops |
| `execute_command` | Run terminal command with safety guard |
| `evaluate_project` | Get full project quality scores |
| `get_history` | Project evolution history |
| `get_growth` | AI vs manual code ratio |
| `record_step` | Add evolution step |

```
AI agent about to modify auth.js
  → calls should_proceed
  → { "proceed": false, "risk": "HIGH", "reason": "critical path: authentication" }
  → agent stops and asks user for confirmation
```

---

## CLI Reference

```bash
# ── Existing project (start here) ──────────────────
vibetrace scan                       Scan entire project — health score, risk files
vibetrace hotspot                    Files AI should review first (change freq + risk)
vibetrace watch                      Auto diff+risk on every file change
vibetrace watch --intent="Fix login" Track AI intent vs actual changes

# ── Active development ──────────────────────────────
vibetrace init                       Initialize tracking
vibetrace diff <file>                Analyze AI changes (vs git HEAD)
vibetrace impact <file>              Show affected modules
vibetrace risk                       Latest AI change risk
vibetrace score                      Project quality score
vibetrace run <cmd>                  Run command with runtime tracing
vibetrace step "desc"                Record evolution step
vibetrace history                    Project evolution history
vibetrace growth                     AI vs manual code ratio
vibetrace prompt                     Generate AI-ready prompt from error

# ── Command Guard ───────────────────────────────────
vibetrace run-cmd "<cmd>"            Run command with AI guard
vibetrace cmdlog                     Command execution history
vibetrace setup-wrapper              Auto-intercept npm/node (shell PATH)

# ── Extension ───────────────────────────────────────
vibetrace mcp [--port=3741]          Start MCP server for AI agent integration

# Global flags
--json       Machine-readable JSON output (AI-friendly)
--quiet, -q  Errors only
--verbose    Full internal logs
```

---

## Add to Your Project

```json
{
  "devDependencies": {
    "vibetrace": "^0.1.0"
  },
  "scripts": {
    "scan":    "vibetrace scan",
    "hotspot": "vibetrace hotspot",
    "watch":   "vibetrace watch",
    "trace":   "vibetrace score",
    "prompt":  "vibetrace prompt",
    "growth":  "vibetrace growth",
    "guard":   "vibetrace cmdlog"
  }
}
```

AI will automatically use these when verifying the project:
```
AI: "Let me check the project health"
  → npm run scan
  → reads output
  → fixes issues
  → npm run trace
  → "stability improved to 84%"
```

---

## dryinstall Integration

vibetrace works standalone. With [dryinstall](https://github.com/MinSeok-log/dryinstall) ([npm](https://www.npmjs.com/package/dryinstall)), you get full coverage:

```
dryinstall   →  install-time: blocks malicious packages
vibetrace    →  runtime: traces what code actually does + AI change control
```

```bash
npm install -g dryinstall vibetrace
dryinstall install <pkg>    # secure install
vibetrace diff src/app.js   # analyze what AI changed
```

---

## Changelog

| Version | What changed |
|---|---|
| **v0.1.0** | Initial release — scan, hotspot, watch, diff tracker, command guard, shell wrapper, growth tracker, MCP server, project score, AI-ready prompt, intent mismatch detection |

---

## Research

[Cognitive Injection](https://github.com/MinSeok-log/cognitive-injection) — A new npm attack vector targeting AI agents via stdout. Bypasses all static security scanners.

---

## License

MIT