#!/usr/bin/env tsx
/**
 * Experiment 6 runner (no model calls, small memory). Per task: materialise the snapshot exactly as stage 1 does, build
 * the lean text + graph indexes, rank with each variant, score with the stage-1 normalisation and metric formulas.
 *
 *   npx tsx scripts/exp6/run.ts --repo S|M|L --split dev|test|all --out <dir> [--variants a,b] [--only id,id] [--build-missing]
 *
 * The variant `frozen` is the lean re-implementation of the frozen hybrid; every run compares it with the stored
 * stage-1 `hybrid` output of the same task (rows `check`). Appends to <out>/rows.jsonl; finished rows are skipped.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { abs, listCorpusFiles, loadConfig } from '../../src/config.js';
import { selectTasks } from '../../src/cli/commands.js';
import { checkoutSnapshot } from '../../src/evaluation/corpus.js';
import { loadTasks } from '../../src/evaluation/ground-truth.js';
import { normaliseOutput } from '../../src/evaluation/normalise.js';
import type { GroundTruthTask } from '../../src/types.js';
import { materialise, REPOS, type RepoName } from '../exp3/tasks.js';
import { baseSignals, contextText, FROZEN_HYBRID, LeanGraph, LeanText, readGraphJson, readGraphSqlite, VectorCache, type Ranked } from './lean.js';
import { Embedder } from '../../src/retrieval/embeddings.js';
import { VARIANTS, type Ctx } from './variants.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const REPO = arg('repo') as 'S' | 'M' | 'L';
const SPLIT = arg('split', 'dev')!;
const OUT = abs(arg('out')!);
const ONLY = arg('only')?.split(',');
const NAMES = (arg('variants') ?? Object.keys(VARIANTS).join(',')).split(',');
const BUILD_MISSING = process.argv.includes('--build-missing');
const DUMP = arg('dump');
/** Development-only query set: mined bug-fix candidates that are NOT frozen tasks, on the pinned snapshot (the fix is
 *  present in the code). Never used for a claim; it only gives design decisions more than the 23 frozen dev tasks. */
const SILVER = process.argv.includes('--silver');
/** Graph-context embeddings (direction 5): embed header+code texts into a separate content-hash cache and expose them to variants. */
const CTX = process.argv.includes('--ctx');
const repoName: RepoName | null = REPO === 'M' ? 'immich' : REPO === 'L' ? 'twenty' : null;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const memAvailGb = () => Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))![1]) / 1048576;

fs.mkdirSync(OUT, { recursive: true });
const rowsFile = path.join(OUT, 'rows.jsonl');
const done = new Set<string>();
if (fs.existsSync(rowsFile)) for (const l of fs.readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean)) { const o = JSON.parse(l); done.add(`${o.task_id}|${o.variant}`); }
const append = (o: unknown) => fs.appendFileSync(rowsFile, JSON.stringify(o) + '\n');

