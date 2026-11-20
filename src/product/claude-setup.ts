/**
 * Claude Code setup: what `typetrace init` adds for Claude Code besides the MCP entry in .mcp.json.
 *
 *   CLAUDE.md                              a short block between <!-- typetrace --> markers (the rest of the file is kept)
 *   .claude/skills/typetrace/SKILL.md      a skill on using find_relevant_code well
 *   .claude/hooks/typetrace-hook.mjs       the hook script (no dependencies; 0.3 named it typetrace-nudge.mjs)
 *   .claude/settings.json                  its entries for four events (other settings and hooks are kept)
 *
 * The hook never blocks a call. Before a search or a read in the repository it adds one sentence saying that the
 * repository is indexed and what find_relevant_code returns. It speaks at most TYPETRACE_NUDGE_CAP times (default 5)
 * per session and agent, and after its first nudge it stays quiet while TypeTrace has been queried in the last 30
 * minutes (the server records each query in the index folder). This is the same mechanism and the same cap as
 * graphify's default Claude Code hook.
 *
 * `typetrace init --no-setup` registers the server only; `typetrace uninstall` removes all four parts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './index-state.js';

export const BLOCK_START = '<!-- typetrace -->';
export const BLOCK_END = '<!-- /typetrace -->';

export const INSTRUCTIONS = `${BLOCK_START}
## TypeTrace

This repository is indexed by TypeTrace. Its \`find_relevant_code\` tool (MCP server \`typetrace\`) takes a description
in plain language or identifiers and returns the most relevant functions and methods, with file:line ranges,
signatures and, when known, their direct callers and callees.

- To find where something is implemented, which code an issue or a request involves, or what else a change affects,
  call \`find_relevant_code\` before searching or opening files. Describe the behaviour, not only a name.
- Then read the ranges it returns. Grep remains the right tool for exact text you already know.
- The callers and callees in its results point to code that often has to change together; check them before you
  conclude that a change is complete.
- Coming back to this repository: \`recent_work\` lists what earlier sessions searched, read and edited,
  \`changes_since_last_session\` what changed since, and \`codebase_overview\` maps the codebase from its call graph.
- When the index and the source disagree, the source wins: the index updates itself after edits settle.
${BLOCK_END}
`;

export const SKILL = `---
name: typetrace
description: Use when you need to find code in this repository — where a behaviour is implemented, which functions an issue, error or request involves, or what other code a change affects. Covers querying TypeTrace's find_relevant_code tool and following its results.
---

# Finding code with TypeTrace

\`find_relevant_code\` (MCP server \`typetrace\`) searches an index of every function and method in this repository.
It ranks them by meaning and by keywords, then adds code connected through the call graph. Each result is a
file:line range with a signature; read the ranges you need.

## Writing a query

- Describe what the code does, in the words of the task: "validate the expiry date of an uploaded token",
  "where retries are scheduled after a failed request". Include identifiers, error messages or file names when
  you have them; they are matched exactly.
- One concern per query. For a task with several parts, query each part.
- If the results miss, rephrase with the domain's own terms (taken from the results you did get), or name a
  function you found and ask for what calls it.

## Using the results

1. Read the top ranges before anything else; they are usually enough to place the change.
2. Look at the callers and callees listed with them. A fix often has to reach the caller, a sibling
   implementation or the code that consumes the value; these lists are where to find it.
3. Use Grep for exact text: every use of a name, a string or a config key. Use Read to see the whole of a file
   once you know it matters.
4. Before answering, check that every place the change touches has been found, not only the first.

## Coming back to a codebase

TypeTrace remembers, on this machine only, what each session searched, read and edited.
- \`recent_work\`: what earlier sessions worked on, with the functions involved. Start here when continuing a task.
- \`changes_since_last_session\`: files and functions that changed since the last session ended (exactly, in a git
  repository), and the code that calls them.
- \`codebase_overview\`: the codebase's areas, its most-called functions and its entry points, from the call graph.
  Pass \`under\` to look inside one area.

## Limits

- The index covers source files in supported languages. Documentation, configuration and generated files are
  not in it; search those with Grep.
- After edits the index catches up within seconds to minutes. When it and the file disagree, trust the file.
`;

export const NUDGE_TEXT = 'TypeTrace: this repository is indexed. `find_relevant_code` (MCP server typetrace) returns the functions most relevant to a description, with file:line ranges and their callers and callees, usually in fewer tokens than searching and reading files one by one. Grep finds exact text; Read is best once the ranges are known.';

/**
 * The hook script written to .claude/hooks/. Plain Node, no imports outside the standard library. One script for
 * four Claude Code events (it reads hook_event_name):
 *   PreToolUse    the soft nudge toward find_relevant_code (never blocks; cap and quiet rule as above);
 *   PostToolUse   appends to the worklog what was searched (find_relevant_code), read and edited (0.4);
 *   SessionStart  on a new session, one line pointing to earlier sessions' work; after a compaction, this session's
 *                 working set, so the agent need not search again; the nudge count of the session is reset (0.4);
 *   SessionEnd    a snapshot of the indexed files' state and the git commit, for changes_since_last_session (0.4).
 * The worklog and snapshots stay in TypeTrace's index folder. TYPETRACE_WORKLOG=0 turns recording off.
 */
