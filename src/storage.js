'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

/**
 * Storage — vibetrace 데이터 저장
 * ~/.vibetrace/ 에 프로젝트별 데이터 저장
 */

const BASE_DIR = path.join(os.homedir(), '.vibetrace');

function _projectKey(cwd) {
  return Buffer.from(cwd).toString('base64').replace(/[/+=]/g, '_').slice(0, 32);
}

function _projectDir(cwd) {
  const dir = path.join(BASE_DIR, _projectKey(cwd));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function save(cwd, key, data) {
  try {
    const file = path.join(_projectDir(cwd), key + '.json');
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {}
}

function load(cwd, key) {
  try {
    const file = path.join(_projectDir(cwd), key + '.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {}
  return null;
}

function append(cwd, key, entry) {
  const existing = load(cwd, key) || [];
  existing.push({ ...entry, at: new Date().toISOString() });
  save(cwd, key, existing);
}

module.exports = { save, load, append };
