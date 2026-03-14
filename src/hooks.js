'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Hooks — vibetrace setup-hooks
 * git pre-commit hook 자동 설정
 * npm postinstall 자동 연동
 *
 * 설치 즉시:
 *   → git commit 시 자동 risk 체크
 *   → HIGH면 커밋 차단
 *   → daemon 자동 시작
 */

// pre-commit hook 내용
const PRE_COMMIT_HOOK = `#!/bin/sh
# vibetrace pre-commit hook
# automatically installed by vibetrace setup-hooks

VIBETRACE=$(which vibetrace 2>/dev/null || npx vibetrace 2>/dev/null)

if [ -z "$VIBETRACE" ]; then
  exit 0
fi

# 변경된 JS/TS 파일들 diff + risk 체크
CHANGED=$(git diff --cached --name-only | grep -E '\\.(js|ts|jsx|tsx)$')

if [ -z "$CHANGED" ]; then
  exit 0
fi

echo "[vibetrace] Checking AI change risk..."

HIGH_RISK=0
for FILE in $CHANGED; do
  if [ -f "$FILE" ]; then
    RESULT=$(npx vibetrace diff "$FILE" --json 2>/dev/null)
    RISK=$(echo "$RESULT" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));process.stdout.write(d.risk?.level||'LOW')}catch{process.stdout.write('LOW')}" 2>/dev/null)
    if [ "$RISK" = "HIGH" ]; then
      echo "[vibetrace] ✗ HIGH risk: $FILE"
      HIGH_RISK=1
    elif [ "$RISK" = "MED" ]; then
      echo "[vibetrace] ⚠  MED risk: $FILE"
    else
      echo "[vibetrace] ✓ LOW risk: $FILE"
    fi
  fi
done

if [ "$HIGH_RISK" = "1" ]; then
  echo ""
  echo "[vibetrace] Commit blocked — HIGH risk changes detected."
  echo "[vibetrace] Run 'vibetrace diff <file>' to review changes."
  echo "[vibetrace] To force commit: git commit --no-verify"
  exit 1
fi

exit 0
`;

function setupHooks(cwd = process.cwd()) {
  const gitDir     = path.join(cwd, '.git');
  const hooksDir   = path.join(gitDir, 'hooks');
  const hookPath   = path.join(hooksDir, 'pre-commit');

  if (!fs.existsSync(gitDir)) {
    logger.warn('hooks: .git not found — run "git init" first');
    return false;
  }

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // 기존 hook 백업
  if (fs.existsSync(hookPath)) {
    const backup = hookPath + '.backup';
    fs.copyFileSync(hookPath, backup);
    logger.info(`hooks: existing hook backed up → ${backup}`);
  }

  fs.writeFileSync(hookPath, PRE_COMMIT_HOOK);
  fs.chmodSync(hookPath, '755');

  logger.ok('hooks: pre-commit hook installed');
  logger.info('hooks: git commit will auto-check AI change risk');
  logger.info('hooks: HIGH risk → commit blocked');
  logger.info('hooks: to skip → git commit --no-verify');

  return true;
}

function removeHooks(cwd = process.cwd()) {
  const hookPath = path.join(cwd, '.git', 'hooks', 'pre-commit');
  if (!fs.existsSync(hookPath)) {
    logger.info('hooks: no hook found');
    return;
  }

  // 백업 복원
  const backup = hookPath + '.backup';
  if (fs.existsSync(backup)) {
    fs.copyFileSync(backup, hookPath);
    fs.unlinkSync(backup);
    logger.ok('hooks: original hook restored');
  } else {
    fs.unlinkSync(hookPath);
    logger.ok('hooks: pre-commit hook removed');
  }
}

/**
 * postinstall 자동 실행
 * package.json "postinstall": "vibetrace auto-setup"
 * npm install 하는 순간 hooks + daemon 자동 설정
 */
function autoSetup(cwd = process.cwd()) {
  const C = logger.C;
  logger.always(`\n${C.CYAN}${'─'.repeat(52)}${C.RESET}`);
  logger.always(`${C.BOLD}${C.CYAN}  vibetrace — Auto Setup${C.RESET}`);
  logger.always(`${C.CYAN}${'─'.repeat(52)}${C.RESET}`);

  // git hooks 설정
  const hooksOk = setupHooks(cwd);

  // daemon 시작
  try {
    const { startDaemon } = require('./daemon');
    startDaemon(cwd);
  } catch {}

  if (hooksOk) {
    logger.always(`\n  ${C.GREEN}✓ vibetrace is now active${C.RESET}`);
    logger.always(`  ${C.GRAY}· file changes → auto tracked${C.RESET}`);
    logger.always(`  ${C.GRAY}· git commit   → auto risk check${C.RESET}`);
    logger.always(`  ${C.GRAY}· HIGH risk    → commit blocked${C.RESET}`);
  }
  logger.always(`${C.CYAN}${'─'.repeat(52)}${C.RESET}\n`);
}

module.exports = { setupHooks, removeHooks, autoSetup };