export const HOOK_SCRIPT = String.raw`#!/usr/bin/env node
// TypeTrace for Claude Code. Written by "typetrace init"; removed by "typetrace uninstall". It never blocks a call.
// PreToolUse: a soft nudge toward find_relevant_code (at most TYPETRACE_NUDGE_CAP per session and agent, default 5;
// after the first, none while TypeTrace answered a query in the last 30 minutes). PostToolUse: records what the
// session searched, read and edited (TYPETRACE_WORKLOG=0 turns it off). SessionStart: points to earlier sessions'
// work; after a compaction, restates this session's working set. SessionEnd: notes the state of the code.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEXT = __NUDGE_TEXT__;
const CAP = Number(process.env.TYPETRACE_NUDGE_CAP ?? 5);
const FRESH_MS = 30 * 60 * 1000;
const SEARCH = /^\s*(grep|egrep|rg|ag|ack|fd|find|git\s+grep)\b/;
const RECORD = process.env.TYPETRACE_WORKLOG !== '0';

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => { try { run(JSON.parse(input || '{}')); } catch { /* never get in the way */ } process.exit(0); });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function indexDir(root) {
  const base = process.env.TYPETRACE_CACHE ?? path.join(os.homedir(), '.cache', 'typetrace');
  const roots = [root];
  try { const real = fs.realpathSync(root); if (real !== root) roots.push(real); } catch { /* */ }
  for (const r of roots) { const d = path.join(base, sha(r).slice(0, 16)); if (fs.existsSync(path.join(d, 'index.json'))) return d; }
  return null;
}

function sessionKey(p) {
  let key = String(p.session_id ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  if (key && p.agent_id) key += '-' + sha(String(p.agent_id)).slice(0, 16);
  return key;
}

function run(p) {
  const root = process.env.CLAUDE_PROJECT_DIR || p.cwd || process.cwd();
  const dir = indexDir(root);
  if (!dir) return;
  const ev = p.hook_event_name ?? 'PreToolUse';
  if (ev === 'PreToolUse') return nudge(p, root, dir);
  if (ev === 'PostToolUse') return RECORD && record(p, root, dir);
  if (ev === 'SessionStart') return start(p, dir);
  if (ev === 'SessionEnd') return end(p, root, dir);
}

function inside(root, target) {
  return typeof target === 'string' && (!path.isAbsolute(target) || target === root || target.startsWith(root + path.sep));
}

function nudge(p, root, dir) {
  const tool = p.tool_name;
  const ti = p.tool_input ?? {};
  if (tool === 'Bash' && !SEARCH.test(String(ti.command ?? ''))) return;
  const target = ti.file_path ?? ti.path;
  if (typeof target === 'string' && !inside(root, target)) return;
  let fresh = false;
  try { fresh = Date.now() - fs.statSync(path.join(dir, 'last_query')).mtimeMs < FRESH_MS; } catch { /* never queried */ }
  const key = sessionKey(p);
  if (!key) { if (!fresh) say('PreToolUse', TEXT); return; }
  const hooks = path.join(dir, 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  const marker = path.join(hooks, key + '.nudges');
  let count = 0;
  try { count = parseInt(fs.readFileSync(marker, 'utf8'), 10) || 0; } catch { /* first */ }
  if (count && fresh) return;
  if (CAP > 0 && count >= CAP) return;
  fs.writeFileSync(marker, String(count + 1));
  if (!count) { // first nudge of this session: forget sessions older than a week
    for (const f of fs.readdirSync(hooks)) { try { const m = path.join(hooks, f); if (Date.now() - fs.statSync(m).mtimeMs > 7 * 86400e3) fs.rmSync(m); } catch { /* */ } }
  }
  say('PreToolUse', TEXT);
}

function record(p, root, dir) {
  const tool = String(p.tool_name ?? '');
  const ti = p.tool_input ?? {};
  const s = sessionKey(p) || 'unknown';
  const t = new Date().toISOString();
  let e = null;
  if (/find_relevant_code$/.test(tool) && typeof ti.query === 'string') e = { t, s, e: 'query', q: ti.query.slice(0, 200) };
  else if (['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool) && inside(root, ti.file_path ?? ti.notebook_path)) {
    const f = path.relative(root, path.resolve(root, String(ti.file_path ?? ti.notebook_path)));
    if (tool === 'Read') {
      const a = Number(ti.offset) > 0 ? Number(ti.offset) : 1;
      e = { t, s, e: 'read', f, a, b: Number(ti.limit) > 0 ? a + Number(ti.limit) - 1 : undefined };
    } else {
      // where in the file the edit landed, from the new text when it is unique
      let a;
      try {
        const body = fs.readFileSync(path.join(root, f), 'utf8');
        const needle = String(ti.new_string ?? ti.edits?.[0]?.new_string ?? '');
        const i = needle ? body.indexOf(needle) : -1;
        if (i >= 0 && body.indexOf(needle, i + 1) < 0) a = body.slice(0, i).split('\n').length;
        if (a) e = { t, s, e: 'edit', f, a, b: a + needle.split('\n').length - 1 };
      } catch { /* */ }
      if (!e) e = { t, s, e: 'edit', f };
    }
  }
  if (!e) return;
  const log = path.join(dir, 'worklog.jsonl');
  fs.appendFileSync(log, JSON.stringify(e) + '\n');
  try { // keep it small: past 4 MB, keep the newest half
    if (fs.statSync(log).size > 4e6) { const ls = fs.readFileSync(log, 'utf8').split('\n'); fs.writeFileSync(log, ls.slice(Math.floor(ls.length / 2)).join('\n')); }
  } catch { /* */ }
}

function worklog(dir) {
  try { return fs.readFileSync(path.join(dir, 'worklog.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-5000).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

function start(p, dir) {
  const s = sessionKey(p);
  const log = worklog(dir);
  if (p.source === 'compact') {
    try { fs.rmSync(path.join(dir, 'hooks', s + '.nudges'), { force: true }); } catch { /* */ }
    const mine = log.filter((e) => e.s === s);
    if (!mine.length) return;
    const qs = [...new Set(mine.filter((e) => e.e === 'query').map((e) => e.q))].slice(-5);
    const touched = [];
    for (const e of mine.slice().reverse()) {
      if (!e.f) continue;
      const k = e.f + (e.a ? ':' + e.a + (e.b ? '-' + e.b : '') : '');
      if (!touched.includes(k)) touched.push((e.e === 'edit' ? 'edited ' : '') + k);
      if (touched.length >= 15) break;
    }
    say('SessionStart', 'TypeTrace: before the context was compacted, this session ' + (qs.length ? 'searched for ' + qs.map((q) => JSON.stringify(q)).join(', ') + ' and ' : '') + 'worked on ' + touched.join(', ') + '. These are file:line pointers; read them again only where needed. recent_work lists this and earlier sessions with the functions involved.');
    return;
  }
  const earlier = log.filter((e) => e.s !== s);
  if (!earlier.length) return;
  const files = [];
  for (const e of earlier.slice().reverse()) { if (e.f && !files.includes(e.f)) files.push(e.f); if (files.length >= 5) break; }
  say('SessionStart', 'TypeTrace: earlier sessions in this repository worked on ' + files.join(', ') + '. The TypeTrace tools recent_work (what they searched, read and edited) and changes_since_last_session (what changed since) can save re-exploring.');
}

function end(p, root, dir) {
  let manifest = {};
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    for (const f of Object.keys(m)) { try { const st = fs.statSync(path.join(root, f)); manifest[f] = st.size + ':' + Math.round(st.mtimeMs); } catch { /* deleted */ } }
  } catch { return; }
  let head = null;
  try { head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { /* not git */ }
  const d = path.join(dir, 'sessions');
  fs.mkdirSync(d, { recursive: true });
  const t = new Date().toISOString();
  fs.writeFileSync(path.join(d, t.replace(/[:.]/g, '-') + '.json'), JSON.stringify({ t, s: sessionKey(p), head, manifest }));
  const all = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 10))) { try { fs.rmSync(path.join(d, f)); } catch { /* */ } }
}

function say(ev, text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: ev, additionalContext: text } }) + '\n');
}
`.replace('__NUDGE_TEXT__', JSON.stringify(NUDGE_TEXT));

