'use strict';

const fs      = require('fs');
const path    = require('path');
const logger  = require('./logger');
const storage = require('./storage');

/**
 * Evaluator — Code Evaluation
 *
 * 1. API 구현 완성도
 * 2. 코드 구조 점수 (복잡도, 함수 길이, 순환 의존성)
 * 3. 의존성 건강도 (used / partially used / unused)
 * 4. 실행 안정성 (unhandled promise, null access 등)
 * 5. 테스트 커버리지
 * 6. 최종 점수 (completeness / stability / AI confidence)
 */

const C = require('./logger').C;

// ── 위험 패턴 ────────────────────────────────────────────
const STABILITY_PATTERNS = [
  { pattern: /\.then\s*\([^)]*\)\s*(?!\.catch)/,  label: 'unhandled promise',    penalty: 10 },
  { pattern: /\w+\.\w+\.\w+(?!\?)/,               label: 'possible null access', penalty: 8  },
  { pattern: /console\.log\s*\(/,                 label: 'debug log left',       penalty: 3  },
  { pattern: /TODO|FIXME|HACK|XXX/,               label: 'unfinished code',      penalty: 5  },
  { pattern: /catch\s*\(\w*\)\s*\{\s*\}/,         label: 'empty catch block',    penalty: 8  },
  { pattern: /any\b/,                             label: 'TypeScript any usage', penalty: 5  },
];

