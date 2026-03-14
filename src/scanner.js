'use strict';

const fs      = require('fs');
const path    = require('path');
const logger  = require('./logger');
const storage = require('./storage');

/**
 * Scanner — vibetrace scan
 * 기존 프로젝트 전체 상태 파악 (zero config)
 * 건드리지 않고 현재 상태만 분석
 */

const C = require('./logger').C;

const STABILITY_PATTERNS = [
  { pattern: /\.then\s*\([^)]*\)\s*(?!\.catch)/, label: 'unhandled promise' },
  { pattern: /\w+\.\w+\.\w+(?!\?)/,              label: 'possible null access' },
  { pattern: /console\.log\s*\(/,                label: 'debug log left' },
  { pattern: /TODO|FIXME|HACK/,                  label: 'unfinished code' },
  { pattern: /catch\s*\(\w*\)\s*\{\s*\}/,        label: 'empty catch block' },
];

class Scanner {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }

  async scan() {
    const srcDir  = path.join(this.cwd, 'src');
    const rootDir = this.cwd;
    const files   = fs.existsSync(srcDir)
      ? this._getFiles(srcDir)
      : this._getFiles(rootDir, 2);

    if (files.length === 0) {
      logger.warn('scanner: no source files found');
      return null;
    }

    // 전체 라인 수
    let totalLines = 0;
    files.forEach(f => {
      try { totalLines += fs.readFileSync(f, 'utf-8').split('\n').length; } catch {}
    });

    // 안정성 이슈
    const stabilityIssues = {};
    let issueTotal = 0;
    files.forEach(f => {
      try {
        const content = fs.readFileSync(f, 'utf-8');
        STABILITY_PATTERNS.forEach(({ pattern, label }) => {
          const matches = content.match(new RegExp(pattern.source, 'g'));
          if (matches) {
            stabilityIssues[label] = (stabilityIssues[label] || 0) + matches.length;
            issueTotal += matches.length;
          }
        });
      } catch {}
    });

    // 의존성
    let deps = {}, unusedCount = 0;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(this.cwd, 'package.json'), 'utf-8'));
      deps = { ...pkg.dependencies || {}, ...pkg.devDependencies || {} };
      const allContent = files.map(f => {
        try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; }
      }).join('\n');
      Object.keys(deps).forEach(dep => {
        const used = allContent.includes(dep);
        if (!used) unusedCount++;
      });
    } catch {}

    // 테스트 파일
    const testDirs  = ['test', 'tests', '__tests__', 'spec'].map(d => path.join(this.cwd, d));
    const testFiles = testDirs.flatMap(d => fs.existsSync(d) ? this._getFiles(d) : []);

    // 고위험 파일
    const highRiskFiles = [];
    files.forEach(f => {
      let risk = 0;
      try {
        const content = fs.readFileSync(f, 'utf-8');
        if (/auth|login|token|password/i.test(f))       risk += 3;
        if (/payment|billing|stripe/i.test(f))          risk += 3;
        if (/database|db|query/i.test(f))               risk += 2;
        STABILITY_PATTERNS.forEach(({ pattern }) => {
          if (pattern.test(content)) risk++;
        });
        if (risk >= 3) highRiskFiles.push({ file: path.relative(this.cwd, f), risk });
      } catch {}
    });
    highRiskFiles.sort((a, b) => b.risk - a.risk);

    // 점수 계산
    const stabilityScore = Math.max(0, 100 - issueTotal * 2);
    const testScore      = files.length ? Math.min(100, Math.round((testFiles.length / files.length) * 100)) : 0;
    const depScore       = Object.keys(deps).length
      ? Math.max(0, 100 - (unusedCount / Object.keys(deps).length) * 100)
      : 100;
    const healthScore    = Math.round((stabilityScore + testScore + depScore) / 3);

    const result = {
      files:          files.length,
      totalLines,
      packages:       Object.keys(deps).length,
      testFiles:      testFiles.length,
      healthScore,
      stabilityScore,
      testScore:      Math.round(testScore),
      depScore:       Math.round(depScore),
      unusedDeps:     unusedCount,
      stabilityIssues,
      highRiskFiles:  highRiskFiles.slice(0, 5),
    };

    storage.save(this.cwd, 'scan', result);
    return result;
  }

  print(result) {
    if (!result) return;
    const W = 52;
    const healthColor = result.healthScore >= 80 ? C.GREEN : result.healthScore >= 60 ? C.YELLOW : C.RED;

    logger.always(`\n${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Project Scan${C.RESET}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`  Files scanned   : ${result.files}`);
    logger.always(`  Total lines     : ${result.totalLines.toLocaleString()}`);
    logger.always(`  Packages used   : ${result.packages}`);
    logger.always(`  Test files      : ${result.testFiles}`);
    logger.always('');
    logger.always(`  Code health     : ${healthColor}${result.healthScore}%${C.RESET}`);
    logger.always(`  Stability       : ${result.stabilityScore}%`);
    logger.always(`  Test coverage   : ${result.testScore}%`);
    logger.always(`  Dep health      : ${result.depScore}%`);

    if (Object.keys(result.stabilityIssues).length > 0) {
      logger.always('');
      Object.entries(result.stabilityIssues).forEach(([label, count]) => {
        logger.always(`  ${C.YELLOW}⚠  ${label}: ${count}${C.RESET}`);
      });
    }

    if (result.unusedDeps > 0) {
      logger.always(`  ${C.YELLOW}⚠  Unused dependencies: ${result.unusedDeps}${C.RESET}`);
    }

    if (result.highRiskFiles.length > 0) {
      logger.always(`\n  ${C.BOLD}High risk files:${C.RESET}`);
      result.highRiskFiles.forEach(f => {
        logger.always(`  ${C.RED}→ ${f.file}${C.RESET}`);
      });
    }

    logger.always('');
    logger.always(`  ${C.GRAY}Next: vibetrace hotspot  (find files to review first)${C.RESET}`);
    logger.always(`  ${C.GRAY}      vibetrace watch     (start tracking changes)${C.RESET}`);
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

module.exports = Scanner;
