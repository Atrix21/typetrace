/**
 * MCP client registration (src/product/clients.ts): every supported tool's file format, merging into existing
 * configuration without touching anything else, refusing files that are not plain JSON, Codex TOML, dry runs and
 * removal. HOME and PATH point at empty temp directories, so nothing on this machine is read or written.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyClients, CLIENTS, selectClients, type Launch } from '../../src/product/clients.js';

let repo: string, home: string;
const saved = { HOME: process.env.HOME, PATH: process.env.PATH, CODEX_HOME: process.env.CODEX_HOME };
const launch = (pinned: boolean): Launch => ({ command: '/usr/bin/node', args: ['/opt/tt/bin/typetrace.js', 'serve', ...(pinned ? [repo] : [])] });
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-cl-repo-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-cl-home-'));
  process.env.HOME = home;
  process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-cl-bin-'));
  delete process.env.CODEX_HOME;
});
afterEach(() => { process.env.HOME = saved.HOME; process.env.PATH = saved.PATH; if (saved.CODEX_HOME) process.env.CODEX_HOME = saved.CODEX_HOME; });

describe('client registration', () => {
  it('auto selects Claude Code plus the tools found on the machine', () => {
    expect(selectClients('auto').map((c) => c.id)).toEqual(['claude']);
    fs.mkdirSync(path.join(home, '.cursor'));
    fs.mkdirSync(path.join(home, '.codex'));
    fs.writeFileSync(path.join(process.env.PATH!, 'gemini'), '#!/bin/sh\n', { mode: 0o755 });
    expect(selectClients('auto').map((c) => c.id)).toEqual(['claude', 'cursor', 'codex', 'gemini']);
    expect(selectClients('none')).toEqual([]);
    expect(() => selectClients('cursor,nope')).toThrow(/unknown client nope/);
  });

  it('writes each tool in its own format: project files pinned to the repository, global ones not', () => {
    const ch = applyClients(repo, CLIENTS, launch);
    expect(ch.every((c) => c.action === 'added')).toBe(true);
    const pinned = ['/opt/tt/bin/typetrace.js', 'serve', repo];
    expect(read(path.join(repo, '.mcp.json')).mcpServers.typetrace).toEqual({ command: '/usr/bin/node', args: pinned });
    expect(read(path.join(repo, '.cursor', 'mcp.json')).mcpServers.typetrace.args).toEqual(pinned);
    expect(read(path.join(repo, '.vscode', 'mcp.json')).servers.typetrace).toEqual({ type: 'stdio', command: '/usr/bin/node', args: pinned });
    expect(read(path.join(repo, '.gemini', 'settings.json')).mcpServers.typetrace.args).toEqual(pinned);
    expect(read(path.join(repo, 'opencode.json')).mcp.typetrace).toEqual({ type: 'local', command: ['/usr/bin/node', ...pinned], enabled: true });
    expect(read(path.join(repo, '.kiro', 'settings', 'mcp.json')).mcpServers.typetrace.args).toEqual(pinned);
    expect(fs.readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')).toBe(`[mcp_servers.typetrace]\ncommand = "/usr/bin/node"\nargs = ["/opt/tt/bin/typetrace.js", "serve", ${JSON.stringify(repo)}]\n`);
    expect(read(path.join(home, '.codeium', 'windsurf', 'mcp_config.json')).mcpServers.typetrace.args).toEqual(['/opt/tt/bin/typetrace.js', 'serve']);
    expect(read(path.join(home, '.config', 'zed', 'settings.json')).context_servers.typetrace.args).toEqual(['/opt/tt/bin/typetrace.js', 'serve']);
    // Idempotent.
    expect(applyClients(repo, CLIENTS, launch).every((c) => c.action === 'unchanged')).toBe(true);
  });

  it('keeps other servers, other settings and fields added by hand to its own entry', () => {
    const f = path.join(repo, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(f));
    fs.writeFileSync(f, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' }, typetrace: { command: 'old', args: [], env: { A: '1' } } } }));
    const [c] = applyClients(repo, selectClients('cursor'), launch);
    expect(c.action).toBe('updated');
    expect(read(f)).toEqual({ theme: 'dark', mcpServers: { other: { command: 'x' }, typetrace: { command: '/usr/bin/node', args: ['/opt/tt/bin/typetrace.js', 'serve', repo], env: { A: '1' } } } });
  });

  it('never rewrites a file that is not plain JSON, and prints the entry to add instead', () => {
    const f = path.join(home, '.config', 'zed', 'settings.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const text = '// Zed settings\n{\n  "theme": "One Dark", // mine\n}\n';
    fs.writeFileSync(f, text);
    const [c] = applyClients(repo, selectClients('zed'), launch);
    expect(c.action).toBe('skipped');
    expect(c.snippet).toContain('"context_servers"');
    expect(fs.readFileSync(f, 'utf8')).toBe(text);
  });

  it('Codex: replaces only its own table (keeping its other keys and subtables); removal also takes its subtables', () => {
    const f = path.join(repo, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(f));
    fs.writeFileSync(f, ['model = "o4"', '', '[mcp_servers.typetrace]', 'command = "old"', 'args = ["x"]', 'startup_timeout_sec = 30', '', '[mcp_servers.typetrace.env]', 'A = "1"', '', '[mcp_servers.other]', 'command = "y"', ''].join('\n'));
    const [c] = applyClients(repo, selectClients('codex'), launch);
    expect(c.action).toBe('updated');
    expect(fs.readFileSync(f, 'utf8')).toBe(['model = "o4"', '', '[mcp_servers.typetrace]', 'command = "/usr/bin/node"', `args = ["/opt/tt/bin/typetrace.js", "serve", ${JSON.stringify(repo)}]`, 'startup_timeout_sec = 30', '', '[mcp_servers.typetrace.env]', 'A = "1"', '', '[mcp_servers.other]', 'command = "y"', ''].join('\n'));
    applyClients(repo, selectClients('codex'), launch, { remove: true });
    expect(fs.readFileSync(f, 'utf8')).toBe(['model = "o4"', '', '[mcp_servers.other]', 'command = "y"', ''].join('\n'));
  });

  it('dry run writes nothing; removal takes out only its own entry', () => {
    expect(applyClients(repo, CLIENTS, launch, { dryRun: true }).every((c) => c.action === 'added')).toBe(true);
    expect(fs.readdirSync(repo)).toEqual([]);
    const f = path.join(repo, '.mcp.json');
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    applyClients(repo, selectClients('claude'), launch);
    const [r] = applyClients(repo, selectClients('claude'), launch, { remove: true });
    expect(r.action).toBe('removed');
    expect(read(f)).toEqual({ mcpServers: { other: { command: 'x' } } });
    expect(applyClients(repo, selectClients('claude'), launch, { remove: true })[0].action).toBe('absent');
  });
});
