/**
 * MCP client registration: one entry per supported AI coding tool, merged into the tool's own configuration file.
 *
 * Project-scoped files (in the repository) pin the server to that repository. Tools that only have a global
 * configuration (Windsurf, Zed) get one entry without a repository: the server serves the nearest indexed repository
 * above the directory the tool starts it in, and says so when there is none, instead of answering about another one.
 *
 * Only the `typetrace` entry is written. Other servers and settings stay as they are, and fields added by hand to our
 * entry (env, disabled, ...) are kept. A file that is not plain JSON (comments, trailing commas) is never rewritten:
 * the entry to paste is printed instead.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic } from './index-state.js';

export const SERVER_NAME = 'typetrace';

export interface Launch { command: string; args: string[] }
type Format = 'json' | 'toml';
type Shape = 'mcp' | 'vscode' | 'opencode';

export interface Client {
  id: string;
  name: string;
  /** project: <repo>/<file>, pinned to the repository. global: one file in the home directory, not pinned. */
  scope: 'project' | 'global';
  file: (repo: string) => string;
  format: Format;
  /** JSON object key that holds the servers (TOML: the `mcp_servers` table). */
  key: string;
  shape: Shape;
  detect: () => boolean;
  note?: string;
}

const home = () => os.homedir();
function onPath(bin: string): boolean {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
      try { fs.accessSync(path.join(dir, bin + ext), fs.constants.X_OK); return true; } catch { /* next */ }
    }
  }
  return false;
}
const exists = (...p: string[]) => fs.existsSync(path.join(...p));
function zedSettings(): string {
  const linuxStyle = path.join(home(), '.config', 'zed', 'settings.json');
  const mac = path.join(home(), 'Library', 'Application Support', 'Zed', 'settings.json');
  return process.platform === 'darwin' && !fs.existsSync(path.dirname(linuxStyle)) && fs.existsSync(path.dirname(mac)) ? mac : linuxStyle;
}

export const CLIENTS: Client[] = [
  { id: 'claude', name: 'Claude Code', scope: 'project', file: (r) => path.join(r, '.mcp.json'), format: 'json', key: 'mcpServers', shape: 'mcp',
    detect: () => true },
  { id: 'cursor', name: 'Cursor', scope: 'project', file: (r) => path.join(r, '.cursor', 'mcp.json'), format: 'json', key: 'mcpServers', shape: 'mcp',
    detect: () => exists(home(), '.cursor') || onPath('cursor') },
  { id: 'vscode', name: 'VS Code (GitHub Copilot)', scope: 'project', file: (r) => path.join(r, '.vscode', 'mcp.json'), format: 'json', key: 'servers', shape: 'vscode',
    detect: () => onPath('code') || exists(home(), '.vscode') },
  { id: 'codex', name: 'Codex', scope: 'project', file: (r) => path.join(r, '.codex', 'config.toml'), format: 'toml', key: 'mcp_servers', shape: 'mcp',
    detect: () => !!process.env.CODEX_HOME || exists(home(), '.codex') || onPath('codex'),
    note: 'Codex reads a project .codex/config.toml only once you trust the project.' },
  { id: 'gemini', name: 'Gemini CLI', scope: 'project', file: (r) => path.join(r, '.gemini', 'settings.json'), format: 'json', key: 'mcpServers', shape: 'mcp',
    detect: () => onPath('gemini') || exists(home(), '.gemini') },
  { id: 'opencode', name: 'OpenCode', scope: 'project', file: (r) => path.join(r, 'opencode.json'), format: 'json', key: 'mcp', shape: 'opencode',
    detect: () => onPath('opencode') || exists(home(), '.config', 'opencode') },
  { id: 'kiro', name: 'Kiro', scope: 'project', file: (r) => path.join(r, '.kiro', 'settings', 'mcp.json'), format: 'json', key: 'mcpServers', shape: 'mcp',
    detect: () => exists(home(), '.kiro') || onPath('kiro') },
  { id: 'windsurf', name: 'Windsurf', scope: 'global', file: () => path.join(home(), '.codeium', 'windsurf', 'mcp_config.json'), format: 'json', key: 'mcpServers', shape: 'mcp',
    detect: () => exists(home(), '.codeium', 'windsurf'),
    note: 'global configuration: TypeTrace serves the indexed repository that Windsurf starts it in.' },
  { id: 'zed', name: 'Zed', scope: 'global', file: () => zedSettings(), format: 'json', key: 'context_servers', shape: 'mcp',
    detect: () => fs.existsSync(path.dirname(zedSettings())),
    note: 'global configuration: TypeTrace serves the indexed repository that Zed starts it in.' },
];

/** "auto" (default): Claude Code plus every tool found on this machine. "all", "none", or a comma-separated list of ids. */
export function selectClients(spec: string | undefined): Client[] {
  const s = (spec ?? 'auto').trim();
  if (s === 'none') return [];
  if (s === 'all') return CLIENTS;
  if (s === 'auto') return CLIENTS.filter((c) => c.detect());
  const ids = s.split(',').map((x) => x.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !CLIENTS.some((c) => c.id === id));
  if (unknown.length) throw new Error(`unknown client ${unknown.join(', ')}; known: ${CLIENTS.map((c) => c.id).join(', ')}, all, auto, none`);
  return CLIENTS.filter((c) => ids.includes(c.id));
}

/** The server entry in the client's own shape. */
export function entryFor(c: Client, launch: Launch): Record<string, unknown> {
  if (c.shape === 'opencode') return { type: 'local', command: [launch.command, ...launch.args], enabled: true };
  if (c.shape === 'vscode') return { type: 'stdio', command: launch.command, args: launch.args };
  return { command: launch.command, args: launch.args };
}

