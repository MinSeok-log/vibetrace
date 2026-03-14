'use strict';

/**
 * Logger — vibetrace 중앙 로그 시스템
 * dryinstall logger와 동일 구조 (호환성)
 */

const LEVELS = { QUIET: 0, NORMAL: 1, VERBOSE: 2 };
let _level    = LEVELS.NORMAL;
let _jsonMode = false;

const C = {
  RED:    '\x1b[31m', YELLOW: '\x1b[33m', GREEN:  '\x1b[32m',
  CYAN:   '\x1b[36m', GRAY:   '\x1b[90m', BOLD:   '\x1b[1m',
  MAGENTA:'\x1b[35m', BLUE:   '\x1b[34m', RESET:  '\x1b[0m',
};

function setLevel(level) {
  _level = typeof level === 'string' ? (LEVELS[level.toUpperCase()] ?? LEVELS.NORMAL) : level;
}

function setJson(enabled) {
  _jsonMode = enabled;
  if (enabled) _level = LEVELS.QUIET;
}

const block   = (msg) => _out(C.RED,     '✗', msg, true);
const warn    = (msg) => _level >= 1 && _out(C.YELLOW,  '⚠ ', msg);
const info    = (msg) => _level >= 1 && _out(C.CYAN,    '→', msg);
const ok      = (msg) => _level >= 1 && _out(C.GREEN,   '✓', msg);
const verbose = (msg) => _level >= 2 && _out(C.GRAY,    '·', msg);
const always  = (msg) => _jsonMode ? process.stderr.write(msg + '\n') : console.log(msg);
const json    = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

function _out(color, icon, msg, force = false) {
  if (!force && _level < 1) return;
  const line = `${color}[vibetrace] ${icon} ${msg}${C.RESET}`;
  _jsonMode ? process.stderr.write(line + '\n') : console.log(line);
}

module.exports = { LEVELS, setLevel, setJson, block, warn, info, ok, verbose, always, json, C };
