'use strict';

const fs      = require('fs');
const path    = require('path');
const logger  = require('./logger');
const storage = require('./storage');

/**
 * DiffTracker — AI Diff Tracker
 *
 * 1. AI 수정 내역 (몇 번째 줄, 무엇이 바뀜)
 * 2. 변경 영향 범위 (Impact Analysis)
 * 3. AI change risk 점수
 * 4. 위험 수정 표시
 */

const C = require('./logger').C;

// 핵심 모듈 — 수정 시 HIGH 위험
const CRITICAL_PATTERNS = [
  { pattern: /auth|login|token|jwt|session|password|secret/i, label: 'authentication' },
  { pattern: /payment|billing|stripe|invoice|charge/i,        label: 'payment' },
  { pattern: /database|db|query|sql|mongo|redis/i,            label: 'database' },
  { pattern: /middleware|router|route|cors|helmet/i,          label: 'middleware' },
  { pattern: /config|env|\.env|secret|key/i,                  label: 'configuration' },
  { pattern: /crypto|hash|encrypt|decrypt|sign/i,             label: 'cryptography' },
];

// 변경 타입 분류
const CHANGE_TYPES = [
  { pattern: /\?\./,                          label: 'null safety fix' },
  { pattern: /try\s*{|catch\s*\(/,            label: 'error handling added' },
  { pattern: /async|await|Promise/,           label: 'async change' },
  { pattern: /import|require/,               label: 'dependency change' },
  { pattern: /console\.(log|error|warn)/,    label: 'logging added' },
  { pattern: /\/\/|\/\*/,                    label: 'comment added' },
];

class DiffTracker {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }

  // ── diff 분석 ──────────────────────────────────────────
  analyze(filePath, beforeContent, afterContent) {
    const before = (beforeContent || '').split('\n');
    const after  = (afterContent  || '').split('\n');
    const changes = [];

    const maxLen = Math.max(before.length, after.length);
    for (let i = 0; i < maxLen; i++) {
      const b = before[i] ?? null;
      const a = after[i]  ?? null;

      if (b === a) continue;

      if (b === null) {
        changes.push({ line: i + 1, type: 'added',   before: null, after: a });
      } else if (a === null) {
        changes.push({ line: i + 1, type: 'removed', before: b,    after: null });
      } else {
        changes.push({ line: i + 1, type: 'modified', before: b,   after: a });
      }
    }

    // 변경 타입 분류
    const changeTypes = new Set();
    changes.forEach(c => {
      const line = c.after || c.before || '';
      CHANGE_TYPES.forEach(ct => {
        if (ct.pattern.test(line)) changeTypes.add(ct.label);
      });
    });

    // 영향 범위 분석
    const impact = this._analyzeImpact(filePath, afterContent || '');

    // 위험도 계산
    const risk = this._calcRisk(filePath, changes, impact);

    const result = {
      file:        path.relative(this.cwd, filePath),
      changedLines: changes.length,
      changes,
      changeTypes:  [...changeTypes],
      impact,
      risk,
    };

    // 히스토리 저장
    storage.append(this.cwd, 'diff-history', {
      file:         result.file,
      changedLines: result.changedLines,
      changeTypes:  result.changeTypes,
      risk:         result.risk.level,
    });

    return result;
  }

  // ── 영향 범위 분석 ─────────────────────────────────────
  _analyzeImpact(filePath, content) {
    const affectedModules = [];

    // 이 파일을 require/import 하는 다른 파일 찾기
    const relPath = path.relative(this.cwd, filePath);
    const srcDir  = path.join(this.cwd, 'src');

    try {
      if (fs.existsSync(srcDir)) {
        this._findFiles(srcDir).forEach(f => {
          const fc = fs.readFileSync(f, 'utf-8');
          const name = path.basename(filePath, path.extname(filePath));
          if (fc.includes(name) && f !== filePath) {
            affectedModules.push(path.relative(this.cwd, f));
          }
        });
      }
    } catch {}

    // 핵심 경로 탐지
    const criticalPath = [];
    CRITICAL_PATTERNS.forEach(cp => {
      if (cp.pattern.test(relPath) || cp.pattern.test(content)) {
        criticalPath.push(cp.label);
      }
    });

    return { affectedModules, criticalPath };
  }

  // ── 위험도 계산 ────────────────────────────────────────
  _calcRisk(filePath, changes, impact) {
    let score = 0;
    const reasons = [];

    // 변경 줄 수
    if (changes.length > 50) { score += 3; reasons.push(`${changes.length} lines changed`); }
    else if (changes.length > 20) { score += 2; reasons.push(`${changes.length} lines changed`); }
    else if (changes.length > 5)  { score += 1; }

    // 영향 모듈 수
    if (impact.affectedModules.length > 5) { score += 3; reasons.push(`${impact.affectedModules.length} modules affected`); }
    else if (impact.affectedModules.length > 2) { score += 2; reasons.push(`${impact.affectedModules.length} modules affected`); }
    else if (impact.affectedModules.length > 0) { score += 1; }

    // 핵심 경로
    if (impact.criticalPath.length > 0) {
      score += 3;
      reasons.push(`critical path: ${impact.criticalPath.join(', ')}`);
    }

    const level = score >= 6 ? 'HIGH' : score >= 3 ? 'MED' : 'LOW';
    const color = level === 'HIGH' ? C.RED : level === 'MED' ? C.YELLOW : C.GREEN;

    return { score, level, color, reasons };
  }

  _findFiles(dir, result = [], depth = 0) {
    if (depth > 3) return result;
    try {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== 'node_modules') this._findFiles(full, result, depth + 1);
        else if (e.isFile() && /\.(js|ts|jsx|tsx)$/.test(e.name)) result.push(full);
      });
    } catch {}
    return result;
  }

  // ── 출력 ────────────────────────────────────────────────
  printDiff(result) {
    const W = 60;
    const { risk, impact } = result;

    logger.always(`\n${risk.color}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}${risk.color}  vibetrace — AI Diff Analysis${C.RESET}`);
    logger.always(`${risk.color}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`  ${C.BOLD}File:${C.RESET}          ${result.file}`);
    logger.always(`  ${C.BOLD}Changed lines:${C.RESET} ${result.changedLines}`);

    if (result.changeTypes.length > 0) {
      logger.always(`  ${C.BOLD}Change type:${C.RESET}   ${result.changeTypes.join(', ')}`);
    }

    // 변경 내용 (최대 10줄)
    logger.always(`\n${C.GRAY}${'─'.repeat(W)}${C.RESET}`);
    result.changes.slice(0, 10).forEach(c => {
      if (c.type === 'added') {
        logger.always(`  ${C.GREEN}+ [${c.line}]${C.RESET} ${(c.after || '').trim()}`);
      } else if (c.type === 'removed') {
        logger.always(`  ${C.RED}- [${c.line}]${C.RESET} ${(c.before || '').trim()}`);
      } else {
        logger.always(`  ${C.YELLOW}~ [${c.line}]${C.RESET} ${(c.before || '').trim()}`);
        logger.always(`  ${C.GREEN}  [${c.line}]${C.RESET} ${(c.after  || '').trim()}`);
      }
    });
    if (result.changes.length > 10) {
      logger.always(`  ${C.GRAY}... and ${result.changes.length - 10} more changes${C.RESET}`);
    }

    // 영향 범위
    if (impact.affectedModules.length > 0) {
      logger.always(`\n${C.BOLD}  Impact:${C.RESET}`);
      impact.affectedModules.slice(0, 5).forEach(m => {
        logger.always(`  ${C.GRAY}→ ${m}${C.RESET}`);
      });
    }

    // 위험도
    logger.always(`\n${risk.color}${'─'.repeat(W)}${C.RESET}`);
    logger.always(`  ${C.BOLD}AI Change Risk: ${risk.color}${risk.level}${C.RESET}`);
    if (risk.reasons.length > 0) {
      risk.reasons.forEach(r => logger.always(`  ${C.GRAY}· ${r}${C.RESET}`));
    }

    if (risk.level === 'HIGH') {
      logger.always(`\n  ${C.RED}${C.BOLD}⚠  AI modified critical module — recommend review${C.RESET}`);
    }

    logger.always(`${risk.color}${'═'.repeat(W)}${C.RESET}\n`);
  }
}

module.exports = DiffTracker;
