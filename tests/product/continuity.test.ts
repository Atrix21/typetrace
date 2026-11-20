/**
 * Working across sessions (0.4): the hook records the worklog and session snapshots and speaks at session start and
 * after a compaction (run as Claude Code runs it, JSON on stdin); recent_work, codebase_overview and
 * changes_since_last_session answer from them. TYPETRACE_CACHE points at a temp folder: nothing on this machine is
 * read or written.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyClaudeSetup, HOOK_FILE, OLD_HOOK_FILE } from '../../src/product/claude-setup.js';
import { changesSince, DeclIndex, overview, readSnapshots, readWorklog, recentWork } from '../../src/product/continuity.js';
import type { GraphEdge, GraphNode } from '../../src/graph/graph-schema.js';

let repo: string, cache: string;
const saved = { c: process.env.TYPETRACE_CACHE, w: process.env.TYPETRACE_WORKLOG };
const idx = () => path.join(cache, crypto.createHash('sha256').update(repo).digest('hex').slice(0, 16));
const hook = (payload: Record<string, unknown>, env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, [path.join(repo, HOOK_FILE)], { input: JSON.stringify(payload), env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env }, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
};
const node = (id: string, name: string, file: string, a: number, b: number, type: GraphNode['type'] = 'function'): GraphNode =>
  ({ id, type, name, qualified_name: name, file, start_line: a, end_line: b, start_col: null, end_col: null, meta: {} });
const call = (src: string, dst: string): GraphEdge => ({ id: `${src}>${dst}`, type: 'CALLS', src, dst, file: null, line: null, col: null, extraction: 'test', confidence: 1, verification: 'static_verified', evidence: null, meta: {} } as unknown as GraphEdge);

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-cont-'));
  cache = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-cont-cache-'));
  process.env.TYPETRACE_CACHE = cache;
  delete process.env.TYPETRACE_WORKLOG;
  applyClaudeSetup(repo);
  fs.mkdirSync(idx(), { recursive: true });
  fs.writeFileSync(path.join(idx(), 'index.json'), '{}');
});
afterEach(() => {
  for (const [k, v] of [['TYPETRACE_CACHE', saved.c], ['TYPETRACE_WORKLOG', saved.w]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('the hook records the worklog', () => {
  it('records queries, reads (with their lines) and edits, and nothing outside the repository', () => {
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src/a.ts'), 'line1\nexport function f() {\n  return 2;\n}\n');
    hook({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'mcp__typetrace__find_relevant_code', tool_input: { query: 'where is f' } });
    hook({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Read', tool_input: { file_path: path.join(repo, 'src/a.ts'), offset: 2, limit: 3 } });
    hook({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src/a.ts'), new_string: '  return 2;' } });
    hook({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } });
    hook({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Grep', tool_input: { pattern: 'x' } });
    const log = readWorklog(idx());
    expect(log.map((e) => [e.e, e.f, e.a, e.b, e.q])).toEqual([
      ['query', undefined, undefined, undefined, 'where is f'],
      ['read', path.join('src', 'a.ts'), 2, 4, undefined],
      ['edit', path.join('src', 'a.ts'), 3, 3, undefined],
    ]);
  });

  it('records nothing with TYPETRACE_WORKLOG=0', () => {
    hook({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'mcp__typetrace__find_relevant_code', tool_input: { query: 'q' } }, { TYPETRACE_WORKLOG: '0' });
    expect(readWorklog(idx())).toEqual([]);
  });
});

describe('the hook at session start and end', () => {
  it('says nothing in the first session, then points to earlier sessions', () => {
    expect(hook({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's1' })).toBeNull();
    hook({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Read', tool_input: { file_path: path.join(repo, 'src/auth.ts') } });
    const out = hook({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's2' });
    expect(out.hookEventName).toBe('SessionStart');
    expect(out.additionalContext).toMatch(/earlier sessions in this repository worked on src\/auth\.ts/);
    expect(out.additionalContext).toMatch(/recent_work/);
  });

  it('after a compaction, restates this session\'s working set and resets its nudge count', () => {
    fs.mkdirSync(path.join(idx(), 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(idx(), 'hooks', 's9.nudges'), '5');
    hook({ hook_event_name: 'PostToolUse', session_id: 's9', tool_name: 'mcp__typetrace__find_relevant_code', tool_input: { query: 'token refresh' } });
    hook({ hook_event_name: 'PostToolUse', session_id: 's9', tool_name: 'Read', tool_input: { file_path: path.join(repo, 'src/t.ts'), offset: 10, limit: 20 } });
    hook({ hook_event_name: 'PostToolUse', session_id: 'other', tool_name: 'Read', tool_input: { file_path: path.join(repo, 'src/zzz.ts') } });
    const out = hook({ hook_event_name: 'SessionStart', source: 'compact', session_id: 's9' });
    expect(out.additionalContext).toMatch(/searched for "token refresh"/);
    expect(out.additionalContext).toMatch(/src\/t\.ts:10-29/);
    expect(out.additionalContext).not.toMatch(/zzz/);
    expect(fs.existsSync(path.join(idx(), 'hooks', 's9.nudges'))).toBe(false);
  });

  it('notes the files\' state and the git commit when a session ends, keeping the last 10', () => {
    spawnSync('git', ['init', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'a.ts'), 'x\n');
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: repo });
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'one'], { cwd: repo });
    fs.writeFileSync(path.join(idx(), 'manifest.json'), JSON.stringify({ 'a.ts': '0:0' }));
    for (let i = 0; i < 12; i++) hook({ hook_event_name: 'SessionEnd', session_id: `e${i}` });
    const snaps = readSnapshots(idx());
    expect(snaps.length).toBe(10);
    expect(snaps.at(-1)!.head).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(snaps.at(-1)!.manifest)).toEqual(['a.ts']);
    expect(snaps.at(-1)!.manifest['a.ts']).toMatch(/^2:\d+$/);
  });

  it('registers all four events, upgrades a 0.3 setup and removes everything on uninstall', () => {
    const settings = () => JSON.parse(fs.readFileSync(path.join(repo, '.claude/settings.json'), 'utf8'));
    expect(Object.keys(settings().hooks).sort()).toEqual(['PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart']);
    // a 0.3 install: the old file and its PreToolUse entry
    fs.writeFileSync(path.join(repo, OLD_HOOK_FILE), '// 0.3');
    const s = settings(); s.hooks.PreToolUse.push({ matcher: 'Grep', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/typetrace-nudge.mjs"' }] });
    fs.writeFileSync(path.join(repo, '.claude/settings.json'), JSON.stringify(s));
    applyClaudeSetup(repo);
    expect(fs.existsSync(path.join(repo, OLD_HOOK_FILE))).toBe(false);
    expect(settings().hooks.PreToolUse).toHaveLength(1);
    expect(JSON.stringify(settings())).not.toMatch(/typetrace-nudge/);
    applyClaudeSetup(repo, { remove: true });
    expect(fs.existsSync(path.join(repo, '.claude/settings.json'))).toBe(false);
  });
});

describe('the three tools', () => {
  const nodes = [
    node('f1', 'AuthService.refresh', 'src/auth.ts', 10, 30, 'method'),
    node('f2', 'AuthService.login', 'src/auth.ts', 32, 50, 'method'),
    node('f3', 'handleRequest', 'src/server.ts', 1, 20),
    node('f4', 'main', 'src/main.ts', 1, 5),
    node('c1', 'AuthService', 'src/auth.ts', 1, 60, 'class'),
  ];
  const edges = [call('f3', 'f1'), call('f3', 'f2'), call('f4', 'f3'), call('f2', 'f1')];

  it('recent_work: sessions, most recent first, with reads mapped to the innermost functions', () => {
    const log = [
      { t: '2026-11-19T10:00:00Z', s: 'old', e: 'query' as const, q: 'login flow' },
      { t: '2026-11-19T10:01:00Z', s: 'old', e: 'read' as const, f: 'src/auth.ts', a: 32, b: 50 },
      { t: '2026-11-20T09:00:00Z', s: 'new', e: 'edit' as const, f: 'src/auth.ts', a: 12, b: 13 },
    ];
    const out = recentWork(log, new DeclIndex(nodes));
    expect(out.indexOf('2026-11-20')).toBeLessThan(out.indexOf('2026-11-19'));
    expect(out).toMatch(/edited: AuthService\.refresh \(src\/auth\.ts:10-30\)/);
    expect(out).toMatch(/searched: "login flow"/);
    expect(out).toMatch(/read: AuthService\.login \(src\/auth\.ts:32-50\)/);
    expect(recentWork([], new DeclIndex(nodes))).toMatch(/No earlier sessions/);
  });

  it('codebase_overview: areas, most-called functions and entry points', () => {
    const out = overview(['src/auth.ts', 'src/server.ts', 'src/main.ts', 'test/a.ts'], nodes, edges);
    expect(out).toMatch(/4 indexed files/);
    expect(out).toMatch(/src\/ — 3 \(ts\)/);
    expect(out).toMatch(/AuthService\.refresh \(src\/auth\.ts:10-30\) — called from 2 places/);
    expect(out).toMatch(/main \(src\/main\.ts:1-5\) — calls 1, called by none indexed/);
    expect(overview(['src/auth.ts'], nodes, edges, { under: 'lib' })).toMatch(/No indexed files under lib/);
  });

  it('changes_since_last_session: exact changed functions with git, and their callers', () => {
    const g = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
    g('init', '-q');
    fs.mkdirSync(path.join(repo, 'src'));
    const body = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(repo, 'src/auth.ts'), body.join('\n') + '\n');
    g('add', '-A'); g('commit', '-qm', 'one');
    const head = g('rev-parse', 'HEAD').stdout.trim();
    const before = { 'src/auth.ts': 'old' };
    body[14] = 'changed line 15';
    fs.writeFileSync(path.join(repo, 'src/auth.ts'), body.join('\n') + '\n');
    const out = changesSince(repo, [{ t: '2026-11-19T10:00:00Z', s: 'old', head, manifest: before }], { 'src/auth.ts': 'new', 'src/new.ts': 'n' }, new DeclIndex(nodes), nodes, edges);
    expect(out).toMatch(/changed files \(1\): src\/auth\.ts/);
    expect(out).toMatch(/new files \(1\): src\/new\.ts/);
    expect(out).toMatch(/AuthService\.refresh \(src\/auth\.ts:10-30\) — called by handleRequest \(src\/server\.ts:1\), AuthService\.login \(src\/auth\.ts:32\)/);
    expect(out).not.toMatch(/AuthService\.login \(src\/auth\.ts:32-50\)/);
    expect(changesSince(repo, [], {}, new DeclIndex(nodes), nodes, edges)).toMatch(/No earlier session/);
  });
});
