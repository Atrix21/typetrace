#!/usr/bin/env tsx
/**
 * Experiment 6: latency and output-identity check of the PRODUCT retrieval path (REGISTRY.compact_graph and hybrid,
 * as the CLI / MCP server and the agent daemon use them) on the pinned snapshot of M or L.
 *
 *   npx tsx scripts/exp6/bench-product.ts --repo M|L --out <file.json> [--methods compact_graph,hybrid]
 *
 * Queries: the frozen tasks that run on the pinned snapshot (categories B–E), whose stage-1 outputs are stored.
 * For each task and method it reports the query latency and whether results and context text are byte-identical to
 * the stored stage-1 output. No model call: query vectors come from the content-hash cache.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { abs, listCorpusFiles } from '../../src/config.js';
import { loadTasks } from '../../src/evaluation/ground-truth.js';
import { REGISTRY } from '../../src/evaluation/methods.js';
import { loadGraph } from '../../src/graph/graph-store.js';
import { EmbeddingRetriever } from '../../src/retrieval/embeddings.js';
import { primeGraphCache } from '../../src/retrieval/graph-retrieval.js';
import type { Corpus } from '../../src/types.js';
import { REPOS } from '../exp3/tasks.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const REPO = arg('repo') as 'M' | 'L';
const METHODS = arg('methods', 'compact_graph,hybrid')!.split(',');
const repoName = REPO === 'M' ? 'immich' : 'twenty';
const R = REPOS[repoName];
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const BUDGET = { maxResults: 50, maxContextTokens: 8000 };

async function main() {
  const root = abs(R.corpusRoot);
  const tasks = (loadTasks(abs(`experiments/03-graph-scale/dataset/v2/${repoName}`)) as any[]).filter((t) => t.task_id && t.snapshot?.kind === 'pinned');
  const hash = sha(`${R.pinned}|pinned`).slice(0, 16);
  const gfile = [`.cache/exp3/agent/graphs/${hash}/graph.sqlite`, `.cache/exp3/stage1/${REPO}/graphs/${hash}/graph.sqlite`].map((p) => abs(p)).find((p) => fs.existsSync(p))!;
  const t0 = performance.now();
  const graph = loadGraph(gfile);
  const corpus: Corpus = { repoRoot: root, commit: hash, files: listCorpusFiles(root, ['src']), cacheDir: abs(`.cache/exp6/bench/${REPO}`) };
  fs.mkdirSync(corpus.cacheDir, { recursive: true });
  primeGraphCache(corpus, { nodes: graph.nodes, edges: graph.edges, build_ms: 0, cached: true });
  EmbeddingRetriever.embeddingCacheDir = abs(`.cache/exp3/embeddings-${REPO}`);
  const out: any = { repo: REPO, tasks: tasks.length, graph_load_ms: Math.round(performance.now() - t0), methods: {} };
  for (const name of METHODS) {
    const stored = new Map<string, any>();
    for (const l of fs.readFileSync(abs(`experiments/03-graph-scale/results/stage1-${REPO}/raw/${name}.jsonl`), 'utf8').split('\n').filter(Boolean)) { const d = JSON.parse(l); if (d.corpus === 'full') stored.set(d.task_id, d); }
    const m = await REGISTRY[name]();
    const p0 = performance.now();
    await m.prepare(corpus);
    const prepare_ms = Math.round(performance.now() - p0);
    const rows = [];
    for (const t of tasks) {
      const o = await m.retrieve({ task_id: t.task_id, query: t.description }, BUDGET);
      const s = stored.get(t.task_id);
      rows.push({ task_id: t.task_id, latency_ms: +o.latency_ms.toFixed(1), stored_latency_ms: s ? +s.latency_ms.toFixed(1) : null, results_identical: s ? JSON.stringify(o.results) === JSON.stringify(s.results) : null, context_identical: s ? o.context === s.context : null });
    }
    await m.close?.();
    const lat = rows.map((r) => r.latency_ms).sort((a, b) => a - b);
    out.methods[name] = { prepare_ms, median_ms: lat[Math.floor(lat.length / 2)], max_ms: lat[lat.length - 1], stored_median_ms: rows.map((r) => r.stored_latency_ms ?? 0).sort((a, b) => a - b)[Math.floor(rows.length / 2)], identical: rows.filter((r) => r.results_identical && r.context_identical).length, rows };
    console.error(`[${REPO}] ${name}: median ${out.methods[name].median_ms} ms (stored ${out.methods[name].stored_median_ms} ms), identical ${out.methods[name].identical}/${rows.length}, rss ${Math.round(process.memoryUsage().rss / 1e6)} MB`);
  }
  out.rss_mb = Math.round(process.memoryUsage().rss / 1e6);
  fs.writeFileSync(abs(arg('out')!), JSON.stringify(out, null, 1) + '\n');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
