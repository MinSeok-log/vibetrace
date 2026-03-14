'use strict';

const logger  = require('./logger');
const storage = require('./storage');

/**
 * History — 수정 진행 히스토리
 * AI 수정이 누적되면서 프로젝트 변화를 기록
 * "바이브 코딩하면서 내가 어디까지 왔는지" 확인
 */

const C = require('./logger').C;

class History {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }

  // ── 스텝 추가 ──────────────────────────────────────────
  addStep(label, opts = {}) {
    storage.append(this.cwd, 'history', {
      step:    label,
      risk:    opts.risk || 'low',
      source:  opts.source || 'manual',  // 'ai' | 'manual'
      files:   opts.files  || [],
    });
    logger.ok(`history: step recorded — "${label}"`);
  }

  // ── 출력 ────────────────────────────────────────────────
  print() {
    const history = storage.load(this.cwd, 'history') || [];
    const W = 56;

    logger.always(`\n${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Project Evolution${C.RESET}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}`);

    if (history.length === 0) {
      logger.always(`  ${C.GRAY}No history yet.${C.RESET}`);
      logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}\n`);
      return;
    }

    history.forEach((entry, i) => {
      const riskColor = entry.risk === 'HIGH' ? C.RED : entry.risk === 'MED' ? C.YELLOW : C.GREEN;
      const srcLabel  = entry.source === 'ai' ? `${C.YELLOW}AI${C.RESET}` : `${C.GREEN}me${C.RESET}`;
      const date      = new Date(entry.at).toLocaleDateString();

      logger.always(`\n  ${C.BOLD}step ${i + 1}${C.RESET}  ${C.GRAY}${date}${C.RESET}`);
      logger.always(`  ${entry.step}`);

      if (entry.source) logger.always(`  ${C.GRAY}source: ${srcLabel}${C.RESET}`);
      if (entry.risk && entry.risk !== 'low') {
        logger.always(`  ${C.GRAY}risk: ${riskColor}${entry.risk}${C.RESET}`);
      }
      if (entry.files?.length > 0) {
        logger.always(`  ${C.GRAY}files: ${entry.files.join(', ')}${C.RESET}`);
      }
    });

    logger.always(`\n${C.CYAN}${'─'.repeat(W)}${C.RESET}`);
    const aiSteps  = history.filter(h => h.source === 'ai').length;
    const meSteps  = history.filter(h => h.source !== 'ai').length;
    const highRisk = history.filter(h => h.risk === 'HIGH').length;
    logger.always(`  Total steps: ${history.length}  ${C.YELLOW}AI: ${aiSteps}${C.RESET}  ${C.GREEN}me: ${meSteps}${C.RESET}  ${C.RED}high-risk: ${highRisk}${C.RESET}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}\n`);
  }
}

module.exports = History;
