/**
 * The PyPI packages (python/): every version equals the npm package's (the PyPI package runs that exact npm version),
 * the aliases pin `typetrace` to it, server.json lists both registries at it, and the PyPI README carries the MCP
 * Registry ownership line. TYPETRACE_LAUNCH (set by the PyPI launcher) decides the command written to MCP entries.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const toml = (d: string) => fs.readFileSync(path.join(ROOT, 'python', d, 'pyproject.toml'), 'utf8');
const field = (t: string, k: string) => new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm').exec(t)?.[1];

describe('PyPI packages', () => {
  it('have the npm version, and the aliases pin typetrace to it', () => {
    for (const d of ['typetrace', 'typetrace-cli', 'typetrace-mcp']) {
      expect(field(toml(d), 'name')).toBe(d);
      expect(field(toml(d), 'version')).toBe(pkg.version);
    }
    for (const a of ['cli', 'mcp']) {
      expect(toml(`typetrace-${a}`)).toContain(`dependencies = ["typetrace==${pkg.version}"]`);
      expect(toml(`typetrace-${a}`)).toContain(`typetrace-${a} = "typetrace.__main__:main"`);
    }
    expect(toml('typetrace')).toContain('typetrace = "typetrace.__main__:main"');
    expect(toml('typetrace')).toContain('nodejs-wheel-binaries>=22.13');
  });

  it('are listed in server.json with the same version, and the README proves the registry name', () => {
    const server = JSON.parse(fs.readFileSync(path.join(ROOT, 'server.json'), 'utf8'));
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages.map((p: any) => [p.registryType, p.identifier, p.version])).toEqual([['npm', 'typetrace-cli', pkg.version], ['pypi', 'typetrace', pkg.version]]);
    expect(fs.readFileSync(path.join(ROOT, 'python', 'typetrace', 'README.md'), 'utf8')).toContain(`mcp-name: ${pkg.mcpName}`);
  });
});

describe('TYPETRACE_LAUNCH', () => {
  const install = (env: Record<string, string>) => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-launch-'));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'typetrace.js'), 'install', repo, '--client', 'claude', '--no-setup'], {
      encoding: 'utf8', env: { ...process.env, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tt-launch-home-')), ...env },
    });
    return { r, repo, entry: fs.existsSync(path.join(repo, '.mcp.json')) ? JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers.typetrace : null };
  };

  it('sets the command MCP entries start the server with', () => {
    const { r, repo, entry } = install({ TYPETRACE_LAUNCH: JSON.stringify(['uvx', 'typetrace==9.9.9']) });
    expect(r.status, r.stderr).toBe(0);
    expect(entry).toEqual({ command: 'uvx', args: ['typetrace==9.9.9', 'serve', repo] });
  }, 60_000);

  it('rejects a value that is not a JSON array of strings', () => {
    const { r } = install({ TYPETRACE_LAUNCH: 'uvx typetrace' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/TYPETRACE_LAUNCH must be a JSON array/);
  }, 60_000);
});
