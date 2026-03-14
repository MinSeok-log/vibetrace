#!/usr/bin/env node
'use strict';

const path          = require('path');
const fs            = require('fs');
const logger        = require('../src/logger');
const Tracer        = require('../src/tracer');
const DiffTracker   = require('../src/diff-tracker');
const GrowthTracker = require('../src/growth-tracker');
const PromptBuilder = require('../src/prompt-builder');
const History       = require('../src/history');
// mcp: lazy loaded when 'vibetrace mcp' is called
const Scanner  = require('../src/scanner');
const { startDaemon, stopDaemon, daemonStatus } = require('../src/daemon');
const { setupHooks, removeHooks, autoSetup }    = require('../src/hooks');
const Hotspot  = require('../src/hotspot');
const Watcher  = require('../src/watcher');
const { setupWrapper } = require('../src/shell-wrapper');
const Evaluator    = require('../src/evaluator');
const CommandGuard = require('../src/command-guard');

const args    = process.argv.slice(2);
const command = args[0];
const jsonFlag    = args.includes('--json');
const verboseFlag = args.includes('--verbose') || args.includes('-v');
const quietFlag   = args.includes('--quiet')   || args.includes('-q');

if (jsonFlag)        logger.setJson(true);
else if (quietFlag)  logger.setLevel('QUIET');
else if (verboseFlag) logger.setLevel('VERBOSE');

const cwd = process.cwd();

