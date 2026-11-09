#!/usr/bin/env tsx
/**
 * Experiment 3 regression gate for level S: rebuild the custom graph of the experiment-1 base snapshot and of all
 * 20 single-bug snapshots IN MEMORY (no cache is written) and compare each SHA-256 with the hash frozen by
 * experiment 1 in evaluation/results/graph-validation.json. Any difference fails the gate.
 *
 *   npx tsx scripts/exp3/regression-s.ts [--out experiments/03-graph-scale/manifests/s-graph-regression.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { abs, loadConfig } from '../../src/config.js';
import { checkoutSnapshot } from '../../src/evaluation/corpus.js';
import { buildGraph } from '../../src/graph/graph-builder.js';
import { graphHash } from '../../src/graph/graph-validator.js';

const i = process.argv.indexOf('--out');
const OUT = abs(i >= 0 ? process.argv[i + 1] : 'experiments/03-graph-scale/manifests/s-graph-regression.json');
const cfg = loadConfig();
const frozen = JSON.parse(fs.readFileSync(abs('evaluation/results/graph-validation.json'), 'utf8')).snapshots as { snapshot: string; commit: string; hash: string; nodes: number; edges: number }[];
const rows: Record<string, unknown>[] = [];
let ok = true;
try {
  for (const f of frozen) {
    const corpus = checkoutSnapshot(cfg, f.snapshot);
    const g = buildGraph({ repoRoot: corpus.repoRoot, files: corpus.files, tsconfigPath: path.join(corpus.repoRoot, 'tsconfig.json') });
    const hash = graphHash(g.nodes, g.edges);
    const same = hash === f.hash && corpus.commit === f.commit;
    ok &&= same;
    rows.push({ snapshot: f.snapshot, commit: corpus.commit, frozen_hash: f.hash, rebuilt_hash: hash, identical: same, nodes: g.nodes.length, edges: g.edges.length });
    console.error(`${same ? 'IDENTICAL' : 'DIFFERENT'} ${f.snapshot} ${hash.slice(0, 16)}`);
  }
} finally {
  checkoutSnapshot(cfg, 'base');
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generated_by: 'scripts/exp3/regression-s.ts', frozen_source: 'evaluation/results/graph-validation.json', all_identical: ok, snapshots: rows }, null, 2) + '\n');
console.log(`${ok ? 'PASS' : 'FAIL'}: ${rows.filter((r) => r.identical).length}/${rows.length} identical; wrote ${OUT}`);
if (!ok) process.exitCode = 1;