export interface Change { client: Client; file: string; action: 'added' | 'updated' | 'unchanged' | 'removed' | 'absent' | 'skipped'; reason?: string; snippet?: string }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function editJson(c: Client, file: string, entry: Record<string, unknown> | null, dryRun: boolean): Change {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const snippet = entry ? JSON.stringify({ [c.key]: { [SERVER_NAME]: entry } }, null, 2) : undefined;
  let cfg: unknown;
  try { cfg = text.trim() ? JSON.parse(text) : {}; } catch {
    return { client: c, file, action: 'skipped', reason: 'not plain JSON (comments or trailing commas?), left untouched', snippet };
  }
  if (!isObj(cfg) || (cfg[c.key] !== undefined && !isObj(cfg[c.key]))) return { client: c, file, action: 'skipped', reason: `unexpected "${c.key}" in this file, left untouched`, snippet };
  const servers = (cfg[c.key] ?? {}) as Record<string, unknown>;
  const before = servers[SERVER_NAME];
  if (!entry) {
    if (before === undefined) return { client: c, file, action: 'absent' };
    delete servers[SERVER_NAME];
    if (!Object.keys(servers).length) delete cfg[c.key];
    if (!dryRun) writeAtomic(file, JSON.stringify(cfg, null, 2) + '\n');
    return { client: c, file, action: 'removed' };
  }
  const next = { ...(isObj(before) ? before : {}), ...entry };
  if (same(before, next)) return { client: c, file, action: 'unchanged' };
  cfg[c.key] = { ...servers, [SERVER_NAME]: next };
  if (!dryRun) writeAtomic(file, JSON.stringify(cfg, null, 2) + '\n');
  return { client: c, file, action: before === undefined ? 'added' : 'updated' };
}

const tomlString = (s: string) => JSON.stringify(s); // a JSON string is a valid TOML basic string
const HEADER = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:"${SERVER_NAME}"|${SERVER_NAME})\\s*\\]\\s*(#.*)?$`);

/** Replace (or append) the [mcp_servers.typetrace] table, keeping every other line and our table's other keys. */
function editToml(c: Client, file: string, entry: Record<string, unknown> | null, dryRun: boolean): Change {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = text.length ? text.replace(/\n$/, '').split('\n') : [];
  const start = lines.findIndex((l) => HEADER.test(l));
  let end = start;
  if (start >= 0) { end = start + 1; while (end < lines.length && !/^\s*\[/.test(lines[end])) end++; }
  const body = start >= 0 ? lines.slice(start + 1, end) : [];
  const kept = body.filter((l) => !/^\s*(command|args)\s*=/.test(l));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  if (!entry) {
    // Our table and its subtables ([mcp_servers.typetrace.env], ...): a subtable left behind would still declare the server.
    const ours = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:"${SERVER_NAME}"|${SERVER_NAME})(\\s*\\.[^\\]]*)?\\]`);
    const out: string[] = [];
    let skipping = false, removed = false;
    for (const l of lines) {
      if (/^\s*\[/.test(l)) { skipping = ours.test(l); removed ||= skipping; }
      if (!skipping) out.push(l);
    }
    if (!removed) return { client: c, file, action: 'absent' };
    if (!dryRun) writeAtomic(file, out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '') + '\n');
    return { client: c, file, action: 'removed' };
  }
  const table = [`[mcp_servers.${SERVER_NAME}]`, `command = ${tomlString(String(entry.command))}`, `args = [${(entry.args as string[]).map(tomlString).join(', ')}]`, ...kept];
  const out = start >= 0
    ? [...lines.slice(0, start), ...table, ...(end < lines.length ? [''] : []), ...lines.slice(end)]
    : [...lines, ...(lines.length && lines[lines.length - 1].trim() ? [''] : []), ...table];
  const next = out.join('\n') + '\n';
  if (next === (text.endsWith('\n') ? text : text + '\n') && start >= 0) return { client: c, file, action: 'unchanged' };
  if (!dryRun) writeAtomic(file, next);
  return { client: c, file, action: start >= 0 ? 'updated' : 'added' };
}

/**
 * Register (or, with `remove`, unregister) TypeTrace in each client. `launch(pinned)` gives the server command:
 * with the repository for project-scoped files, without it for global ones.
 */
export function applyClients(repo: string, clients: Client[], launch: (pinned: boolean) => Launch, opts: { dryRun?: boolean; remove?: boolean } = {}): Change[] {
  return clients.map((c) => {
    const file = c.file(repo);
    const entry = opts.remove ? null : entryFor(c, launch(c.scope === 'project'));
    return c.format === 'toml' ? editToml(c, file, entry, !!opts.dryRun) : editJson(c, file, entry, !!opts.dryRun);
  });
}

/** "Cursor        .cursor/mcp.json   added" — paths inside the repository are shown relative to it, others with ~. */
export function describe(repo: string, ch: Change): string {
  const shown = ch.file.startsWith(repo + path.sep) ? path.relative(repo, ch.file) : ch.file.replace(home(), '~');
  const head = `  ${ch.client.name.padEnd(26)} ${shown.padEnd(34)} ${ch.action}${ch.reason ? `: ${ch.reason}` : ''}`;
  const tail = [ch.action === 'skipped' && ch.snippet ? `    add this by hand:\n${ch.snippet.replace(/^/gm, '      ')}` : '', ch.client.note && ['added', 'updated', 'unchanged'].includes(ch.action) ? `    ${ch.client.note}` : ''].filter(Boolean);
  return [head, ...tail].join('\n');
}
