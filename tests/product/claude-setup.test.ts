/**
 * Claude Code setup (src/product/claude-setup.ts): the CLAUDE.md block, the skill, the hook script and its
 * settings entry are added without touching anything else, are idempotent, and are removed cleanly. The hook script
 * is run as Claude Code runs it (JSON on stdin) against a temp index folder: it nudges only for searches and reads in
 * the repository, at most the cap per session, and stays quiet after a recent query. TYPETRACE_CACHE points at a temp
 * folder, so nothing on this machine is read or written.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyClaudeSetup, HOOK_COMMAND, HOOK_FILE, INSTRUCTIONS, NUDGE_TEXT, SKILL, SKILL_FILE } from '../../src/product/claude-setup.js';

let repo: string, cache: string;
const saved = process.env.TYPETRACE_CACHE;
const f = (p: string) => path.join(repo, p);
const settings = () => JSON.parse(fs.readFileSync(f('.claude/settings.json'), 'utf8'));

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-cs-repo-'));
  cache = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-cs-cache-'));
  process.env.TYPETRACE_CACHE = cache;
});
afterEach(() => { if (saved === undefined) delete process.env.TYPETRACE_CACHE; else process.env.TYPETRACE_CACHE = saved; });

describe('Claude Code setup files', () => {
  it('adds the four parts and keeps what was there', () => {
    fs.writeFileSync(f('CLAUDE.md'), '# My project\n\nUse pnpm.\n');
    fs.mkdirSync(f('.claude'));
    fs.writeFileSync(f('.claude/settings.json'), JSON.stringify({ model: 'x', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine' }] }], Stop: [] } }));
    const ch = applyClaudeSetup(repo);
    expect(ch.map((c) => c.action)).toEqual(['updated', 'added', 'added', 'added']);
    const md = fs.readFileSync(f('CLAUDE.md'), 'utf8');
    expect(md.startsWith('# My project\n\nUse pnpm.\n\n')).toBe(true);
    expect(md.endsWith(INSTRUCTIONS)).toBe(true);
    expect(fs.readFileSync(f(SKILL_FILE), 'utf8')).toBe(SKILL);
    expect(fs.statSync(f(HOOK_FILE)).mode & 0o111).toBeTruthy();
    const s = settings();
    expect(s.model).toBe('x');
    expect(s.hooks.Stop).toEqual([]);
    expect(s.hooks.PreToolUse).toHaveLength(2);
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe('mine');
    expect(s.hooks.PreToolUse[1].hooks[0].command).toBe(HOOK_COMMAND);
  });

  it('is idempotent and replaces an older block in place', () => {
    applyClaudeSetup(repo);
    expect(applyClaudeSetup(repo).map((c) => c.action)).toEqual(['unchanged', 'unchanged', 'unchanged', 'unchanged']);
    fs.writeFileSync(f('CLAUDE.md'), 'top\n\n<!-- typetrace -->\nold text\n<!-- /typetrace -->\n\nbottom\n');
    applyClaudeSetup(repo);
    const md = fs.readFileSync(f('CLAUDE.md'), 'utf8');
    expect(md).toBe(`top\n\n${INSTRUCTIONS}\nbottom\n`);
    expect(md.match(/<!-- typetrace -->/g)).toHaveLength(1);
  });

  it('dry run writes nothing', () => {
    const ch = applyClaudeSetup(repo, { dryRun: true });
    expect(ch.map((c) => c.action)).toEqual(['added', 'added', 'added', 'added']);
    expect(fs.readdirSync(repo)).toEqual([]);
  });

  it('removal takes out only our parts, and files and folders it created', () => {
    applyClaudeSetup(repo);
    expect(applyClaudeSetup(repo, { remove: true }).map((c) => c.action)).toEqual(['removed', 'removed', 'removed', 'removed']);
    expect(fs.readdirSync(repo)).toEqual(['.claude']);
    expect(fs.readdirSync(f('.claude'))).toEqual([]);
    fs.writeFileSync(f('CLAUDE.md'), '# Mine\n');
    fs.writeFileSync(f('.claude/settings.json'), JSON.stringify({ model: 'x' }));
    applyClaudeSetup(repo);
    applyClaudeSetup(repo, { remove: true });
    expect(fs.readFileSync(f('CLAUDE.md'), 'utf8')).toBe('# Mine\n');
    expect(settings()).toEqual({ model: 'x' });
    expect(applyClaudeSetup(repo, { remove: true }).map((c) => c.action)).toEqual(['absent', 'absent', 'absent', 'absent']);
  });

  it('leaves a settings file that is not plain JSON untouched', () => {
    fs.mkdirSync(f('.claude'));
    fs.writeFileSync(f('.claude/settings.json'), '{ // comment\n}');
    expect(applyClaudeSetup(repo)[3].action).toBe('skipped');
    expect(fs.readFileSync(f('.claude/settings.json'), 'utf8')).toBe('{ // comment\n}');
  });

  it('stays short: the always-loaded text is under 450 words', () => {
    const desc = SKILL.split('\n').find((l) => l.startsWith('description:'))!;
    expect((INSTRUCTIONS + desc).split(/\s+/).length).toBeLessThan(450);
  });
});

describe('the hook script', () => {
  const indexDir = () => path.join(cache, crypto.createHash('sha256').update(repo).digest('hex').slice(0, 16));
  const hook = (payload: Record<string, unknown>, env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [f(HOOK_FILE)], { input: JSON.stringify(payload), env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
  };
  const indexed = () => { fs.mkdirSync(indexDir(), { recursive: true }); fs.writeFileSync(path.join(indexDir(), 'index.json'), '{}'); };

  beforeEach(() => { applyClaudeSetup(repo); });

  it('says nothing when the repository is not indexed', () => {
    expect(hook({ session_id: 's', tool_name: 'Grep', tool_input: { pattern: 'x' } })).toBeNull();
  });

  it('nudges searches and reads in the repository, never other commands or outside paths, and never blocks', () => {
    indexed();
    const out = hook({ session_id: 's1', tool_name: 'Grep', tool_input: { pattern: 'x' } });
    expect(out).toEqual({ hookEventName: 'PreToolUse', additionalContext: NUDGE_TEXT });
    expect(out.permissionDecision).toBeUndefined();
    expect(hook({ session_id: 's2', tool_name: 'Bash', tool_input: { command: 'npm test' } })).toBeNull();
    expect(hook({ session_id: 's2', tool_name: 'Bash', tool_input: { command: 'rg -n foo src' } })).not.toBeNull();
    expect(hook({ session_id: 's3', tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } })).toBeNull();
    expect(hook({ session_id: 's3', tool_name: 'Read', tool_input: { file_path: f('a.ts') } })).not.toBeNull();
  });

  it('nudges at most the cap per session and agent', () => {
    indexed();
    const p = { session_id: 'cap', tool_name: 'Read', tool_input: { file_path: f('a.ts') } };
    expect(Array.from({ length: 8 }, () => hook(p)).filter(Boolean)).toHaveLength(5);
    expect(hook({ ...p, agent_id: 'sub-1' })).not.toBeNull(); // a subagent has its own budget
    expect(hook({ ...p, session_id: 'cap2' }, { TYPETRACE_NUDGE_CAP: '1' })).not.toBeNull();
    expect(hook({ ...p, session_id: 'cap2' }, { TYPETRACE_NUDGE_CAP: '1' })).toBeNull();
  });

  it('after its first nudge, stays quiet while a query is recent', () => {
    indexed();
    fs.writeFileSync(path.join(indexDir(), 'last_query'), 'now');
    const p = { session_id: 'q', tool_name: 'Glob', tool_input: { pattern: '**/*.ts' } };
    expect(hook(p)).not.toBeNull();
    expect(hook(p)).toBeNull();
    const old = new Date(Date.now() - 31 * 60 * 1000);
    fs.utimesSync(path.join(indexDir(), 'last_query'), old, old);
    expect(hook(p)).not.toBeNull();
  });

  it('ignores malformed input', () => {
    indexed();
    const r = spawnSync(process.execPath, [f(HOOK_FILE)], { input: 'not json', env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
});

describe('the hook command', () => {
  afterEach(() => { delete process.env.TYPETRACE_HOOK_NODE; });
  it('is `node` from the PATH by default, the launcher\'s Node.js when TYPETRACE_HOOK_NODE is set', () => {
    applyClaudeSetup(repo);
    expect(settings().hooks.PreToolUse[0].hooks[0].command).toBe(HOOK_COMMAND);
    process.env.TYPETRACE_HOOK_NODE = '/opt/py env/bin/node';
    applyClaudeSetup(repo);
    const c = settings().hooks.PreToolUse;
    expect(c).toHaveLength(1); // replaced, not duplicated
    expect(c[0].hooks[0].command).toBe('"/opt/py env/bin/node" "$CLAUDE_PROJECT_DIR/.claude/hooks/typetrace-hook.mjs" 2>/dev/null || true');
  });
});
