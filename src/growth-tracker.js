'use strict';

const logger  = require('./logger');
const storage = require('./storage');

/**
 * GrowthTracker — Vibe Growth Tracker
 * AI 의존도 추적 + 시간이 지날수록 내 비율 성장 기록
 */

const C = require('./logger').C;

class GrowthTracker {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }

  // ── 기록 ───────────────────────────────────────────────
  recordAI(file, lines) {
    storage.append(this.cwd, 'growth', {
      source: 'ai', file, lines,
      week: this._currentWeek(),
    });
  }

  recordMe(file, lines) {
    storage.append(this.cwd, 'growth', {
      source: 'me', file, lines,
      week: this._currentWeek(),
    });
  }

  _currentWeek() {
    const now  = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    return Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  }

  // ── 분석 ───────────────────────────────────────────────
  analyze() {
    const history = storage.load(this.cwd, 'growth') || [];
    if (history.length === 0) return null;

    // 주간별 집계
    const weeks = {};
    history.forEach(entry => {
      const w = entry.week || 0;
      if (!weeks[w]) weeks[w] = { ai: 0, me: 0 };
      weeks[w][entry.source] += entry.lines || 1;
    });

    // 전체 집계
    const total = { ai: 0, me: 0 };
    history.forEach(e => { total[e.source] += e.lines || 1; });
    const totalLines = total.ai + total.me;
    const aiPct = totalLines ? Math.round((total.ai / totalLines) * 100) : 0;
    const mePct = 100 - aiPct;

    return { weeks, total, aiPct, mePct };
  }

  // ── 출력 ────────────────────────────────────────────────
  print() {
    const data = this.analyze();
    const W = 52;

    logger.always(`\n${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Vibe Growth Tracker${C.RESET}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}`);

    if (!data) {
      logger.always(`  ${C.GRAY}No data yet. Use vibetrace diff to start tracking.${C.RESET}`);
      logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}\n`);
      return;
    }

    // 전체 현황
    const aiBar = '█'.repeat(Math.round(data.aiPct / 5)).padEnd(20, '░');
    const meBar = '█'.repeat(Math.round(data.mePct / 5)).padEnd(20, '░');

    logger.always(`\n  ${C.BOLD}Overall${C.RESET}`);
    logger.always(`  ${C.YELLOW}AI  ${aiBar}  ${data.aiPct}%${C.RESET}`);
    logger.always(`  ${C.GREEN}Me  ${meBar}  ${data.mePct}%${C.RESET}`);

    // 주간별 성장
    const weekEntries = Object.entries(data.weeks).sort((a, b) => a[0] - b[0]);
    if (weekEntries.length > 1) {
      logger.always(`\n  ${C.BOLD}Weekly progress${C.RESET}`);
      weekEntries.slice(-6).forEach(([week, counts], i) => {
        const total = counts.ai + counts.me;
        const aiW   = total ? Math.round((counts.ai / total) * 100) : 0;
        const meW   = 100 - aiW;
        const trend = i === 0 ? '' : meW > (100 - Math.round((weekEntries[i-1][1].ai / (weekEntries[i-1][1].ai + weekEntries[i-1][1].me || 1)) * 100)) ? ` ${C.GREEN}↑${C.RESET}` : '';
        logger.always(`  week ${week}  ${C.YELLOW}AI: ${String(aiW).padStart(3)}%${C.RESET}  ${C.GREEN}me: ${String(meW).padStart(3)}%${C.RESET}${trend}`);
      });
    }

    // 메시지
    logger.always('');
    if (data.mePct >= 50) {
      logger.always(`  ${C.GREEN}${C.BOLD}✓ You're writing more than AI now. Good progress.${C.RESET}`);
    } else if (data.mePct >= 30) {
      logger.always(`  ${C.YELLOW}→ Getting there. Keep reviewing AI changes.${C.RESET}`);
    } else {
      logger.always(`  ${C.GRAY}→ Heavy AI usage. Try understanding each change.${C.RESET}`);
    }

    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}\n`);
  }
}

module.exports = GrowthTracker;
