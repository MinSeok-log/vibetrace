'use strict';

const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');
const logger  = require('./logger');
const storage = require('./storage');

/**
 * Hotspot — vibetrace hotspot
 * 자주 바뀌는 파일 + 의존성 많은 파일 + 위험 패턴 많은 파일
 * AI가 먼저 검토해야 할 파일 순위 제공
 */

const C = require('./logger').C;

const CRITICAL_PATTERNS = [
  { pattern: /auth|login|token|jwt|session|password/i, label: 'authentication' },
  { pattern: /payment|billing|stripe|charge/i,         label: 'payment' },
  { pattern: /database|db|query|sql|mongo/i,           label: 'database' },
  { pattern: /middleware|router|route|cors/i,          label: 'middleware' },
  { pattern: /config|env|secret|key/i,                 label: 'configuration' },
];

const STABILITY_PATTERNS = [
  /\.then\s*\([^)]*\)\s*(?!\.catch)/,
  /\w+\.\w+\.\w+(?!\?)/,
  /catch\s*\(\w*\)\s*\{\s*\}/,
];

class Hotspot {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }

  async analyze() {
    const srcDir = path.join(this.cwd, 'src');
    const files  = fs.existsSync(srcDir)
      ? this._getFiles(srcDir)
      : this._getFiles(this.cwd, 2);

    if (files.length === 0) {
      logger.warn('hotspot: no source files found');
      return [];
    }

    // git 변경 횟수
    const gitChanges = {};
    try {
      const log = execSync('git log --name-only --format="" --diff-filter=M', {
        cwd: this.cwd, encoding: 'utf-8', timeout: 10000
      });
      log.split('\n').filter(Boolean).forEach(f => {
        gitChanges[f] = (gitChanges[f] || 0) + 1;
      });
    } catch {}

    // 파일별 점수 계산
    const hotspots = files.map(f => {
      const rel     = path.relative(this.cwd, f);
      let score     = 0;
      const reasons = [];

      // git 변경 횟수
      const changes = gitChanges[rel] || gitChanges[rel.replace(/\\/g, '/')] || 0;
      if (changes > 20) { score += 4; reasons.push(`changed ${changes}x`); }
      else if (changes > 10) { score += 2; reasons.push(`changed ${changes}x`); }
      else if (changes > 0)  { score += 1; }

      let content = '';
      try { content = fs.readFileSync(f, 'utf-8'); } catch { return null; }

      // 핵심 경로 탐지
      const criticals = CRITICAL_PATTERNS.filter(cp =>
        cp.pattern.test(rel) || cp.pattern.test(content)
      );
      if (criticals.length > 0) {
        score += criticals.length * 2;
        reasons.push(criticals.map(c => c.label).join(', '));
      }

      // 안정성 이슈
      let issueCount = 0;
      STABILITY_PATTERNS.forEach(p => {
        const matches = content.match(new RegExp(p.source, 'g'));
        if (matches) issueCount += matches.length;
      });
      if (issueCount > 5) { score += 3; reasons.push(`${issueCount} stability issues`); }
      else if (issueCount > 0) { score += 1; }

      // 의존성 수 (다른 파일이 이 파일을 얼마나 import하는지)
      let depCount = 0;
      const basename = path.basename(f, path.extname(f));
      files.forEach(other => {
        if (other === f) return;
        try {
          const oc = fs.readFileSync(other, 'utf-8');
          if (oc.includes(basename)) depCount++;
        } catch {}
      });
      if (depCount > 10) { score += 3; }
      else if (depCount > 5) { score += 2; }
      else if (depCount > 0) { score += 1; }

      const lines = content.split('\n').length;
      const risk  = score >= 8 ? 'HIGH' : score >= 4 ? 'MED' : 'LOW';

      return { file: rel, score, risk, changes, depCount, lines, reasons };
    }).filter(Boolean);

    hotspots.sort((a, b) => b.score - a.score);
    const top = hotspots.slice(0, 10);
    storage.save(this.cwd, 'hotspot', top);
    return top;
  }

  print(hotspots) {
    if (!hotspots || hotspots.length === 0) {
      logger.info('hotspot: no data');
      return;
    }

    const W   = 70;
    const col1 = 36, col2 = 10, col3 = 8, col4 = 8;

    logger.always(`\n${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Hotspot Analysis${C.RESET}`);
    logger.always(`${C.GRAY}  Files AI should review first before modifying${C.RESET}`);
    logger.always(`${C.CYAN}${'─'.repeat(W)}${C.RESET}`);
    logger.always(
      `  ${C.BOLD}${'File'.padEnd(col1)}${'Changes'.padEnd(col2)}${'Deps'.padEnd(col3)}${'Risk'.padEnd(col4)}${C.RESET}`
    );
    logger.always(`${C.CYAN}${'─'.repeat(W)}${C.RESET}`);

    hotspots.forEach(h => {
      const riskColor = h.risk === 'HIGH' ? C.RED : h.risk === 'MED' ? C.YELLOW : C.GREEN;
      logger.always(
        `  ${C.GRAY}${h.file.slice(0, col1-1).padEnd(col1)}${C.RESET}` +
        `${String(h.changes).padEnd(col2)}` +
        `${String(h.depCount).padEnd(col3)}` +
        `${riskColor}${h.risk.padEnd(col4)}${C.RESET}`
      );
      if (h.reasons.length > 0) {
        logger.always(`  ${C.GRAY}  → ${h.reasons.join(' · ')}${C.RESET}`);
      }
    });

    logger.always(`${C.CYAN}${'─'.repeat(W)}${C.RESET}`);
    const highCount = hotspots.filter(h => h.risk === 'HIGH').length;
    if (highCount > 0) {
      logger.always(`\n  ${C.RED}${C.BOLD}⚠  ${highCount} high-risk file(s) — review before AI modification${C.RESET}`);
    }
    logger.always(`\n  ${C.GRAY}Next: vibetrace watch  (start tracking changes)${C.RESET}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}\n`);
  }

  _getFiles(dir, maxDepth = 4, result = [], depth = 0) {
    if (depth > maxDepth) return result;
    try {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && !['node_modules', '.git', 'dist', 'build', '.next'].includes(e.name)) {
          this._getFiles(full, maxDepth, result, depth + 1);
        } else if (e.isFile() && /\.(js|ts|jsx|tsx)$/.test(e.name)) {
          result.push(full);
        }
      });
    } catch {}
    return result;
  }
}

module.exports = Hotspot;