/** 0.3's hook file; recognised so an upgrade replaces it and uninstall removes it. */
export const OLD_HOOK_FILE = path.join('.claude', 'hooks', 'typetrace-nudge.mjs');
export const HOOK_FILE = path.join('.claude', 'hooks', 'typetrace-hook.mjs');
export const SKILL_FILE = path.join('.claude', 'skills', 'typetrace', 'SKILL.md');
export const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/typetrace-hook.mjs"';
/**
 * The hook's command. Default: `node` from the PATH. TYPETRACE_HOOK_NODE (set by the PyPI launcher, which brings its own
 * Node.js) names the Node binary instead; if it is gone later (an emptied uv cache), the hook stays silent.
 */
export function hookCommand(): string {
  const node = process.env.TYPETRACE_HOOK_NODE;
  return node ? `${JSON.stringify(node)} "$CLAUDE_PROJECT_DIR/.claude/hooks/typetrace-hook.mjs" 2>/dev/null || true` : HOOK_COMMAND;
}
/** Hook registrations: event -> matcher (null: every occurrence). */
const HOOK_EVENTS: [string, string | null][] = [
  ['PreToolUse', 'Grep|Glob|Read|Bash'],
  ['PostToolUse', 'Read|Edit|MultiEdit|Write|NotebookEdit|mcp__typetrace__find_relevant_code'],
  ['SessionStart', 'startup|resume|clear|compact'],
  ['SessionEnd', null],
];
const isOurs = (h: unknown) => /typetrace-(nudge|hook)\.mjs/.test(JSON.stringify(h ?? ''));

