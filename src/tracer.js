'use strict';

const Module = require('module');
const path   = require('path');
const os     = require('os');
const logger  = require('./logger');
const storage = require('./storage');

/**
 * Tracer — Runtime Analysis
 *
 * 1. 실행 호출 트리 (Execution Trace)
 * 2. 모듈 로드 추적 (Module Load Trace)
 * 3. 의존성 호출 트리 (Dependency Call Graph)
 * 4. 실행된 패키지 목록
 * 5. 실행 환경 스냅샷
 */

const C = require('./logger').C;

class Tracer {
  constructor(cwd = process.cwd()) {
    this.cwd         = cwd;
    this.loadedModules = [];          // 로드된 모듈 순서대로
    this.callGraph   = {};            // pkg → [deps]
    this.execTree    = [];            // 실행 호출 트리
    this._origLoad   = null;
    this._startTime  = null;
    this._active     = false;
  }

  // ── 추적 시작 ──────────────────────────────────────────
  start() {
    if (this._active) return;
    this._active   = true;
    this._startTime = Date.now();
    this._patchModuleLoad();
    logger.ok('tracer: Runtime tracking started');
  }

  stop() {
    if (!this._active) return;
    this._active = false;
    this._restoreModuleLoad();
    logger.ok(`tracer: stopped (${Date.now() - this._startTime}ms)`);
  }

  // ── Module._load 패치 ──────────────────────────────────
  _patchModuleLoad() {
    const self = this;
    this._origLoad = Module._load;

    Module._load = function(request, parent, isMain) {
      const result = self._origLoad.call(this, request, parent, isMain);

      try {
        const callerPkg = self._extractPkg(parent?.filename || '');
        const isBuiltin = Module.builtinModules.includes(request);
        const isRelative = request.startsWith('.') || request.startsWith('/');

        if (!isBuiltin && !isRelative) {
          // 로드된 패키지 기록
          if (!self.loadedModules.find(m => m.name === request)) {
            let version = '?';
            try {
              const pkgName = request.startsWith('@')
                ? request.split('/').slice(0, 2).join('/')
                : request.split('/')[0];
              const pkgJsonPath = path.join(self.cwd, 'node_modules', pkgName, 'package.json');
              if (require('fs').existsSync(pkgJsonPath)) {
                version = JSON.parse(require('fs').readFileSync(pkgJsonPath, 'utf-8')).version || '?';
              }
            } catch {}

            self.loadedModules.push({
              name:    request,
              version,
              loadedAt: Date.now() - self._startTime,
            });

            // 호출 그래프
            if (callerPkg && callerPkg !== request) {
              if (!self.callGraph[callerPkg]) self.callGraph[callerPkg] = [];
              if (!self.callGraph[callerPkg].includes(request)) {
                self.callGraph[callerPkg].push(request);
              }
            }
          }
        }
      } catch {}

      return result;
    };
  }

  _restoreModuleLoad() {
    if (this._origLoad) Module._load = this._origLoad;
  }

  _extractPkg(filePath) {
    if (!filePath) return null;
    const match = filePath.match(/node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)/);
    return match ? match[1] : null;
  }

  // ── 스냅샷 ──────────────────────────────────────────────
  snapshot() {
    return {
      node:    process.version,
      os:      process.platform,
      arch:    process.arch,
      cwd:     this.cwd,
      command: process.argv.slice(2).join(' '),
      time:    new Date().toISOString(),
    };
  }

  // ── 출력 ────────────────────────────────────────────────
  printLoadedModules() {
    const W = 56;
    logger.always(`\n${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Module Load Trace${C.RESET}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`  ${C.BOLD}${'Package'.padEnd(30)}${'Version'.padEnd(12)}${'Load (ms)'}${C.RESET}`);
    logger.always(`${C.CYAN}${'─'.repeat(W)}${C.RESET}`);

    this.loadedModules.forEach(m => {
      logger.always(
        `  ${C.GRAY}${m.name.slice(0,29).padEnd(30)}${C.RESET}` +
        `${(m.version).padEnd(12)}` +
        `${C.GRAY}+${m.loadedAt}ms${C.RESET}`
      );
    });
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`  Total loaded: ${C.GREEN}${this.loadedModules.length}${C.RESET} packages\n`);
  }

  printCallGraph() {
    const W = 56;
    logger.always(`\n${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Dependency Call Graph${C.RESET}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}`);

    const entries = Object.entries(this.callGraph);
    if (entries.length === 0) {
      logger.always(`  ${C.GRAY}No dependency calls recorded${C.RESET}`);
    } else {
      entries.forEach(([pkg, deps]) => {
        logger.always(`  ${C.CYAN}${pkg}${C.RESET}`);
        deps.forEach((dep, i) => {
          const isLast = i === deps.length - 1;
          logger.always(`  ${C.GRAY}${isLast ? '└' : '├'} ${dep}${C.RESET}`);
        });
      });
    }
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}\n`);
  }

  printSnapshot() {
    const snap = this.snapshot();
    const W = 56;
    logger.always(`\n${C.CYAN}${'═'.repeat(W)}${C.RESET}`);
    logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Environment Snapshot${C.RESET}`);
    logger.always(`${C.CYAN}${'─'.repeat(W)}${C.RESET}`);
    logger.always(`  node     ${snap.node}`);
    logger.always(`  os       ${snap.os} (${snap.arch})`);
    logger.always(`  cwd      ${snap.cwd}`);
    logger.always(`  command  ${snap.command || '—'}`);
    logger.always(`  time     ${snap.time}`);
    logger.always(`${C.CYAN}${'═'.repeat(W)}${C.RESET}\n`);
  }

  // ── 저장 + JSON ─────────────────────────────────────────
  save() {
    const data = {
      snapshot:      this.snapshot(),
      loadedModules: this.loadedModules,
      callGraph:     this.callGraph,
    };
    storage.save(this.cwd, 'trace', data);
    return data;
  }
}

module.exports = Tracer;
