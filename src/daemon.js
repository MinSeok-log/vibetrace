'use strict';

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const { execSync, spawn } = require('child_process');
const logger  = require('./logger');

/**
 * Daemon — vibetrace watch --daemon
 * 백그라운드에서 계속 실행
 * 파일 바뀔 때마다 자동 diff + risk 기록
 * 별도 터미널 필요 없음
 */

const DAEMON_PID_FILE = path.join(os.homedir(), '.vibetrace', 'daemon.pid');
const DAEMON_LOG_FILE = path.join(os.homedir(), '.vibetrace', 'daemon.log');

function isDaemonRunning() {
  try {
    if (!fs.existsSync(DAEMON_PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim());
    process.kill(pid, 0); // 프로세스 존재 여부 확인
    return pid;
  } catch {
    return false;
  }
}

function startDaemon(cwd = process.cwd()) {
  const running = isDaemonRunning();
  if (running) {
    logger.info(`daemon: already running (PID ${running})`);
    return;
  }

  // 데몬 디렉토리 생성
  const daemonDir = path.join(os.homedir(), '.vibetrace');
  if (!fs.existsSync(daemonDir)) fs.mkdirSync(daemonDir, { recursive: true });

  // 백그라운드 프로세스 시작
  const child = spawn(process.execPath, [
    path.join(__dirname, '..', 'bin', 'vibetrace.js'),
    'watch',
    '--daemon-worker',
  ], {
    cwd,
    detached: true,
    stdio: ['ignore', fs.openSync(DAEMON_LOG_FILE, 'a'), fs.openSync(DAEMON_LOG_FILE, 'a')],
    env: { ...process.env, VIBETRACE_CWD: cwd },
  });

  child.unref();
  fs.writeFileSync(DAEMON_PID_FILE, String(child.pid));

  logger.ok(`daemon: started (PID ${child.pid})`);
  logger.info(`daemon: watching ${cwd}`);
  logger.info(`daemon: log → ${DAEMON_LOG_FILE}`);
  logger.info('daemon: stop with "vibetrace daemon stop"');
}

function stopDaemon() {
  const pid = isDaemonRunning();
  if (!pid) {
    logger.info('daemon: not running');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    fs.unlinkSync(DAEMON_PID_FILE);
    logger.ok(`daemon: stopped (PID ${pid})`);
  } catch (e) {
    logger.warn(`daemon: failed to stop — ${e.message}`);
  }
}

function daemonStatus() {
  const pid = isDaemonRunning();
  const C   = logger.C;
  if (pid) {
    logger.always(`  ${C.GREEN}● daemon running${C.RESET}  PID ${pid}`);
    logger.always(`  ${C.GRAY}log: ${DAEMON_LOG_FILE}${C.RESET}`);
  } else {
    logger.always(`  ${C.GRAY}○ daemon not running${C.RESET}`);
    logger.always(`  ${C.GRAY}start: vibetrace daemon start${C.RESET}`);
  }
}

module.exports = { startDaemon, stopDaemon, daemonStatus, isDaemonRunning };
