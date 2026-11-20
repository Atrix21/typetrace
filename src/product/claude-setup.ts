/**
 * Claude Code setup: what `typetrace init` adds for Claude Code besides the MCP entry in .mcp.json.
 *
 *   CLAUDE.md                              a short block between <!-- typetrace --> markers (the rest of the file is kept)
 *   .claude/skills/typetrace/SKILL.md      a skill on using find_relevant_code well
 *   .claude/hooks/typetrace-nudge.mjs      a PreToolUse hook script (no dependencies)
 *   .claude/settings.json                  the hook's entry (other settings and hooks are kept)
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

## Limits

- The index covers source files in supported languages. Documentation, configuration and generated files are
  not in it; search those with Grep.
- After edits the index catches up within seconds to minutes. When it and the file disagree, trust the file.
`;

export const NUDGE_TEXT = 'TypeTrace: this repository is indexed. `find_relevant_code` (MCP server typetrace) returns the functions most relevant to a description, with file:line ranges and their callers and callees, usually in fewer tokens than searching and reading files one by one. Grep finds exact text; Read is best once the ranges are known.';

/** The hook script written to .claude/hooks/. Plain Node, no imports outside the standard library. */
export const HOOK_SCRIPT = `#!/usr/bin/env node
// TypeTrace for Claude Code (PreToolUse): a soft nudge toward find_relevant_code. It never blocks a call.
// At most TYPETRACE_NUDGE_CAP nudges (default 5) per session and agent; after the first, none while the
// TypeTrace server has answered a query in the last 30 minutes. Written by \`typetrace init\`; removed by
// \`typetrace uninstall\`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEXT = ${JSON.stringify(NUDGE_TEXT)};
const CAP = Number(process.env.TYPETRACE_NUDGE_CAP ?? 5);
const FRESH_MS = 30 * 60 * 1000;
const SEARCH = /^\\s*(grep|egrep|rg|ag|ack|fd|find|git\\s+grep)\\b/;

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

function run(p) {
  const tool = p.tool_name;
  const ti = p.tool_input ?? {};
  if (tool === 'Bash' && !SEARCH.test(String(ti.command ?? ''))) return;
  const root = process.env.CLAUDE_PROJECT_DIR || p.cwd || process.cwd();
  const target = ti.file_path ?? ti.path;
  if (typeof target === 'string' && path.isAbsolute(target) && target !== root && !target.startsWith(root + path.sep)) return;
  const dir = indexDir(root);
  if (!dir) return;
  let fresh = false;
  try { fresh = Date.now() - fs.statSync(path.join(dir, 'last_query')).mtimeMs < FRESH_MS; } catch { /* never queried */ }
  let key = String(p.session_id ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  if (key && p.agent_id) key += '-' + sha(String(p.agent_id)).slice(0, 16);
  if (!key) { if (!fresh) say(); return; }
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
  say();
}

function say() {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: TEXT } }) + '\\n');
}
`;

export const HOOK_FILE = path.join('.claude', 'hooks', 'typetrace-nudge.mjs');
export const SKILL_FILE = path.join('.claude', 'skills', 'typetrace', 'SKILL.md');
export const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/typetrace-nudge.mjs"';
/**
 * The hook's command. Default: `node` from the PATH. TYPETRACE_HOOK_NODE (set by the PyPI launcher, which brings its own
 * Node.js) names the Node binary instead; if it is gone later (an emptied uv cache), the hook stays silent.
 */
export function hookCommand(): string {
  const node = process.env.TYPETRACE_HOOK_NODE;
  return node ? `${JSON.stringify(node)} "$CLAUDE_PROJECT_DIR/.claude/hooks/typetrace-nudge.mjs" 2>/dev/null || true` : HOOK_COMMAND;
}
const HOOK_MATCHER = 'Grep|Glob|Read|Bash';
const isOurs = (h: unknown) => JSON.stringify(h ?? '').includes('typetrace-nudge.mjs');

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
  try { cfg = text?.trim() ? JSON.parse(text) : {}; } catch { return { file, action: 'skipped', reason: 'not plain JSON, left untouched; add the hook by hand (typetrace install --dry-run shows it)' }; }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { file, action: 'skipped', reason: 'unexpected content, left untouched' };
  const hooks = (cfg.hooks && typeof cfg.hooks === 'object') ? cfg.hooks : {};
  const pre: unknown[] = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  const others = pre.filter((h) => !isOurs(h));
  const had = others.length !== pre.length;
  if (remove) {
    if (!had) return { file, action: 'absent' };
    if (others.length) hooks.PreToolUse = others; else delete hooks.PreToolUse;
    if (Object.keys(hooks).length) cfg.hooks = hooks; else delete cfg.hooks;
    if (!dryRun) { if (Object.keys(cfg).length) writeAtomic(file, JSON.stringify(cfg, null, 2) + '\n'); else fs.rmSync(file); }
    return { file, action: 'removed' };
  }
  const ours = { matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: hookCommand(), timeout: 5 }] };
  const next = { ...cfg, hooks: { ...hooks, PreToolUse: [...others, ours] } };
  const content = JSON.stringify(next, null, 2) + '\n';
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
    editSettings(f(path.join('.claude', 'settings.json')), rm, dry),
  ];
}

export function describeSetup(repo: string, ch: SetupChange): string {
  return `  ${'Claude Code setup'.padEnd(26)} ${path.relative(repo, ch.file).padEnd(34)} ${ch.action}${ch.reason ? `: ${ch.reason}` : ''}`;
}