export interface SetupChange { file: string; action: 'added' | 'updated' | 'unchanged' | 'removed' | 'absent' | 'skipped'; reason?: string }

const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

function writeFile(file: string, content: string, dryRun: boolean, mode?: number): SetupChange['action'] {
  const before = read(file);
  if (before === content) return 'unchanged';
  if (!dryRun) { fs.mkdirSync(path.dirname(file), { recursive: true }); writeAtomic(file, content); if (mode) fs.chmodSync(file, mode); }
  return before === null ? 'added' : 'updated';
}

function removeFile(file: string, dryRun: boolean): SetupChange['action'] {
  if (!fs.existsSync(file)) return 'absent';
  if (!dryRun) {
    fs.rmSync(file);
    // Remove the folders we created if they are now empty (never .claude itself).
    for (let d = path.dirname(file); path.basename(d) !== '.claude' && fs.existsSync(d) && !fs.readdirSync(d).length; d = path.dirname(d)) fs.rmdirSync(d);
  }
  return 'removed';
}

const blockRe = new RegExp(`\\n?${BLOCK_START}[\\s\\S]*?${BLOCK_END}\\n?`);

function editInstructions(file: string, remove: boolean, dryRun: boolean): SetupChange['action'] {
  const text = read(file);
  if (remove) {
    if (text === null || !blockRe.test(text)) return 'absent';
    const rest = text.replace(blockRe, '\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
    if (!dryRun) { if (rest.trim()) writeAtomic(file, rest); else fs.rmSync(file); }
    return 'removed';
  }
  const next = text === null ? INSTRUCTIONS
    : blockRe.test(text) ? text.replace(blockRe, (m) => (m.startsWith('\n') ? '\n' : '') + INSTRUCTIONS)
    : text.replace(/\n*$/, '') + (text.trim() ? '\n\n' : '') + INSTRUCTIONS;
  return writeFile(file, next, dryRun);
}

function editSettings(file: string, remove: boolean, dryRun: boolean): SetupChange {
  const text = read(file);
  let cfg: Record<string, any>;
  try { cfg = text?.trim() ? JSON.parse(text) : {}; } catch { return { file, action: 'skipped', reason: 'not plain JSON, left untouched; add the hooks by hand (typetrace install --dry-run shows them)' }; }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { file, action: 'skipped', reason: 'unexpected content, left untouched' };
  const hooks: Record<string, unknown[]> = (cfg.hooks && typeof cfg.hooks === 'object') ? { ...cfg.hooks } : {};
  let had = false;
  for (const ev of new Set([...Object.keys(hooks), ...HOOK_EVENTS.map(([e]) => e)])) {
    if (!Array.isArray(hooks[ev])) continue;
    const others = hooks[ev].filter((h) => !isOurs(h));
    if (others.length === hooks[ev].length) continue; // not ours: left exactly as it is
    had = true;
    if (others.length) hooks[ev] = others; else delete hooks[ev];
  }
  if (remove) {
    if (!had) return { file, action: 'absent' };
    if (Object.keys(hooks).length) cfg.hooks = hooks; else delete cfg.hooks;
    if (!dryRun) { if (Object.keys(cfg).length) writeAtomic(file, JSON.stringify(cfg, null, 2) + '\n'); else fs.rmSync(file); }
    return { file, action: 'removed' };
  }
  for (const [ev, matcher] of HOOK_EVENTS) {
    const ours = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: hookCommand(), timeout: ev === 'SessionEnd' ? 10 : 5 }] };
    hooks[ev] = [...(hooks[ev] ?? []), ours];
  }
  const content = JSON.stringify({ ...cfg, hooks }, null, 2) + '\n';
  if (text === content) return { file, action: 'unchanged' };
  if (!dryRun) { fs.mkdirSync(path.dirname(file), { recursive: true }); writeAtomic(file, content); }
  return { file, action: had ? 'updated' : 'added' };
}

