/**
 * End to end through the real CLI and MCP server (no embedding model: --no-embed):
 *   init -> serve (started inside the repository with no path, as a tool with a global configuration does) -> query
 *   -> add a file -> the server notices, rebuilds in a background job and reloads -> the new code is found.
 * HOME and TYPETRACE_CACHE are temp directories, so nothing outside them is touched.
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
let repo: string;
let env: Record<string, string>;
const cli = (...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 120_000 });

async function connect(cwd: string) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, 'serve'], cwd, env, stderr: 'pipe' }));
  const ask = async (query: string) => {
    const r = (await client.callTool({ name: 'find_relevant_code', arguments: { query } })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
  };
  return { client, ask };
}

beforeAll(() => {
  repo = tmp('tt-e2e-repo-');
  fs.cpSync(FIXTURE, repo, { recursive: true });
  env = { ...(process.env as Record<string, string>), HOME: tmp('tt-e2e-home-'), TYPETRACE_CACHE: tmp('tt-e2e-cache-'), TYPETRACE_POLL_MS: '300', TYPETRACE_QUIET_MS: '300' };
  const r = cli('init', repo, '--no-embed', '--client', 'claude');
  expect(r.status, r.stderr).toBe(0);
}, 180_000);
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('typetrace serve keeps the index current', () => {
  it('init registers the server and reports the index', () => {
    expect(JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers.typetrace.args.slice(-2)).toEqual(['serve', repo]);
    const s = cli('status', repo);
    expect(s.stderr).toMatch(/since then:\s+no changes/);
    expect(s.stderr).toMatch(/semantic search:\s+off/);
  });

  it('finds code added after the server started, without a manual re-index', async () => {
    const { client, ask } = await connect(path.join(repo, 'src')); // no path: the nearest indexed repository above
    try {
      expect((await ask('compute the refund amount for a cancelled order')).text).not.toContain('computeRefundAmount');
      fs.mkdirSync(path.join(repo, 'src', 'billing'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'src', 'billing', 'refund.service.ts'),
        'export class RefundService {\n  /** Refund for a cancelled order: the paid amount minus the cancellation fee. */\n  computeRefundAmount(paid: number, fee: number): number {\n    return Math.max(0, paid - fee);\n  }\n}\n');
      let found = '';
      for (let i = 0; i < 90 && !found.includes('computeRefundAmount'); i++) {
        await new Promise((r) => setTimeout(r, 1000));
        found = (await ask('compute the refund amount for a cancelled order')).text;
      }
      expect(found).toContain('RefundService.computeRefundAmount');
      expect(found).toContain('src/billing/refund.service.ts');
      expect(cli('status', repo).stderr).toMatch(/since then:\s+no changes/);
    } finally { await client.close(); }
  }, 150_000);

  it('started outside any indexed repository, it says so instead of answering about another one', async () => {
    const { client, ask } = await connect(tmp('tt-e2e-elsewhere-'));
    try {
      const r = await ask('anything');
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/has no index for .*typetrace-cli init/);
    } finally { await client.close(); }
  }, 60_000);
});
