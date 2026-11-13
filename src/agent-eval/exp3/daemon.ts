#!/usr/bin/env tsx
/**
 * Experiment 3 agent stage: per-task retrieval daemon. Loads ONE snapshot's indexes once (graph from a pre-built
 * SQLite, content-hash embedding cache, BM25) and serves both compact arms over HTTP on 127.0.0.1, so the MCP tool a
 * Claude Code run starts is a thin client with no start-up cost (L indexes take about a minute and ~5 GB to load).
 *
 *   npx tsx src/agent-eval/exp3/daemon.ts --root <corpus root> --graph <graph.sqlite> --emb-cache <dir> --cache <dir>
 * Prints one JSON line {"ready":true,"port":N,...} on stdout when ready. POST /q {"arm":"compact_graph"|"compact_nograph","query":"…"}
 * -> {"text","tokens","listed","mentioned","latency_ms"}.
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { abs, listCorpusFiles } from '../../config.js';
import { REGISTRY } from '../../evaluation/methods.js';
import { countTokens } from '../../evaluation/token-accounting.js';
import { loadGraph } from '../../graph/graph-store.js';
import { EmbeddingRetriever } from '../../retrieval/embeddings.js';
import { primeGraphCache } from '../../retrieval/graph-retrieval.js';
import type { Corpus, RetrievalMethod } from '../../types.js';
import { PersistentQueryEmbedder } from '../mcp/retrieval-server.js';

export const ARMS = ['compact_graph', 'compact_nograph'] as const;
export type Arm = (typeof ARMS)[number];
/** Same budget object for both arms; the compact renderer caps the output at 800 tokens. */
export const TOOL_BUDGET = { maxResults: 50, maxContextTokens: 8000 };

async function main() {
  console.log = console.error;
  const g = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const root = abs(g('root')!), graphPath = abs(g('graph')!), cacheDir = abs(g('cache')!);
  fs.mkdirSync(cacheDir, { recursive: true });
  const t0 = performance.now();
  const files = listCorpusFiles(root, ['src']);
  const corpus: Corpus = { repoRoot: root, commit: 'agent', files, cacheDir };
  const graph = loadGraph(graphPath);
  primeGraphCache(corpus, { nodes: graph.nodes, edges: graph.edges, build_ms: 0, cached: true });
  EmbeddingRetriever.embeddingCacheDir = abs(g('emb-cache')!);
  const embedder = new PersistentQueryEmbedder();
  EmbeddingRetriever.defaultQueryEmbedder = embedder;
  const methods = new Map<Arm, RetrievalMethod & { prewarmQuery?(q: string): Promise<void> }>();
  for (const a of ARMS) { const m = await REGISTRY[a](); await m.prepare(corpus); methods.set(a, m); }
  await embedder.ready;
  let chain: Promise<unknown> = Promise.resolve();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const run = async () => {
        try {
          const { arm, query } = JSON.parse(body || '{}');
          const m = methods.get(arm);
          if (!m || typeof query !== 'string' || !query.trim()) { res.writeHead(400); res.end(JSON.stringify({ error: 'bad request' })); return; }
          const t = performance.now();
          await m.prewarmQuery?.(query);
          const out = await m.retrieve({ task_id: 'agent', query }, TOOL_BUDGET);
          const text = out.context?.trim() ? out.context : 'No results.';
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ text, tokens: countTokens(text), listed: out.metadata?.listed ?? null, mentioned: out.metadata?.mentioned ?? null, latency_ms: Math.round(performance.now() - t), top: out.results.slice(0, 25).map((r) => `${r.file}::${r.symbol}`) }));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: (e as Error).message })); }
      };
      const p = chain.then(run, run); chain = p.catch(() => undefined); // serialise: retrievers keep per-query state
    });
  });
  server.listen(0, '127.0.0.1', () => {
    process.stdout.write(JSON.stringify({ ready: true, port: (server.address() as AddressInfo).port, files: files.length, nodes: graph.nodes.length, prepare_ms: Math.round(performance.now() - t0), rss_mb: Math.round(process.memoryUsage().rss / 1e6) }) + '\n');
  });
  const stop = () => { try { embedder.close(); } catch { /* */ } process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
