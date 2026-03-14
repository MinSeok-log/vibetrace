'use strict';

const fs     = require('fs');
const path   = require('path');
const logger = require('./logger');

/**
 * PromptBuilder — AI-Ready Log
 * 오류/상태를 AI가 바로 읽을 수 있는 프롬프트로 변환
 * 사람은 복붙만 하면 됨
 */

const C = require('./logger').C;

class PromptBuilder {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }

  // ── 에러 → 프롬프트 ────────────────────────────────────
  fromError(errorLog, traceData = null, diffData = null) {
    const snap = this._snapshot();
    const lines = [];

    lines.push('I encountered an error in my Node.js project. Please analyze and provide a fix.\n');

    // 환경 정보
    lines.push('## Environment');
    lines.push(`- Node: ${snap.node}`);
    lines.push(`- OS: ${snap.os}`);
    lines.push(`- Command: ${snap.command || 'unknown'}`);
    lines.push('');

    // 에러
    lines.push('## Error');
    lines.push('```');
    lines.push(errorLog.trim().slice(0, 1000));
    lines.push('```');
    lines.push('');

    // 실행 추적 정보
    if (traceData?.loadedModules?.length > 0) {
      lines.push('## Loaded Modules at time of error');
      traceData.loadedModules.slice(0, 10).forEach(m => {
        lines.push(`- ${m.name}@${m.version}`);
      });
      lines.push('');
    }

    // AI diff 정보
    if (diffData) {
      lines.push('## Recent AI Changes');
      lines.push(`- File: ${diffData.file}`);
      lines.push(`- Changed lines: ${diffData.changedLines}`);
      lines.push(`- Change type: ${diffData.changeTypes?.join(', ') || 'unknown'}`);
      lines.push(`- Risk level: ${diffData.risk?.level || 'unknown'}`);
      if (diffData.impact?.affectedModules?.length > 0) {
        lines.push(`- Affected modules: ${diffData.impact.affectedModules.join(', ')}`);
      }
      lines.push('');
    }

    // package.json 의존성
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(this.cwd, 'package.json'), 'utf-8'));
      lines.push('## Dependencies');
      Object.entries(pkg.dependencies || {}).slice(0, 10).forEach(([k, v]) => {
        lines.push(`- ${k}: ${v}`);
      });
      lines.push('');
    } catch {}

    // stack trace 파싱
    const stackLines = errorLog.match(/at .+\(.+\)/g);
    if (stackLines && stackLines.length > 0) {
      lines.push('## Stack Trace');
      stackLines.slice(0, 8).forEach(l => lines.push(`  ${l.trim()}`));
      lines.push('');
    }

    // dependency graph (scan 데이터 있으면)
    const storage = require('./storage');
    const hotspot = storage.load(this.cwd, 'hotspot');
    if (hotspot && hotspot.length > 0) {
      lines.push('## High Risk Files (from vibetrace hotspot)');
      hotspot.slice(0, 5).forEach(h => {
        lines.push(`- ${h.file}  [${h.risk}]  deps: ${h.depCount}`);
      });
      lines.push('');
    }

    lines.push('## Request');
    lines.push('Please identify the root cause and provide the exact fix with file path and line numbers.');

    return lines.join('\n');
  }

  // ── diff → 프롬프트 ────────────────────────────────────
  fromDiff(diffData) {
    const lines = [];

    lines.push('I made the following AI-assisted code changes. Please review for potential issues.\n');
    lines.push(`## Modified File`);
    lines.push(`${diffData.file}\n`);
    lines.push(`## Changes (${diffData.changedLines} lines)`);
    lines.push('```diff');

    diffData.changes.slice(0, 20).forEach(c => {
      if (c.type === 'added')    lines.push(`+ [line ${c.line}] ${c.after}`);
      if (c.type === 'removed')  lines.push(`- [line ${c.line}] ${c.before}`);
      if (c.type === 'modified') {
        lines.push(`- [line ${c.line}] ${c.before}`);
        lines.push(`+ [line ${c.line}] ${c.after}`);
      }
    });

    lines.push('```\n');

    if (diffData.impact?.criticalPath?.length > 0) {
      lines.push(`## ⚠ Critical Path Affected`);
      lines.push(diffData.impact.criticalPath.join(', '));
      lines.push('');
    }

    lines.push(`## Risk Level: ${diffData.risk?.level || 'unknown'}`);
    if (diffData.risk?.reasons?.length > 0) {
      diffData.risk.reasons.forEach(r => lines.push(`- ${r}`));
    }

    lines.push('\n## Request');
    lines.push('Are these changes safe? Will they cause any side effects? If there are issues, provide the corrected code.');

    return lines.join('\n');
  }

  // ── 출력 ────────────────────────────────────────────────
  print(prompt) {
    const W = 60;
    const border = '─'.repeat(W);

    logger.always(`\n${C.CYAN}${border}${C.RESET}`);
    logger.always(`${C.BOLD}${C.CYAN}  vibetrace — AI-Ready Prompt${C.RESET}`);
    logger.always(`${C.GRAY}  Copy and paste this to your AI assistant:${C.RESET}`);
    logger.always(`${C.CYAN}${border}${C.RESET}\n`);
    logger.always(prompt);
    logger.always(`\n${C.CYAN}${border}${C.RESET}\n`);
  }

  _snapshot() {
    return {
      node:    process.version,
      os:      process.platform,
      command: process.argv.slice(2).join(' '),
    };
  }
}

module.exports = PromptBuilder;