function graphFile(hash: string): string | null {
  for (const d of [`.cache/exp3/agent/graphs/${hash}`, `.cache/exp3/stage1/${REPO}/graphs/${hash}`, `.cache/exp6/graphs/${REPO}/${hash}`]) { const f = abs(`${d}/graph.sqlite`); if (fs.existsSync(f)) return f; }
  return null;
}
/** Same build as stage 1 (child process), gated on free memory: the machine is shared. */
function buildGraph(root: string, hash: string): string {
  // Peak RSS of a build is about 1.9 GB on M and 4 GB on L (stage-1 measurements); keep 4 GB of headroom on top.
  const need = REPO === 'L' ? 8 : 6;
  for (let waited = 0; memAvailGb() < need; waited += 60) {
    if (waited >= 1800) throw new Error(`graph ${hash} is missing and only ${memAvailGb().toFixed(1)} GB is available (need ${need} GB to build)`);
    console.error(`waiting for ${need} GB free to build graph ${hash} (${memAvailGb().toFixed(1)} GB now)`);
    spawnSync('sleep', ['60']);
  }
  const outDir = abs(`.cache/exp6/graphs/${REPO}/${hash}`); fs.mkdirSync(outDir, { recursive: true });
  const r = spawnSync('npx', ['tsx', abs('src/graph/build-cli.ts'), '--repo', root, '--out', outDir, '--include', 'src', '--max-package-decl-mb', String(REPO === 'L' ? 0 : 50), '--no-json'], { cwd: abs('.'), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=7000' }, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`graph build failed: ${(r.stderr ?? '').slice(-600)}`);
  return path.join(outDir, 'graph.sqlite');
}

function score(text: LeanText, task: GroundTruthTask, ranked: Ranked[]) {
  const norm = normaliseOutput(text.index, { task_id: task.task_id, method: 'x', results: ranked.map((r) => ({ file: r.file, symbol: r.symbol, start_line: r.start_line, end_line: r.end_line, score: r.score, node_type: r.node_type, raw_id: r.key })), context: '', latency_ms: 0, llm_tokens: { input: 0, output: 0 } } as never);
  const S = norm.rankedSymbols, F = norm.rankedFiles;
  const rel = new Set(task.relevant_symbols), rc = new Set(task.root_cause_symbols), relF = new Set(task.relevant_files);
  const hits = (l: string[], k: number, s: Set<string>) => l.slice(0, k).filter((x) => s.has(x)).length;
  const rcRank = S.findIndex((x) => rc.has(x)) + 1;
  const path_ = (task as { gt_path?: string[] }).gt_path;
  return {
    sym_recall_5: hits(S, 5, rel) / rel.size, sym_recall_10: hits(S, 10, rel) / rel.size, sym_recall_20: hits(S, 20, rel) / rel.size, sym_recall_all: hits(S, S.length, rel) / rel.size,
    rc_mrr: rcRank ? 1 / rcRank : 0, rc_hit_10: rcRank && rcRank <= 10 ? 1 : 0, rc_rank: rcRank || null,
    file_recall_10: hits(F, 10, relF) / relF.size,
    path_recall_10: path_?.length ? hits(S, 10, new Set(path_)) / new Set(path_).size : null,
    top10: S.slice(0, 10),
  };
}

function storedHybrid(): Map<string, { keys: string[]; r10: number }> {
  const dir = abs(`experiments/03-graph-scale/results/stage1-${REPO}`);
  const out = new Map<string, { keys: string[]; r10: number }>();
  for (const l of fs.readFileSync(`${dir}/raw/hybrid.jsonl`, 'utf8').split('\n').filter(Boolean)) { const d = JSON.parse(l); if (d.corpus === 'full') out.set(d.task_id, { keys: d.results.map((r: any) => `${r.file}::${r.symbol}`), r10: NaN }); }
  for (const l of fs.readFileSync(`${dir}/metrics.jsonl`, 'utf8').split('\n').filter(Boolean)) { const d = JSON.parse(l); if (d.corpus === 'full' && d.method === 'hybrid' && out.has(d.task_id)) out.get(d.task_id)!.r10 = d.sym_recall_10; }
  return out;
}

async function main() {
  const cfg = loadConfig();
  const tasks = (REPO === 'S' ? selectTasks(cfg, SPLIT) : (loadTasks(abs(`experiments/03-graph-scale/dataset/v2/${repoName}`)) as (GroundTruthTask & { split: string })[]).filter((t) => 'task_id' in t && (SPLIT === 'all' || t.split === SPLIT))).filter((t) => !ONLY || ONLY.includes(t.task_id));
  const silverQ = new Map<string, Float32Array>();
  if (SILVER) {
    if (!repoName) throw new Error('--silver needs --repo M or L');
    const frozenPrs = new Set((loadTasks(abs(`experiments/03-graph-scale/dataset/v2/${repoName}`)) as { task_id?: string }[]).filter((t) => t.task_id).map((t) => t.task_id!));
    const prefix = path.relative(REPOS[repoName].root, REPOS[repoName].corpusRoot) + '/';
    const strip = (k: string) => (k.startsWith(prefix) ? k.slice(prefix.length) : k);
    tasks.length = 0;
    for (const l of fs.readFileSync(abs(`experiments/03-graph-scale/dataset/candidates/${repoName}.jsonl`), 'utf8').split('\n').filter(Boolean)) {
      const c = JSON.parse(l); const id = `${repoName}_pr${c.pr}`;
      if (frozenPrs.has(id) || (ONLY && !ONLY.includes(id))) continue;
      const rel = (c.fixed_functions as string[]).map(strip);
      tasks.push({ task_id: id, split: 'silver', task_type: 'bug_localisation', description: [c.issue_title, c.symptom_report].filter(Boolean).join('\n\n'), root_cause_symbols: rel, relevant_symbols: rel, relevant_files: [...new Set(rel.map((k) => k.split('::')[0]))], strata: { report_source: c.report_source }, snapshot: { kind: 'pinned' } } as never);
    }
    const emb = new Embedder(abs(`.cache/exp6/embeddings-silver-${REPO}`)).embed(tasks.map((t) => ({ id: t.task_id, text: t.description, kind: 'query' as const })));
    for (const [id, v] of emb.vectors) silverQ.set(id, v);
    console.error(`[${REPO}] silver: ${tasks.length} candidate queries (${emb.computed} newly embedded)`);
  }
  const stored = SILVER ? new Map<string, { keys: string[]; r10: number }>() : storedHybrid();
  const t00 = performance.now();
  const vectors = new VectorCache(abs(REPO === 'S' ? '.cache/embeddings' : `.cache/exp3/embeddings-${REPO}`));
  console.error(`[${REPO}] ${tasks.length} tasks, ${vectors.size} cached vectors loaded in ${Math.round(performance.now() - t00)} ms, rss ${Math.round(process.memoryUsage().rss / 1e6)} MB`);
  const hc = FROZEN_HYBRID();
  let cache: { hash: string; text: LeanText; graph: LeanGraph; ctxVecs?: Float32Array[] } | null = null;
  const ctxEmbedder = CTX ? new Embedder(abs(`.cache/exp6/embeddings-ctx-${REPO}`)) : null;
  let restoreCurrent: (() => void) | null = null;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { try { restoreCurrent?.(); } finally { process.exit(130); } });
  for (const t of tasks) {
    const todo = NAMES.filter((v) => !done.has(`${t.task_id}|${v}`));
    if (!todo.length) continue;
    const t0 = performance.now();
    let root: string, files: string[], hash: string, gfile: string | null, restore = () => {};
    if (REPO === 'S') {
      const corpus = checkoutSnapshot(cfg, t.task_id);
      root = corpus.repoRoot; files = corpus.files; hash = corpus.commit; gfile = path.join(corpus.cacheDir, 'custom-graph', 'graph.json');
      if (!fs.existsSync(gfile)) throw new Error(`no cached graph for ${t.task_id}`);
    } else {
      const R = REPOS[repoName!];
      const st = spawnSync('git', ['status', '--porcelain', '--', R.src], { cwd: abs(R.root), encoding: 'utf8' });
      if (st.status !== 0 || st.stdout.trim()) throw new Error(`snapshot ${R.root} is not clean — refusing to run`);
      const snap = (t as { snapshot?: { kind: string; patch?: string; apply?: string; patch_sha256?: string } }).snapshot;
      hash = sha(`${R.pinned}|${snap?.patch_sha256 ?? 'pinned'}`).slice(0, 16);
      root = abs(R.corpusRoot);
      if (cache?.hash !== hash) {
        if (snap?.kind === 'revert_fix') restore = materialise(repoName!, snap.patch!, snap.apply ?? 'exact');
        restoreCurrent = restore;
      }
      files = listCorpusFiles(root, ['src']);
      gfile = graphFile(hash);
      if (!gfile) {
        if (!BUILD_MISSING) { restore(); restoreCurrent = null; console.error(`[${REPO}] ${t.task_id}: graph ${hash} missing — skipped (use --build-missing)`); continue; }
        try { gfile = buildGraph(root, hash); } catch (e) { restore(); restoreCurrent = null; throw e; }   // never leave a reverted fix in the shared snapshot
      }
    }
    try {
      if (cache?.hash !== hash) {
        cache = null;
        const text = new LeanText(root, files, vectors);
        const graph = new LeanGraph(gfile.endsWith('.json') ? readGraphJson(gfile) : readGraphSqlite(gfile), hc.graph);
        cache = { hash, text, graph };
        if (ctxEmbedder) {
          const texts = text.chunks.map((ch) => contextText(text, graph, ch));
          const need = texts.map((x, i) => ({ id: String(i), text: x, kind: 'doc' as const })).filter((it, i) => it.text !== text.chunks[i].text);
          const e = ctxEmbedder.embed(need);
          cache.ctxVecs = text.chunks.map((_, i) => e.vectors.get(String(i)) ?? text.vecs[i]);
          console.error(`[${REPO}] ctx: ${need.length}/${texts.length} chunks have graph context, ${e.computed} newly embedded`);
        }
      }
    } finally { restore(); restoreCurrent = null; }
    const { text, graph, ctxVecs } = cache!;
    const prepMs = performance.now() - t0;
    if (SILVER) {   // keep the fixed functions that still exist under the same key in the pinned snapshot
      const rel = t.relevant_symbols.filter((k) => text.index.byKey.has(k));
      if (!rel.length) { console.error(`[${REPO}] ${t.task_id}: no fixed function left in the pinned snapshot — skipped`); continue; }
      t.relevant_symbols = rel; t.root_cause_symbols = rel; t.relevant_files = [...new Set(rel.map((k) => k.split('::')[0]))];
    }
    const qv = silverQ.get(t.task_id) ?? vectors.get('query', t.description); if (!qv) throw new Error(`no cached query vector for ${t.task_id}`);
    const meta = { task_id: t.task_id, repo: REPO, split: (t as { split?: string }).split, task_type: (t as { task_type?: string }).task_type ?? 'bug_localisation', strata: (t as { strata?: unknown }).strata ?? null, n_relevant: t.relevant_symbols.length };
    for (const name of todo) {
      const q0 = performance.now();
      const sig = baseSignals(text, t.description, qv, hc);
      const ctx: Ctx = { text, graph, sig, cfg: hc, query: t.description, qv, ctxVecs };
      const ranked = VARIANTS[name](ctx);
      const ms = performance.now() - q0;
      const m = score(text, t, ranked);
      let check: Record<string, unknown> = {};
      if (name === 'frozen') {
        const s = stored.get(t.task_id);
        if (s) { const mine = ranked.map((r) => `${r.file}::${r.symbol}`); let p = 0; while (p < s.keys.length && p < mine.length && s.keys[p] === mine[p]) p++; check = { stored_n: s.keys.length, same_prefix: p, stored_r10: s.r10, r10_equal: Math.abs(s.r10 - m.sym_recall_10) < 1e-9 }; }
      }
      append({ ...meta, variant: name, ...m, query_ms: +ms.toFixed(1), ...check });
      if (DUMP && name === DUMP) {   // candidates with source text, for offline rerankers (contains benchmark code: keep under .cache)
        const lines = (r: Ranked) => (text.index.fileLines.get(r.file) ?? []).slice(r.start_line - 1, Math.min(r.end_line, r.start_line + 149)).join('\n');
        fs.appendFileSync(path.join(OUT, `cands-${DUMP}.jsonl`), JSON.stringify({ ...meta, query: t.description, relevant: t.relevant_symbols, root_cause: t.root_cause_symbols, relevant_files: t.relevant_files, cands: ranked.map((r) => ({ key: r.key, file: r.file, symbol: r.symbol, score: r.score, text: lines(r) })) }) + '\n');
      }
      done.add(`${t.task_id}|${name}`);
    }
    console.error(`[${REPO}] ${t.task_id} prep ${Math.round(prepMs)} ms, chunks ${text.chunks.length}, nodes ${graph.n}, rss ${Math.round(process.memoryUsage().rss / 1e6)} MB`);
  }
  if (REPO === 'S') checkoutSnapshot(cfg, 'base');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
