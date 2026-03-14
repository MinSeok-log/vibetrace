'use strict';

const { execSync, spawn } = require('child_process');
const logger  = require('./logger');
const storage = require('./storage');

/**
 * CommandGuard — AI 명령어 감시
 *
 * AI 에이전트가 터미널 명령어를 실행할 때:
 * - 위험도 평가
 * - 허용 / 차단 / 경고
 * - 로그 생성
 *
 * vibetrace run-cmd <command>  로 실행
 * MCP tool: execute_command    로 AI가 직접 호출
 */

const C = require('./logger').C;

// ── 위험 명령어 패턴 ─────────────────────────────────────
const DANGER_PATTERNS = [
  // 파일 삭제
  { pattern: /rm\s+-rf?\s+[\/\w]/,              level: 'HIGH',   label: 'recursive file deletion',      block: true  },
  { pattern: /rmdir\s+\/s/i,                    level: 'HIGH',   label: 'directory deletion (Windows)', block: true  },
  { pattern: /del\s+\/[sf]/i,                   level: 'HIGH',   label: 'force delete (Windows)',       block: true  },

  // 시스템 명령
  { pattern: /sudo\s+/,                         level: 'HIGH',   label: 'privilege escalation',         block: true  },
  { pattern: /chmod\s+777/,                     level: 'HIGH',   label: 'insecure permissions',         block: true  },
  { pattern: /curl.*\|\s*(bash|sh|node)/,       level: 'HIGH',   label: 'remote script execution',      block: true  },
  { pattern: /wget.*&&\s*(bash|sh|node)/,       level: 'HIGH',   label: 'remote script execution',      block: true  },

  // 환경 변수 노출
  { pattern: /printenv|env\s*>/,                level: 'MED',    label: 'env variable exposure',        block: false },
  { pattern: /cat\s+.*\.env/,                   level: 'HIGH',   label: '.env file access',             block: true  },

  // npm 위험
  { pattern: /npm\s+publish/,                   level: 'MED',    label: 'npm publish attempt',          block: false },
  { pattern: /npm\s+install\s+-g/,              level: 'MED',    label: 'global package install',       block: false },

  // git 위험
  { pattern: /git\s+push\s+.*-f|git\s+push\s+--force/, level: 'HIGH', label: 'force git push',       block: true  },
  { pattern: /git\s+reset\s+--hard/,            level: 'MED',    label: 'hard git reset',               block: false },

  // 프로세스 종료
  { pattern: /kill\s+-9|taskkill/,              level: 'MED',    label: 'process termination',          block: false },
];

// ── 안전 명령어 (항상 허용) ──────────────────────────────
const SAFE_PATTERNS = [
  /^npm\s+(install|i)\s+[\w@/-]+$/,
  /^npm\s+(run|test|build|start)\s*\w*/,
  /^npx\s+/,
  /^node\s+/,
  /^git\s+(status|diff|log|add|commit|checkout|branch|pull)/,
  /^ls|^dir|^pwd|^cd\s/,
  /^echo\s/,
  /^cat\s+(?!.*\.env)/,
];

class CommandGuard {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }

  // ── 명령어 평가 ────────────────────────────────────────
  evaluate(cmd) {
    // 안전 패턴 체크
    const isSafe = SAFE_PATTERNS.some(p => p.test(cmd.trim()));
    if (isSafe) {
      return { level: 'LOW', blocked: false, label: 'safe command', cmd };
    }

    // 위험 패턴 체크
    for (const { pattern, level, label, block } of DANGER_PATTERNS) {
      if (pattern.test(cmd)) {
        return { level, blocked: block, label, cmd };
      }
    }

    return { level: 'LOW', blocked: false, label: 'unknown command', cmd };
  }

  // ── 명령어 실행 (감시 포함) ────────────────────────────
  async run(cmd, opts = {}) {
    const result = this.evaluate(cmd);
    const { level, blocked, label } = result;

    // 로그 기록
    storage.append(this.cwd, 'command-log', {
      cmd, level, blocked, label,
      source: opts.source || 'unknown',
    });

    // 출력
    this._printEval(cmd, result);

    if (blocked) {
      logger.block(`CommandGuard: execution blocked — ${label}`);
      return { success: false, blocked: true, reason: label };
    }

    if (level === 'MED') {
      logger.warn(`CommandGuard: proceeding with caution — ${label}`);
    }

    // 실행
    try {
      const output = execSync(cmd, {
        cwd: this.cwd,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: opts.silent ? 'pipe' : 'inherit',
      });
      storage.append(this.cwd, 'command-log', { cmd, status: 'success' });
      return { success: true, output };
    } catch (e) {
      storage.append(this.cwd, 'command-log', { cmd, status: 'failed', error: e.message });
      return { success: false, error: e.message };
    }
  }

  // ── 출력 ────────────────────────────────────────────────
  _printEval(cmd, result) {
    const { level, blocked, label } = result;
    const levelColor = level === 'HIGH' ? C.RED : level === 'MED' ? C.YELLOW : C.GREEN;
    const W = 56;

    logger.always(`\n${levelColor}${'─'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Command Guard${C.RESET}`);
    logger.always(`${levelColor}${'─'.repeat(W)}${C.RESET}`);
    logger.always(`  ${C.BOLD}Command:${C.RESET}    ${cmd}`);
    logger.always(`  ${C.BOLD}Risk:${C.RESET}       ${levelColor}${level}${C.RESET}`);
    logger.always(`  ${C.BOLD}Detected:${C.RESET}   ${label}`);

    if (blocked) {
      logger.always(`\n  ${C.RED}${C.BOLD}✗  BLOCKED — AI attempted dangerous command${C.RESET}`);
    } else if (level === 'MED') {
      logger.always(`\n  ${C.YELLOW}⚠  WARNING — proceeding with caution${C.RESET}`);
    } else {
      logger.always(`\n  ${C.GREEN}✓  ALLOWED${C.RESET}`);
    }
    logger.always(`${levelColor}${'─'.repeat(W)}${C.RESET}\n`);
  }

  // ── 명령어 로그 출력 ──────────────────────────────────
  printLog() {
    const log = storage.load(this.cwd, 'command-log') || [];
    const W   = 56;

    logger.always(`\n${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Command History${C.RESET}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}`);

    if (log.length === 0) {
      logger.always(`  ${C.GRAY}No commands recorded yet${C.RESET}`);
    } else {
      log.slice(-20).forEach(entry => {
        if (!entry.cmd) return;
        const color = entry.blocked ? C.RED : entry.level === 'MED' ? C.YELLOW : C.GREEN;
        const icon  = entry.blocked ? '✗' : '✓';
        logger.always(`  ${color}${icon}${C.RESET} ${entry.cmd.slice(0, 48).padEnd(48)} ${C.GRAY}${entry.level || ''}${C.RESET}`);
      });
    }

    const blocked = log.filter(l => l.blocked).length;
    logger.always(`\n  ${C.GRAY}Total: ${log.filter(l=>l.cmd).length}  ${C.RED}Blocked: ${blocked}${C.RESET}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}\n`);
  }
}

module.exports = CommandGuard;
