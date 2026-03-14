'use strict';

const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');
const logger  = require('./logger');
const storage = require('./storage');
const DiffTracker = require('./diff-tracker');

/**
 * Watcher — vibetrace watch
 * 파일 변경 감지 → 자동 diff + risk 계산
 * chokidar 없이 Node 내장 fs.watch 사용 (zero dependency)
 */

const C = require('./logger').C;

class Watcher {
  constructor(cwd = process.cwd()) {
    this.cwd      = cwd;
    this.watchers = [];
    this.debounce = {};
    this.intentContext = null; // AI intention tracker
  }

  // AI 의도 설정 (vibetrace watch --intent "Fix login bug")
  setIntent(intent) {
    this.intentContext = {
      intent,
      startedAt: new Date().toISOString(),
      changedFiles: [],
    };
    logger.info(`watcher: tracking intent — "${intent}"`);
  }

  start(targetDir) {
    const dir = targetDir || path.join(this.cwd, 'src');
    const watchDir = fs.existsSync(dir) ? dir : this.cwd;

    logger.ok(`watcher: watching ${path.relative(this.cwd, watchDir) || '.'}`);
    logger.info('watcher: auto diff + risk on every file change');
    if (this.intentContext) {
      logger.info(`watcher: intent — "${this.intentContext.intent}"`);
    }
    logger.always(`${C.GRAY}  Press Ctrl+C to stop${C.RESET}\n`);

    this._watchDir(watchDir);
  }

  _watchDir(dir, depth = 0) {
    if (depth > 4) return;
    try {
      const watcher = fs.watch(dir, { persistent: true }, (event, filename) => {
        if (!filename) return;
        if (!/\.(js|ts|jsx|tsx)$/.test(filename)) return;

        const fullPath = path.join(dir, filename);
        const key      = fullPath;

        // debounce 300ms
        clearTimeout(this.debounce[key]);
        this.debounce[key] = setTimeout(() => {
          this._onFileChange(fullPath);
        }, 300);
      });
      this.watchers.push(watcher);

      // 하위 디렉토리도 감시
      fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
        if (e.isDirectory() && !['node_modules', '.git', 'dist', 'build'].includes(e.name)) {
          this._watchDir(path.join(dir, e.name), depth + 1);
        }
      });
    } catch {}
  }

  _onFileChange(filePath) {
    if (!fs.existsSync(filePath)) return;

    const rel = path.relative(this.cwd, filePath);
    logger.info(`watcher: changed — ${rel}`);

    // git에서 before 가져오기
    let before = '';
    try {
      before = execSync(`git show HEAD:${rel}`, { cwd: this.cwd, encoding: 'utf-8', timeout: 5000 });
    } catch { before = ''; }

    let after = '';
    try { after = fs.readFileSync(filePath, 'utf-8'); } catch { return; }

    if (before === after) return;

    // diff + risk 분석
    const tracker = new DiffTracker(this.cwd);
    const result  = tracker.analyze(filePath, before, after);

    // Intent tracker — AI 의도와 실제 변경 비교
    if (this.intentContext) {
      this.intentContext.changedFiles.push(rel);
      this._checkIntentMismatch(result);
    }

    // 결과 출력
    const riskColor = result.risk.level === 'HIGH' ? C.RED : result.risk.level === 'MED' ? C.YELLOW : C.GREEN;
    logger.always(
      `\n  ${riskColor}[${result.risk.level}]${C.RESET} ${rel}` +
      `  ${C.GRAY}${result.changedLines} lines changed${C.RESET}`
    );

    if (result.impact.criticalPath.length > 0) {
      logger.always(`  ${C.RED}⚠  critical: ${result.impact.criticalPath.join(', ')}${C.RESET}`);
    }
    if (result.impact.affectedModules.length > 0) {
      logger.always(`  ${C.GRAY}→ affects: ${result.impact.affectedModules.slice(0, 3).join(', ')}${C.RESET}`);
    }
    if (result.risk.level === 'HIGH') {
      logger.always(`  ${C.RED}→ review recommended before proceeding${C.RESET}`);
    }
    logger.always('');
  }

  // AI 의도 vs 실제 변경 불일치 감지
  _checkIntentMismatch(diffResult) {
    if (!this.intentContext) return;

    const intent  = this.intentContext.intent.toLowerCase();
    const changed = diffResult.file.toLowerCase();

    // 의도와 관련 없는 핵심 파일 변경 감지
    const UNRELATED_PATTERNS = [
      { pattern: /webpack|vite|babel|rollup/,    category: 'build config' },
      { pattern: /package\.json|package-lock/,   category: 'dependencies' },
      { pattern: /\.env|config\./,               category: 'configuration' },
    ];

    UNRELATED_PATTERNS.forEach(({ pattern, category }) => {
      if (pattern.test(changed)) {
        const intentKeywords = intent.split(' ');
        const isRelated = intentKeywords.some(kw => changed.includes(kw));
        if (!isRelated) {
          logger.always(
            `\n  ${C.YELLOW}${C.BOLD}⚠  Intent Mismatch Detected${C.RESET}\n` +
            `  ${C.GRAY}Intent  : "${this.intentContext.intent}"${C.RESET}\n` +
            `  ${C.GRAY}Modified: ${diffResult.file}  (${category})${C.RESET}\n` +
            `  ${C.YELLOW}→ AI modified ${category} while intent was "${this.intentContext.intent}"${C.RESET}\n`
          );

          storage.append(this.cwd, 'intent-mismatches', {
            intent:   this.intentContext.intent,
            file:     diffResult.file,
            category,
            risk:     diffResult.risk.level,
          });
        }
      }
    });
  }

  stop() {
    this.watchers.forEach(w => { try { w.close(); } catch {} });
    this.watchers = [];

    // intent 최종 리포트
    if (this.intentContext && this.intentContext.changedFiles.length > 0) {
      logger.always(`\n${C.CYAN}${'─'.repeat(52)}${C.RESET}`);
      logger.always(`${C.BOLD}  Intent Summary${C.RESET}`);
      logger.always(`  Intent  : "${this.intentContext.intent}"`);
      logger.always(`  Changed : ${this.intentContext.changedFiles.length} files`);
      this.intentContext.changedFiles.forEach(f => {
        logger.always(`  ${C.GRAY}→ ${f}${C.RESET}`);
      });
      logger.always(`${C.CYAN}${'─'.repeat(52)}${C.RESET}\n`);

      storage.append(this.cwd, 'history', {
        step:   this.intentContext.intent,
        source: 'ai',
        files:  this.intentContext.changedFiles,
        risk:   'tracked',
      });
    }

    logger.ok('watcher: stopped');
  }
}

module.exports = Watcher;