class Evaluator {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }

  // ── 전체 평가 실행 ──────────────────────────────────────
  async evaluate() {
    const srcDir  = path.join(this.cwd, 'src');
    const files   = fs.existsSync(srcDir)
      ? this._getFiles(srcDir)
      : this._getFiles(this.cwd, 1);

    if (files.length === 0) {
      logger.warn('evaluator: no source files found');
      return null;
    }

    const scores = {
      api:         this._evalAPI(files),
      architecture: this._evalArchitecture(files),
      dependencies: this._evalDependencies(),
      stability:   this._evalStability(files),
      tests:       this._evalTests(),
    };

    // 최종 3축 점수
    const completeness = Math.round((scores.api.score + scores.architecture.score) / 2);
    const stability    = Math.round((scores.stability.score + scores.tests.score) / 2);
    const confidence   = Math.round((completeness * 0.4 + stability * 0.4 + scores.dependencies.score * 0.2));

    const result = { scores, completeness, stability, confidence };
    storage.save(this.cwd, 'evaluation', result);
    return result;
  }

  // ── 1. API 완성도 ─────────────────────────────────────
  _evalAPI(files) {
    const defined = [];
    const implemented = [];

    files.forEach(f => {
      const content = fs.readFileSync(f, 'utf-8');

      // router/controller 정의 탐지
      const routeMatches = content.matchAll(/(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)/g);
      for (const m of routeMatches) defined.push(`${m[1].toUpperCase()} ${m[2]}`);

      // 함수 구현 탐지
      const fnMatches = content.matchAll(/(?:async\s+)?function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(/g);
      for (const m of fnMatches) implemented.push(m[1] || m[2]);
    });

    const score = defined.length > 0
      ? Math.min(100, Math.round((implemented.length / Math.max(defined.length, 1)) * 100))
      : 75; // 정의된 API 없으면 기본값

    return { score, defined, implemented: implemented.slice(0, 10) };
  }

  // ── 2. 코드 구조 점수 ────────────────────────────────────
  _evalArchitecture(files) {
    let score = 100;
    const issues = [];

    let totalFns = 0, largeFns = 0;
    let complexity = 0;
    const imports = {};
    let circularRisk = 0;

    files.forEach(f => {
      const content = fs.readFileSync(f, 'utf-8');
      const lines   = content.split('\n');

      // 함수 길이 체크
      let inFn = false, fnStart = 0, depth = 0;
      lines.forEach((line, i) => {
        if (/(?:function\s+\w+|=>\s*\{|\bfunction\b)/.test(line)) {
          inFn = true; fnStart = i; depth = 0;
        }
        if (inFn) {
          depth += (line.match(/\{/g) || []).length;
          depth -= (line.match(/\}/g) || []).length;
          if (depth <= 0 && i > fnStart) {
            totalFns++;
            if (i - fnStart > 50) { largeFns++; score -= 3; issues.push(`large function at ${path.relative(this.cwd, f)}:${fnStart + 1}`); }
            inFn = false;
          }
        }

        // 순환 복잡도 (if/else/for/while/switch/&&/||)
        complexity += (line.match(/\b(if|else|for|while|switch|&&|\|\|)\b/g) || []).length;
      });

      // import/require 수집
      const reqMatches = content.matchAll(/require\s*\(\s*['"`](\.\.?\/[^'"`]+)/g);
      for (const m of reqMatches) {
        if (!imports[f]) imports[f] = [];
        imports[f].push(m[1]);
      }
    });

    // 순환 복잡도 패널티
    const avgComplexity = files.length ? Math.round(complexity / files.length) : 0;
    if (avgComplexity > 15) { score -= 15; issues.push(`high cyclomatic complexity: ${avgComplexity}`); }
    else if (avgComplexity > 10) { score -= 8; issues.push(`medium complexity: ${avgComplexity}`); }

    score = Math.max(0, score);
    return { score, issues: issues.slice(0, 5), avgComplexity, largeFunctions: largeFns, totalFunctions: totalFns };
  }

  // ── 3. 의존성 건강도 ─────────────────────────────────────
  _evalDependencies() {
    const pkgPath = path.join(this.cwd, 'package.json');
    if (!fs.existsSync(pkgPath)) return { score: 100, packages: [] };

    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); }
    catch { return { score: 100, packages: [] }; }

    const deps = Object.keys(pkg.dependencies || {});
    if (deps.length === 0) return { score: 100, packages: [] };

    // 소스 파일에서 실제 사용 여부 확인
    const srcDir = path.join(this.cwd, 'src');
    const files  = fs.existsSync(srcDir) ? this._getFiles(srcDir) : [];
    const allContent = files.map(f => {
      try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; }
    }).join('\n');

    const packages = deps.map(dep => {
      const shortName = dep.replace('@', '').replace('/', '-');
      const usageCount = (allContent.match(new RegExp(dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

      let status;
      if (usageCount === 0)       status = 'unused';
      else if (usageCount <= 2)   status = 'partially used';
      else                        status = 'used';

      return { name: dep, status, usageCount };
    });

    const unused    = packages.filter(p => p.status === 'unused').length;
    const partial   = packages.filter(p => p.status === 'partially used').length;
    const score     = Math.max(0, 100 - (unused * 8) - (partial * 3));

    return { score, packages, unused, partial };
  }

  // ── 4. 실행 안정성 ──────────────────────────────────────
  _evalStability(files) {
    let score = 100;
    const issues = [];

    files.forEach(f => {
      const content = fs.readFileSync(f, 'utf-8');
      STABILITY_PATTERNS.forEach(({ pattern, label, penalty }) => {
        const matches = content.match(new RegExp(pattern.source, 'g'));
        if (matches) {
          const p = Math.min(penalty * matches.length, 20);
          score -= p;
          issues.push({ label, count: matches.length, file: path.relative(this.cwd, f) });
        }
      });
    });

    score = Math.max(0, score);
    return { score, issues: issues.slice(0, 8) };
  }

  // ── 5. 테스트 커버리지 ────────────────────────────────────
  _evalTests() {
    const testDirs  = ['test', 'tests', '__tests__', 'spec'].map(d => path.join(this.cwd, d));
    const testFiles = testDirs.flatMap(d => fs.existsSync(d) ? this._getFiles(d) : []);

    const srcDir   = path.join(this.cwd, 'src');
    const srcFiles = fs.existsSync(srcDir) ? this._getFiles(srcDir) : [];

    if (srcFiles.length === 0) return { score: 0, testFiles: 0, srcFiles: 0 };

    const ratio = testFiles.length / srcFiles.length;
    const score = Math.min(100, Math.round(ratio * 100));

    return { score, testFiles: testFiles.length, srcFiles: srcFiles.length };
  }

  // ── 출력 ────────────────────────────────────────────────
  print(result) {
    if (!result) return;
    const W = 56;
    const { scores, completeness, stability, confidence } = result;

    logger.always(`\n${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Project Score${C.RESET}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}`);

    // 세부 점수
    logger.always(`\n  ${C.BOLD}Detail scores:${C.RESET}`);
    this._bar('API completeness',    scores.api.score);
    this._bar('Architecture',        scores.architecture.score);
    this._bar('Dependency health',   scores.dependencies.score);
    this._bar('Runtime stability',   scores.stability.score);
    this._bar('Test coverage',       scores.tests.score);

    // API 현황
    if (scores.api.implemented.length > 0) {
      logger.always(`\n  ${C.BOLD}Implemented functions (sample):${C.RESET}`);
      scores.api.implemented.slice(0, 5).forEach(fn => {
        logger.always(`  ${C.GREEN}✓${C.RESET} ${fn}`);
      });
    }

    // 의존성 상태
    if (scores.dependencies.packages?.length > 0) {
      logger.always(`\n  ${C.BOLD}Dependency health:${C.RESET}`);
      scores.dependencies.packages.slice(0, 8).forEach(p => {
        const color = p.status === 'unused' ? C.RED : p.status === 'partially used' ? C.YELLOW : C.GREEN;
        logger.always(`  ${color}${p.status.padEnd(16)}${C.RESET} ${p.name}`);
      });
    }

    // 안정성 이슈
    if (scores.stability.issues?.length > 0) {
      logger.always(`\n  ${C.BOLD}Stability issues:${C.RESET}`);
      scores.stability.issues.slice(0, 5).forEach(i => {
        logger.always(`  ${C.YELLOW}⚠  ${i.label} (${i.count}x)${C.RESET}  ${C.GRAY}${i.file}${C.RESET}`);
      });
    }

    // 최종 3축
    logger.always(`\n${C.CYAN}${'─'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}  Final Score:${C.RESET}`);
    this._bar('completeness  ', completeness);
    this._bar('stability     ', stability);
    this._bar('AI confidence ', confidence);

    // 총점
    const overall = Math.round((completeness + stability + confidence) / 3);
    const overallColor = overall >= 80 ? C.GREEN : overall >= 60 ? C.YELLOW : C.RED;
    logger.always(`\n  ${C.BOLD}Overall project health: ${overallColor}${overall}%${C.RESET}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}\n`);
  }

  _bar(label, score) {
    const filled = Math.round(score / 5);
    const bar    = '█'.repeat(filled) + '░'.repeat(20 - filled);
    const color  = score >= 80 ? C.GREEN : score >= 60 ? C.YELLOW : C.RED;
    logger.always(`  ${label.slice(0, 14).padEnd(14)}  ${color}${bar}${C.RESET}  ${score}%`);
  }

  _getFiles(dir, maxDepth = 4, result = [], depth = 0) {
    if (depth > maxDepth) return result;
    try {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && !['node_modules', '.git', 'dist', 'build'].includes(e.name)) {
          this._getFiles(full, maxDepth, result, depth + 1);
        } else if (e.isFile() && /\.(js|ts|jsx|tsx)$/.test(e.name)) {
          result.push(full);
        }
      });
    } catch {}
    return result;
  }
}

module.exports = Evaluator;
