#!/usr/bin/env tsx
/**
 * Experiment 3 agent stage: the `find_relevant_code` MCP tool (stdio). A thin client of the per-task daemon. The tool
 * name, description and input schema are byte-identical in both arms; only `--arm` (which index answers) differs, and the
 * agent cannot see it. Every call is logged (query, latency, returned tokens, top results).
 *   npx tsx src/agent-eval/exp3/mcp-tool.ts --port N --arm compact_graph|compact_nograph --log <jsonl>
 */
import fs from 'node:fs';
import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const EXP3_TOOL_NAME = 'find_relevant_code';
export const EXP3_SERVER_NAME = 'code-context';
export const EXP3_TOOL_DESCRIPTION = 'Find where something is implemented in this codebase. Returns a short list of functions/methods with file:line ranges and signatures (and, when known, their direct callers, callees and handlers). Read the ranges you need.';
export const EXP3_TOOL_SCHEMA = { type: 'object', properties: { query: { type: 'string', description: 'What you are looking for, in natural language or identifiers' } }, required: ['query'] } as const;

function post(port: number, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: '/q', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout: 110_000 }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('daemon timeout')));
    req.end(data);
  });
}

async function main() {
  console.log = console.error;
  const g = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const port = Number(g('port')), arm = g('arm')!, log = g('log')!;
  const server = new Server({ name: EXP3_SERVER_NAME, version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: EXP3_TOOL_NAME, description: EXP3_TOOL_DESCRIPTION, inputSchema: EXP3_TOOL_SCHEMA as never }] }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const query = (req.params.arguments as { query?: unknown } | undefined)?.query;
    if (req.params.name !== EXP3_TOOL_NAME || typeof query !== 'string' || !query.trim()) return { isError: true, content: [{ type: 'text' as const, text: 'Invalid call: "query" must be a non-empty string.' }] };
    const ts = new Date().toISOString();
    try {
      const r = await post(port, { arm, query });
      if (r.error) throw new Error(r.error);
      fs.appendFileSync(log, JSON.stringify({ ts, query, latency_ms: r.latency_ms, result_tokens: r.tokens, listed: r.listed, mentioned: r.mentioned, top: r.top }) + '\n');
      return { content: [{ type: 'text' as const, text: r.text }] };
    } catch (e) {
      fs.appendFileSync(log, JSON.stringify({ ts, query, error: (e as Error).message }) + '\n');
      return { isError: true, content: [{ type: 'text' as const, text: `Search failed: ${(e as Error).message}` }] };
    }
  });
  process.stdin.on('close', () => setTimeout(() => process.exit(0), 50).unref());
  await server.connect(new StdioServerTransport());
}
main().catch((e) => { console.error(e); process.exit(1); });