async function main() {
  // ── init ──────────────────────────────────────────────
  if (command === 'init') {
    const history = new History(cwd);
    history.addStep('Project initialized with vibetrace', { source: 'manual', risk: 'LOW' });
    logger.ok(`vibetrace initialized in ${cwd}`);
    logger.info('Run "vibetrace run <cmd>" to start tracking');

  // ── run ───────────────────────────────────────────────
  } else if (command === 'run') {
    const cmd = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    if (!cmd) { logger.warn('Usage: vibetrace run <command>'); process.exit(1); }

    const tracer = new Tracer(cwd);
    tracer.start();

    logger.info(`Running: ${cmd}`);
    const { execSync } = require('child_process');
    try {
      execSync(cmd, { cwd, stdio: 'inherit' });
    } catch {}

    tracer.stop();
    const data = tracer.save();

    if (jsonFlag) { logger.json(data); }
    else {
      tracer.printSnapshot();
      tracer.printLoadedModules();
      tracer.printCallGraph();
    }

  // ── trace ─────────────────────────────────────────────
  } else if (command === 'trace') {
    const tracer = new Tracer(cwd);
    tracer.start();
    tracer.printSnapshot();
    tracer.printLoadedModules();
    tracer.printCallGraph();

  // ── diff ──────────────────────────────────────────────
  } else if (command === 'diff') {
    const filePath = args[1];
    if (!filePath) { logger.warn('Usage: vibetrace diff <file>'); process.exit(1); }

    const absPath = path.resolve(cwd, filePath);
    if (!fs.existsSync(absPath)) { logger.warn(`File not found: ${filePath}`); process.exit(1); }

    // git diff로 before/after 가져오기
    const { execSync } = require('child_process');
    let before = '', after = '';
    try {
      before = execSync(`git show HEAD:${filePath}`, { cwd, encoding: 'utf-8' });
    } catch { before = ''; }
    after = fs.readFileSync(absPath, 'utf-8');

    const tracker = new DiffTracker(cwd);
    const result  = tracker.analyze(absPath, before, after);

    if (jsonFlag) { logger.json(result); }
    else { tracker.printDiff(result); }

    // growth tracker에 기록
    const growth = new GrowthTracker(cwd);
    growth.recordAI(filePath, result.changedLines);

    // Intent Mismatch + HIGH risk 처리
    if (result.risk.level === 'HIGH') {
      const storage  = require('../src/storage');
      const intentLog = storage.load(cwd, 'intent-mismatches') || [];
      const lastIntent = storage.load(cwd, 'history');
      const currentIntent = lastIntent?.slice(-1)[0]?.step || null;

      // 의도한 파일인지 판단
      const relFile   = result.file.toLowerCase();
      const isIntended = currentIntent
        ? currentIntent.toLowerCase().split(' ').some(kw =>
            kw.length > 3 && relFile.includes(kw)
          )
        : false;

      const C = logger.C;

      if (!isIntended && currentIntent) {
        // 의도하지 않은 HIGH → 사용자 보고 필요
        logger.always('\n' + C.RED + '═'.repeat(56) + C.RESET);
        logger.always(C.BOLD + C.RED + '  ⚠  VIBETRACE_CONFIRM_REQUIRED' + C.RESET);
        logger.always(C.RED + '═'.repeat(56) + C.RESET);
        logger.always('  Intent  : "' + currentIntent + '"');
        logger.always('  Modified: ' + result.file + '  [HIGH]');
        logger.always(C.RED + '  → This file was not part of the intended change.' + C.RESET);
        logger.always(C.YELLOW + '  → Recommended: ask user before proceeding.' + C.RESET);
        logger.always(C.RED + '═'.repeat(56) + C.RESET + '\n');

        // AI 환경에서 인식할 수 있게 exit 1
        if (!jsonFlag) process.exit(1);
      } else {
        // 의도한 HIGH → 경고만
        logger.always('\n  ' + C.YELLOW + '⚠  HIGH risk but matches intent — proceeding' + C.RESET);
        logger.always('  ' + C.GRAY + 'Run "vibetrace impact ' + filePath + '" to check affected modules' + C.RESET + '\n');
      }
    }

  // ── impact ────────────────────────────────────────────
  } else if (command === 'impact') {
    const filePath = args[1];
    if (!filePath) { logger.warn('Usage: vibetrace impact <file>'); process.exit(1); }

    const absPath = path.resolve(cwd, filePath);
    const content = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : '';
    const tracker = new DiffTracker(cwd);
    const impact  = tracker._analyzeImpact(absPath, content);

    if (jsonFlag) { logger.json(impact); }
    else {
      const C = logger.C;
      const W = 52;
      logger.always(`\n${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
      logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Impact Analysis${C.RESET}`);
      logger.always(`${C.CYAN}${'─'.repeat(W)}${C.RESET}`);
      logger.always(`  ${C.BOLD}File:${C.RESET} ${path.relative(cwd, absPath)}`);
      if (impact.criticalPath.length > 0) {
        logger.always(`  ${C.RED}${C.BOLD}Critical path: ${impact.criticalPath.join(', ')}${C.RESET}`);
      }
      if (impact.affectedModules.length > 0) {
        logger.always(`\n  ${C.BOLD}Affected modules (${impact.affectedModules.length}):${C.RESET}`);
        impact.affectedModules.forEach(m => logger.always(`  ${C.GRAY}→ ${m}${C.RESET}`));
      } else {
        logger.always(`  ${C.GREEN}No affected modules detected${C.RESET}`);
      }
      logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}\n`);
    }

  // ── risk ──────────────────────────────────────────────
  } else if (command === 'risk') {
    const storage = require('../src/storage');
    const history = storage.load(cwd, 'diff-history') || [];
    const C = logger.C;

    if (history.length === 0) {
      logger.info('No diff history. Run "vibetrace diff <file>" first.');
      process.exit(0);
    }

    const latest = history[history.length - 1];
    const riskColor = latest.risk === 'HIGH' ? C.RED : latest.risk === 'MED' ? C.YELLOW : C.GREEN;

    if (jsonFlag) { logger.json(latest); }
    else {
      logger.always(`\n  ${C.BOLD}Latest AI Change Risk: ${riskColor}${latest.risk}${C.RESET}`);
      logger.always(`  File: ${latest.file}`);
      logger.always(`  Changed lines: ${latest.changedLines}`);
    }

  // ── history ───────────────────────────────────────────
  } else if (command === 'history') {
    const history = new History(cwd);
    if (jsonFlag) {
      const storage = require('../src/storage');
      logger.json(storage.load(cwd, 'history') || []);
    } else {
      history.print();
    }

  // ── growth ────────────────────────────────────────────
  } else if (command === 'growth') {
    const growth = new GrowthTracker(cwd);
    if (jsonFlag) { logger.json(growth.analyze()); }
    else { growth.print(); }

  // ── prompt ────────────────────────────────────────────
  } else if (command === 'prompt') {
    const builder  = new PromptBuilder(cwd);
    const errorLog = args[1] || '';
    const storage  = require('../src/storage');
    const trace    = storage.load(cwd, 'trace');
    const diffs    = storage.load(cwd, 'diff-history');
    const lastDiff = diffs ? diffs[diffs.length - 1] : null;

    const prompt = builder.fromError(errorLog || 'Error details not provided.', trace, lastDiff);
    builder.print(prompt);

  // ── score ───────────────────────────────────────────────
  } else if (command === 'score') {
    const evaluator = new Evaluator(cwd);
    const result    = await evaluator.evaluate();
    if (jsonFlag) { logger.json(result); }
    else { evaluator.print(result); }

  // ── run-cmd ──────────────────────────────────────────
  } else if (command === 'run-cmd') {
    const cmd = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    if (!cmd) { logger.warn('Usage: vibetrace run-cmd "<command>"'); process.exit(1); }
    const guard  = new CommandGuard(cwd);
    const result = await guard.run(cmd, { source: 'manual' });
    if (jsonFlag) { logger.json(result); }
    if (!result.success && result.blocked) process.exit(1);

  // ── cmdlog ────────────────────────────────────────────
  } else if (command === 'cmdlog') {
    const guard = new CommandGuard(cwd);
    if (jsonFlag) {
      const storage = require('../src/storage');
      logger.json(storage.load(cwd, 'command-log') || []);
    } else {
      guard.printLog();
    }

  // ── mcp ───────────────────────────────────────────────
  } else if (command === 'mcp') {
    const { startServer } = require('../mcp/server');
    const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || '3741');
    startServer(port, cwd);

  // ── daemon ───────────────────────────────────────────
  } else if (command === 'daemon') {
    const sub = args[1];
    if (sub === 'stop')        stopDaemon();
    else if (sub === 'status') daemonStatus();
    else                       startDaemon(cwd);

  // ── setup-hooks ───────────────────────────────────────
  } else if (command === 'setup-hooks') {
    setupHooks(cwd);

  // ── remove-hooks ──────────────────────────────────────
  } else if (command === 'remove-hooks') {
    removeHooks(cwd);

  // ── auto-setup ────────────────────────────────────────
  // npm postinstall 자동 실행용
  } else if (command === 'auto-setup') {
    autoSetup(cwd);

  // ── scan ─────────────────────────────────────────────
  } else if (command === 'scan') {
    const scanner = new Scanner(cwd);
    const result  = await scanner.scan();
    if (jsonFlag) { logger.json(result); }
    else { scanner.print(result); }

  // ── hotspot ───────────────────────────────────────────
  } else if (command === 'hotspot') {
    const hotspot  = new Hotspot(cwd);
    const results  = await hotspot.analyze();
    if (jsonFlag) { logger.json(results); }
    else { hotspot.print(results); }

  // ── watch ─────────────────────────────────────────────
  } else if (command === 'watch') {
    const intent      = args.find(a => a.startsWith('--intent='))?.split('=').slice(1).join('=');
    const daemonMode  = args.includes('--daemon');
    const workerMode  = args.includes('--daemon-worker');

    if (daemonMode) {
      // 백그라운드 데몬으로 실행
      startDaemon(cwd);
    } else {
      const watchCwd = workerMode ? (process.env.VIBETRACE_CWD || cwd) : cwd;
      const watcher  = new Watcher(watchCwd);
      if (intent) watcher.setIntent(intent);
      watcher.start();
      process.on('SIGINT', () => { watcher.stop(); process.exit(0); });
      process.on('SIGTERM', () => { watcher.stop(); process.exit(0); });
      setInterval(() => {}, 1000);
    }

  // ── setup-wrapper ─────────────────────────────────────
  } else if (command === 'setup-wrapper') {
    setupWrapper(cwd);

  // ── step ──────────────────────────────────────────────
  } else if (command === 'step') {
    const label  = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    const source = args.find(a => a.startsWith('--source='))?.split('=')[1] || 'ai';
    const risk   = args.find(a => a.startsWith('--risk='))?.split('=')[1]   || 'LOW';
    if (!label) { logger.warn('Usage: vibetrace step "description" --source=ai --risk=LOW'); process.exit(1); }
    const history = new History(cwd);
    history.addStep(label, { source, risk });

  // ── help ──────────────────────────────────────────────
  } else {
    const C = logger.C;
    console.log(`
${C.CYAN}${C.BOLD}vibetrace${C.RESET} — AI code change monitor for the vibe coding era
${C.GRAY}"AI wrote it. vibetrace sees what it actually does."${C.RESET}

${C.BOLD}Usage:${C.RESET}
  vibetrace init                       Initialize tracking in current project

${C.BOLD}── Existing project (start here) ───────────────────${C.RESET}
  vibetrace scan                       Scan entire project — health score, risk files
  vibetrace hotspot                    Files AI should review first (by change freq + risk)
  vibetrace watch                      Auto diff+risk on every file change
  vibetrace watch --intent="Fix login" Track AI intent vs actual changes

${C.BOLD}── Active development ──────────────────────────────${C.RESET}
  vibetrace init                       Initialize tracking in current project
  vibetrace run <cmd>                  Run command with full runtime tracing
  vibetrace diff <file>                Analyze AI changes in a file (vs git HEAD)
  vibetrace impact <file>              Show which modules a file affects
  vibetrace risk                       Show latest AI change risk score
  vibetrace history                    Show project evolution history
  vibetrace growth                     Show AI vs manual code ratio
  vibetrace prompt [error]             Generate AI-ready prompt from error/state
  vibetrace step "desc" --source=ai    Record a project evolution step
  vibetrace score                      Evaluate code quality (API, architecture, stability)
  vibetrace run-cmd "<cmd>"            Run command with AI guard (blocks dangerous commands)
  vibetrace cmdlog                     Show AI command execution history
  vibetrace setup-wrapper              Auto-intercept npm/node commands (shell PATH)
  vibetrace mcp [--port=3741]          Start MCP server for AI agent integration

${C.BOLD}Global flags:${C.RESET}
  --json       Machine-readable JSON output
  --quiet, -q  Errors only
  --verbose, -v  Full internal logs

${C.BOLD}dryinstall integration:${C.RESET}
  ${C.GRAY}dryinstall   →  install-time security (blocks malicious packages)${C.RESET}
  ${C.GRAY}vibetrace    →  runtime analysis (traces what code actually does)${C.RESET}

${C.BOLD}── Extension: MCP Integration ──────────────────────${C.RESET}
  ${C.GRAY}vibetrace mcp [--port=3741]   Start MCP server${C.RESET}
  ${C.GRAY}Connect Claude Desktop / Cursor to vibetrace data${C.RESET}
  ${C.GRAY}AI agents auto-call should_proceed before risky changes${C.RESET}
  ${C.GRAY}Add to Claude Desktop config:${C.RESET}
  ${C.GRAY}  { "mcpServers": { "vibetrace": { "url": "http://localhost:3741" } } }${C.RESET}
`);
  }
}

main().catch(err => {
  logger.block(err.message);
  process.exit(1);
});