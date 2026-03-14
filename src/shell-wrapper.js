#!/usr/bin/env node
'use strict';

/**
 * Shell Wrapper
 * npm / node 명령어를 vibetrace command-guard를 통해 실행
 *
 * 설치 방법:
 *   vibetrace setup-wrapper
 *   → PATH에 .vibetrace/bin 추가
 *   → npm, node 명령어 자동 인터셉트
 *
 * 또는 package.json scripts에:
 *   "preinstall": "vibetrace guard-check"
 */

const path         = require('path');
const { execSync } = require('child_process');
const CommandGuard = require('./command-guard');
const logger       = require('./logger');

async function runWrapped() {
  const cwd     = process.cwd();
  const wrapper = path.basename(process.argv[1]); // 'npm' or 'node'
  const cmdArgs = process.argv.slice(2).join(' ');
  const fullCmd = `${wrapper} ${cmdArgs}`;

  const guard  = new CommandGuard(cwd);
  const result = guard.evaluate(fullCmd);

  if (result.blocked) {
    logger.block(`Shell wrapper blocked: ${fullCmd}`);
    logger.always(`  reason: ${result.label}`);
    process.exit(1);
  }

  if (result.level === 'MED') {
    logger.warn(`Shell wrapper warning: ${result.label}`);
  }

  // 원본 명령어 실행
  try {
    // 원본 npm/node 경로 찾기 (wrapper 자신 제외)
    const originalPath = execSync(`which -a ${wrapper} | grep -v vibetrace | head -1`, {
      encoding: 'utf-8'
    }).trim();

    const { spawnSync } = require('child_process');
    const result2 = spawnSync(originalPath, process.argv.slice(2), {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
    process.exit(result2.status || 0);
  } catch {
    // fallback
    const { spawnSync } = require('child_process');
    spawnSync(wrapper, process.argv.slice(2), { cwd, stdio: 'inherit', env: process.env });
  }
}

// setup-wrapper 명령어 처리
function setupWrapper(cwd = process.cwd()) {
  const fs   = require('fs');
  const os   = require('os');
  const binDir = path.join(os.homedir(), '.vibetrace', 'bin');

  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

  // npm wrapper
  const npmWrapper = path.join(binDir, 'npm');
  fs.writeFileSync(npmWrapper,
    `#!/usr/bin/env node\nprocess.argv[1] = 'npm';\nrequire('${__filename}');\n`
  );
  fs.chmodSync(npmWrapper, '755');

  logger.ok(`wrapper: created ${npmWrapper}`);
  logger.always(`\n  Add to your shell profile (.bashrc / .zshrc):`);
  logger.always(`  ${logger.C.GREEN}export PATH="${binDir}:$PATH"${logger.C.RESET}`);
  logger.always(`\n  Then restart terminal. npm will be auto-guarded.\n`);
}

module.exports = { setupWrapper };

if (require.main === module) {
  runWrapped().catch(err => {
    logger.block(err.message);
    process.exit(1);
  });
}
