#!/usr/bin/env tsx
/**
 * Language support report: builds the code graph (no embeddings) for each repository given, with exactly the file
 * selection the product uses, and records size, time, memory, edge counts by verification, and a seeded random
 * sample of CALLS edges (call text + resolved target) for hand-checking precision.
 *
 *   npx tsx scripts/languages/report.ts --out experiments/07-languages/results <repo-dir> [<repo-dir> ...]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildGraph } from '../../src/graph/graph-builder.js';
import { grammarLanguages, initLanguages } from '../../src/languages/registry.js';
import { languageSummary, sourceFiles } from '../../src/product/source-files.js';

const argv = process.argv.slice(2);
const oi = argv.indexOf('--out');
const OUT = oi >= 0 ? argv[oi + 1] : null;
const repos = argv.filter((a, i) => a !== '--out' && i !== oi + 1);
const SAMPLE = { static_verified: 12, semantic_inferred: 6 };

for (const repo of repos) {
  const name = path.basename(repo);
  const commit = fs.existsSync(path.join(repo, '.git')) ? fs.readFileSync(path.join(repo, '.git', 'HEAD'), 'utf8').trim() : null;
  const files = sourceFiles(repo, ['']);
  await initLanguages(grammarLanguages(files));
  const t0 = performance.now();
  const g = buildGraph({ repoRoot: repo, files });
  const ms = Math.round(performance.now() - t0);
  const calls = g.edges.filter((e) => e.type === 'CALLS');
  const by = (xs: typeof calls, k: (e: (typeof calls)[number]) => string) => Object.fromEntries([...xs.reduce((m, e) => m.set(k(e), (m.get(k(e)) ?? 0) + 1), new Map<string, number>())].sort());
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  // seeded sample: order by hash of the edge id
  const h = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
  const sample = Object.entries(SAMPLE).flatMap(([v, k]) => calls.filter((e) => e.verification === v && !e.src.startsWith('file:')).sort((a, b) => (h(a.id) < h(b.id) ? -1 : 1)).slice(0, k)
    .map((e) => ({ verification: v, how: e.extraction, at: `${e.file}:${e.line}`, call: (e as { evidence?: string }).evidence ?? '', from: nodes.get(e.src)?.qualified_name, to: `${nodes.get(e.dst)?.file}::${nodes.get(e.dst)?.qualified_name}`, confidence: e.confidence })));
  const rec = {
    repo: name, commit, languages: languageSummary(files), files: files.length, build_ms: ms, rss_mb: Math.round(process.memoryUsage().rss / 1e6),
    nodes: g.nodes.length, edges: g.edges.length, edges_by_type: by(g.edges as typeof calls, (e) => e.type), calls_by_verification: by(calls, (e) => e.verification),
    calls_by_extraction: by(calls, (e) => e.extraction), notes: g.diagnostics.notes, sample,
  };
  console.log(`${name}: ${rec.languages}; ${rec.nodes} nodes, ${rec.edges} edges, CALLS ${JSON.stringify(rec.calls_by_verification)}; ${ms} ms, ${rec.rss_mb} MB`);
  for (const n of rec.notes) console.log(`  ${n}`);
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(rec, null, 1) + '\n'); }
}
