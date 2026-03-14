'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const DiffTracker   = require('../src/diff-tracker');
const GrowthTracker = require('../src/growth-tracker');
const History       = require('../src/history');
const storage       = require('../src/storage');
const CommandGuard  = require('../src/command-guard');
const Evaluator     = require('../src/evaluator');

/**
 * vibetrace MCP Server
 *
 * AI 에이전트(Claude, Cursor 등)가 직접 호출
 * 수정 전 risk 체크 → HIGH면 에이전트 스스로 멈춤
 *
 * Tools:
 *   analyze_diff    파일 변경 분석 + risk 점수
 *   get_history     프로젝트 수정 히스토리
 *   get_growth      AI 의존도 현황
 *   record_step     히스토리 스텝 추가
 *   should_proceed  risk 기반 진행 여부 판단 (에이전트 브레이크)
 */

const MCP_TOOLS = [
  {
    name: 'analyze_diff',
    description: 'Analyze AI code changes. Returns risk level, impact range, and change details. Use before applying significant changes.',
    inputSchema: {
      type: 'object',
      properties: {
        file:           { type: 'string', description: 'File path to analyze' },
        before_content: { type: 'string', description: 'Original file content' },
        after_content:  { type: 'string', description: 'Modified file content' },
      },
      required: ['file', 'before_content', 'after_content'],
    },
  },
  {
    name: 'should_proceed',
    description: 'Check if it is safe to proceed with AI changes. Returns proceed: true/false. If false, stop and ask user for confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        file:           { type: 'string' },
        before_content: { type: 'string' },
        after_content:  { type: 'string' },
      },
      required: ['file', 'before_content', 'after_content'],
    },
  },
  {
    name: 'get_history',
    description: 'Get project modification history. Shows how the project evolved over time.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_growth',
    description: 'Get AI vs manual code ratio. Shows developer growth over time.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'record_step',
    description: 'Record a project evolution step in history.',
    inputSchema: {
      type: 'object',
      properties: {
        label:  { type: 'string', description: 'Step description' },
        source: { type: 'string', enum: ['ai', 'manual'], description: 'Who made this change' },
        risk:   { type: 'string', enum: ['LOW', 'MED', 'HIGH'] },
        files:  { type: 'array', items: { type: 'string' } },
      },
      required: ['label'],
    },
  },
  {
    name: 'execute_command',
    description: 'Execute a terminal command with safety evaluation. Automatically blocks dangerous commands (rm -rf, force push, etc). Use this instead of running commands directly.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        source:  { type: 'string', description: 'Who requested this (ai/manual)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'evaluate_project',
    description: 'Evaluate code quality scores: API completeness, architecture, dependency health, stability, test coverage.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── Tool 실행 ──────────────────────────────────────────
async function executeTool(name, input, cwd) {
  const diff    = new DiffTracker(cwd);
  const growth  = new GrowthTracker(cwd);
  const history = new History(cwd);

  switch (name) {
    case 'analyze_diff': {
      const result = diff.analyze(
        path.resolve(cwd, input.file),
        input.before_content,
        input.after_content
      );
      return {
        file:         result.file,
        changedLines: result.changedLines,
        changeTypes:  result.changeTypes,
        risk: {
          level:   result.risk.level,
          score:   result.risk.score,
          reasons: result.risk.reasons,
        },
        impact: {
          affectedModules: result.impact.affectedModules,
          criticalPath:    result.impact.criticalPath,
        },
      };
    }

    case 'should_proceed': {
      const result = diff.analyze(
        path.resolve(cwd, input.file),
        input.before_content,
        input.after_content
      );
      const proceed = result.risk.level !== 'HIGH';
      return {
        proceed,
        risk:    result.risk.level,
        reason:  proceed
          ? 'Risk level is acceptable. Safe to proceed.'
          : `Risk is HIGH (${result.risk.reasons.join(', ')}). Stop and confirm with user before applying changes.`,
        affectedModules: result.impact.affectedModules,
        criticalPath:    result.impact.criticalPath,
      };
    }

    case 'get_history': {
      const data = storage.load(cwd, 'history') || [];
      return { steps: data, total: data.length };
    }

    case 'get_growth': {
      const data = growth.analyze();
      return data || { message: 'No data yet. Use analyze_diff to start tracking.' };
    }

    case 'record_step': {
      history.addStep(input.label, {
        source: input.source || 'ai',
        risk:   input.risk   || 'LOW',
        files:  input.files  || [],
      });
      return { recorded: true, step: input.label };
    }

    case 'execute_command': {
      const guard  = new CommandGuard(cwd);
      const result = await guard.run(input.command, { source: input.source || 'ai' });
      return result;
    }

    case 'evaluate_project': {
      const evaluator = new Evaluator(cwd);
      const result    = await evaluator.evaluate();
      return result;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP HTTP 서버 ──────────────────────────────────────
function startServer(port = 3741, cwd = process.cwd()) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);

        // MCP 핸드셰이크
        if (msg.method === 'initialize') {
          res.writeHead(200);
          res.end(JSON.stringify({
            jsonrpc: '2.0', id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'vibetrace', version: '0.1.0' },
            },
          }));
          return;
        }

        // tools/list
        if (msg.method === 'tools/list') {
          res.writeHead(200);
          res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: MCP_TOOLS } }));
          return;
        }

        // tools/call
        if (msg.method === 'tools/call') {
          const result = executeTool(msg.params.name, msg.params.arguments || {}, cwd);
          res.writeHead(200);
          res.end(JSON.stringify({
            jsonrpc: '2.0', id: msg.id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  });

  server.listen(port, () => {
    console.log(`\x1b[36m[vibetrace:mcp] Server running on http://localhost:${port}\x1b[0m`);
    console.log(`\x1b[90m[vibetrace:mcp] Add to Claude Desktop config:\x1b[0m`);
    console.log(`\x1b[90m{
  "mcpServers": {
    "vibetrace": {
      "url": "http://localhost:${port}"
    }
  }
}\x1b[0m`);
  });

  return server;
}

module.exports = { startServer, executeTool, MCP_TOOLS };