/** Write (or, with `remove`, take out) the Claude Code setup in `repo`. */
export function applyClaudeSetup(repo: string, opts: { dryRun?: boolean; remove?: boolean } = {}): SetupChange[] {
  const dry = !!opts.dryRun, rm = !!opts.remove;
  const f = (p: string) => path.join(repo, p);
  return [
    { file: f('CLAUDE.md'), action: editInstructions(f('CLAUDE.md'), rm, dry) },
    { file: f(SKILL_FILE), action: rm ? removeFile(f(SKILL_FILE), dry) : writeFile(f(SKILL_FILE), SKILL, dry) },
    { file: f(HOOK_FILE), action: rm ? removeFile(f(HOOK_FILE), dry) : writeFile(f(HOOK_FILE), HOOK_SCRIPT, dry, 0o755) },
    ...(fs.existsSync(f(OLD_HOOK_FILE)) ? [{ file: f(OLD_HOOK_FILE), action: removeFile(f(OLD_HOOK_FILE), dry) }] : []), // 0.3's file
    editSettings(f(path.join('.claude', 'settings.json')), rm, dry),
  ];
}

export function describeSetup(repo: string, ch: SetupChange): string {
  return `  ${'Claude Code setup'.padEnd(26)} ${path.relative(repo, ch.file).padEnd(34)} ${ch.action}${ch.reason ? `: ${ch.reason}` : ''}`;
}
