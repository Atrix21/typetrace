/**
 * The three 0.4 tools end to end through the real CLI and MCP server (no embedding model: --no-embed): listed beside
 * find_relevant_code, answering from the index, and the matching CLI commands. HOME and TYPETRACE_CACHE are temp
 * directories.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PROJECT_ROOT } from '../../src/config.js';
import { FIXTURE } from '../graph/helpers.js';

const BIN = path.join(PROJECT_ROOT, 'bin', 'typetrace.js');
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
let repo: string, env: Record<string, string>, client: Client;
const cli = (...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 120_000 });
const text = (r: any) => (r.content as { text: string }[]).map((c) => c.text).join('\n');

beforeAll(async () => {
  repo = tmp('tt-cont-serve-');
  fs.cpSync(FIXTURE, repo, { recursive: true });
  env = { ...(process.env as Record<string, string>), HOME: tmp('tt-cont-home-'), TYPETRACE_CACHE: tmp('tt-cont-cache-'), TYPETRACE_AUTO_UPDATE: '0' };
  const r = cli('init', repo, '--no-embed', '--client', 'claude');
  expect(r.status, r.stderr).toBe(0);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, 'serve', repo], env, stderr: 'pipe' }));
}, 180_000);
afterAll(async () => { await client?.close(); fs.rmSync(repo, { recursive: true, force: true }); });

describe('0.4 tools over MCP', () => {
  it('are listed beside find_relevant_code', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(['find_relevant_code', 'recent_work', 'changes_since_last_session', 'codebase_overview']);
  });

  it('codebase_overview maps the fixture from its call graph', async () => {
    const out = text(await client.callTool({ name: 'codebase_overview', arguments: {} }));
    expect(out).toMatch(/indexed files/);
    expect(out).toMatch(/Most-called functions and methods:/);
  }, 60_000);

  it('recent_work and changes_since_last_session say so when there is no earlier session', async () => {
    expect(text(await client.callTool({ name: 'recent_work', arguments: {} }))).toMatch(/No earlier sessions/);
    expect(text(await client.callTool({ name: 'changes_since_last_session', arguments: {} }))).toMatch(/No earlier session/);
  }, 60_000);

  it('the CLI prints the same answers', () => {
    const r = cli('overview', repo);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Most-called functions and methods:/);
    expect(cli('recent', repo).stdout).toMatch(/No earlier sessions/);
  }, 120_000);
});
