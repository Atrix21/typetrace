#!/usr/bin/env tsx
/**
 * Experiment 3 stage 1: deterministic retrieval-only evaluation (no model calls).
 *
 *   npx tsx scripts/exp3/stage1.ts --repo S|M|L --split dev|test|all --out experiments/03-graph-scale/results/stage1-<repo>
 *       [--methods a,b] [--nested experiments/03-graph-scale/manifests/corpora-twenty.json] [--tasks <dir>] [--only id,id]
 *
 * Per task: materialise the snapshot (S: experiment-1 single-bug branch; M/L category A: pinned snapshot with the fix
 * reverted; M/L other categories: pinned snapshot), build the custom graph once in a child process (memory isolation),
 * then for each corpus (full, plus nested corpora on L) prepare and query every method with the SAME budget and
 * score with experiment 1's metrics plus the v2 metrics. Subset corpora use the INDUCED subgraph of the full graph
 * (nodes in corpus files; edges with both ends kept) and their own BM25/embedding indexes.
 * Output: <out>/raw/<method>.jsonl (outputs), <out>/metrics.jsonl, <out>/infra.jsonl, <out>/meta.json. Resumable:
 * (task, corpus, method) rows already in metrics.jsonl are skipped.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { abs, listCorpusFiles, loadConfig } from '../../src/config.js';
import { selectTasks } from '../../src/cli/commands.js';
import { checkoutSnapshot } from '../../src/evaluation/corpus.js';
import { loadTasks, validateTasks } from '../../src/evaluation/ground-truth.js';
import { REGISTRY, STAGE1_METHODS } from '../../src/evaluation/methods.js';
import { computeTaskMetrics } from '../../src/evaluation/metrics.js';
import { computeV2Metrics } from '../../src/evaluation/metrics-v2.js';
import { normaliseOutput } from '../../src/evaluation/normalise.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import { countTokens } from '../../src/evaluation/token-accounting.js';
import type { GraphEdge, GraphNode } from '../../src/graph/graph-schema.js';
import { loadGraph } from '../../src/graph/graph-store.js';
import { EmbeddingRetriever } from '../../src/retrieval/embeddings.js';
import { primeGraphCache, clearGraphCache } from '../../src/retrieval/graph-retrieval.js';
import type { Corpus, GroundTruthTask, RetrievalBudget } from '../../src/types.js';
import { materialise, REPOS, type RepoName } from './tasks.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const REPO = arg('repo') as 'S' | 'M' | 'L';
const SPLIT = arg('split', 'test')!;
const OUT = abs(arg('out')!);
const METHODS = (arg('methods') ?? STAGE1_METHODS.join(',')).split(',');
const NESTED = arg('nested');
const ONLY = arg('only')?.split(',');
const BUDGET: RetrievalBudget = { maxResults: 50, maxContextTokens: 8000 }; // experiment-1 frozen budget
// E3-D13/D15: M stubs declaration-heavy packages (> 50 MB; none in Immich); L stubs all third-party declarations
// (workspace packages, @types and the TS lib stay typed) because a fully typed Twenty walk needs > 6.5 GB and > 15 min.
const MAX_DECL_BYTES = REPO === 'L' ? 0 : 50e6;
const repoName: RepoName | null = REPO === 'M' ? 'immich' : REPO === 'L' ? 'twenty' : null;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const rss = () => Math.round(process.memoryUsage().rss / 1e6);

fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
const metricsFile = path.join(OUT, 'metrics.jsonl');
const done = new Set<string>();
if (fs.existsSync(metricsFile)) for (const l of fs.readFileSync(metricsFile, 'utf8').split('\n').filter(Boolean)) { const o = JSON.parse(l); done.add(`${o.task_id}|${o.corpus}|${o.method}`); }
const append = (f: string, o: unknown) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n');

function loadV2Tasks(): GroundTruthTask[] {
  const dir = abs(arg('tasks') ?? `experiments/03-graph-scale/dataset/v2/${repoName}`);
  const all = loadTasks(dir) as (GroundTruthTask & { split: string | null })[];
  return all.filter((t) => SPLIT === 'all' || t.split === SPLIT);
}

/** Build the custom graph of the snapshot in a child process; returns build stats (time, peak RSS, sizes). */
function buildGraphChild(root: string, outDir: string): Record<string, unknown> {
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = performance.now();
  const r = spawnSync('/usr/bin/time', ['-v', 'npx', 'tsx', abs('src/graph/build-cli.ts'), '--repo', root, '--out', outDir, '--include', 'src', '--max-package-decl-mb', String(MAX_DECL_BYTES / 1e6), '--no-json'], {
    cwd: abs('.'), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=7000' }, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`graph build failed (${r.status}): ${(r.stderr ?? '').slice(-800)}`);
  const peak = /Maximum resident set size \(kbytes\): (\d+)/.exec(r.stderr ?? '');
  const hash = /hash=([0-9a-f]{64})/.exec(r.stdout ?? '');
  return { wall_ms: Math.round(performance.now() - t0), peak_rss_mb: peak ? Math.round(Number(peak[1]) / 1000) : null, sqlite_bytes: fs.statSync(path.join(outDir, 'graph.sqlite')).size, hash: hash?.[1] ?? null };
}

/** Nodes in corpus files (plus file-less synthetic nodes touching them); edges with both endpoints kept. */
function inducedSubgraph(nodes: GraphNode[], edges: GraphEdge[], files: Set<string>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const keep = new Set(nodes.filter((n) => n.file !== null && files.has(n.file)).map((n) => n.id));
  const synthetic = new Set(nodes.filter((n) => n.file === null).map((n) => n.id));
  for (const e of edges) {
    if (keep.has(e.src) && synthetic.has(e.dst)) keep.add(e.dst);
    if (keep.has(e.dst) && synthetic.has(e.src)) keep.add(e.src);
  }
  return { nodes: nodes.filter((n) => keep.has(n.id)), edges: edges.filter((e) => keep.has(e.src) && keep.has(e.dst)) };
}

interface CorpusSpec { name: string; files: string[]; strategy: string; target_lines: number | null; lines: number | null }

async function evalCorpus(task: GroundTruthTask, spec: CorpusSpec, root: string, commit: string, full: { nodes: GraphNode[]; edges: GraphEdge[] } | null, cacheDirOverride?: string) {
  const pending = METHODS.filter((m) => !done.has(`${task.task_id}|${spec.name}|${m}`));
  if (!pending.length) return;
  const cacheDir = cacheDirOverride ?? abs(`.cache/exp3/stage1/${REPO}/${task.task_id}/${spec.name}`);
  const corpus: Corpus = { repoRoot: root, commit, files: spec.files, cacheDir };
  clearGraphCache();
  if (full) {
    const g = spec.name === 'full' ? full : inducedSubgraph(full.nodes, full.edges, new Set(spec.files));
    primeGraphCache(corpus, { nodes: g.nodes, edges: g.edges, build_ms: 0, cached: true });
  }
  const index = new SymbolIndex(root, spec.files);
  // Distractors are not scored; on a subset corpus those outside it are dropped before validation (ground-truth files are
  // in every corpus by construction, E3-D19).
  if (spec.name !== 'full' && task.distractor_symbols?.length) task = { ...task, distractor_symbols: task.distractor_symbols.filter((k) => index.byKey.has(k)) };
  const bad = validateTasks([task], index).filter((i) => i.level === 'error');
  if (bad.length) throw new Error(`ground truth invalid on ${task.task_id}/${spec.name}: ${bad.map((b) => b.msg).join('; ')}`);
  const q = { task_id: task.task_id, query: task.description };
  for (const name of pending) {
    const m = await REGISTRY[name]();
    const t0 = performance.now();
    const st = await m.prepare(corpus);
    const prepMs = performance.now() - t0;
    const out = await m.retrieve(q, BUDGET);
    await m.close?.();
    const norm = normaliseOutput(index, out);
    const base = computeTaskMetrics(index, task, norm, { native_context_tokens: countTokens(out.context), latency_ms: out.latency_ms, llm_tokens: 0, n_results: out.results.length });
    const v2 = computeV2Metrics(index, task as never, norm);
    const row = { ...base, ...v2, repo: REPO, corpus: spec.name, strategy: spec.strategy, target_lines: spec.target_lines, corpus_lines: spec.lines, corpus_files: spec.files.length, method: name, split: (task as { split?: string }).split, task_type: (task as { task_type?: string }).task_type ?? 'bug_localisation', strata: (task as { strata?: unknown }).strata ?? null };
    append('metrics.jsonl', row);
    fs.appendFileSync(path.join(OUT, 'raw', `${name}.jsonl`), JSON.stringify({ task_id: task.task_id, corpus: spec.name, method: name, results: out.results, context: out.context, latency_ms: out.latency_ms, metadata: out.metadata }) + '\n');
    const det = (st.details ?? {}) as Record<string, any>;
    append('infra.jsonl', { task_id: task.task_id, corpus: spec.name, method: name, prepare_ms: Math.round(prepMs), index_ms: Math.round(st.index_ms), query_ms: Math.round(out.latency_ms), rss_mb_after: rss(), details: { chunks: det.chunks ?? det.bm25?.chunks ?? det.base?.bm25?.chunks ?? null, newly_embedded: det.newly_embedded ?? det.embeddings?.newly_embedded ?? det.base?.embeddings?.newly_embedded ?? null, embedding_tokens: st.embedding_tokens ?? null } });
    done.add(`${task.task_id}|${spec.name}|${name}`);
  }
}

// A killed run must not leave a bug reverted into the shared snapshot.
let currentRestore: (() => void) | null = null;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { try { currentRestore?.(); } finally { process.exit(130); } });

/** The shared snapshot's source tree must equal the pinned commit (no reverted fix, no stray file). */
function assertClean() {
  const R = REPOS[repoName!];
  const r = spawnSync('git', ['status', '--porcelain', '--', R.src], { cwd: abs(R.root), encoding: 'utf8' });
  if (r.status !== 0 || r.stdout.trim()) throw new Error(`snapshot ${R.root} is not clean — refusing to run:\n${r.stdout.slice(0, 500)}`);
}

let pinnedCache: { nodes: Set<string>; edges: Set<string> } | null = null;
function pinnedIds(): { nodes: Set<string>; edges: Set<string> } {
  if (pinnedCache) return pinnedCache;
  const R = REPOS[repoName!];
  const commit = sha(`${R.pinned}|pinned`).slice(0, 16);
  const gdir = abs(`.cache/exp3/stage1/${REPO}/graphs/${commit}`);
  if (!fs.existsSync(path.join(gdir, 'graph.sqlite'))) { const b = buildGraphChild(abs(R.corpusRoot), gdir); fs.writeFileSync(path.join(gdir, 'build.json'), JSON.stringify(b)); append('graph-builds.jsonl', { task_id: '(pinned)', snapshot: 'pinned', ...b }); }
  const g = loadGraph(path.join(gdir, 'graph.sqlite'));
  pinnedCache = { nodes: new Set(g.nodes.map((n) => n.id)), edges: new Set(g.edges.map((e) => e.id)) };
  return pinnedCache;
}

async function main() {
  const cfg = loadConfig();
  EmbeddingRetriever.embeddingCacheDir = abs(`.cache/exp3/embeddings-${REPO}`);
  if (REPO === 'S') EmbeddingRetriever.embeddingCacheDir = abs('.cache/embeddings'); // experiment-1 content-hash cache
  const tasks = (REPO === 'S' ? selectTasks(cfg, SPLIT) : loadV2Tasks()).filter((t) => !ONLY || ONLY.includes(t.task_id));
  const nested = NESTED ? JSON.parse(fs.readFileSync(abs(NESTED), 'utf8')) : null;
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ repo: REPO, split: SPLIT, methods: METHODS, budget: BUDGET, tasks: tasks.map((t) => t.task_id), nested: NESTED ?? null, max_package_declaration_bytes: REPO === 'S' ? null : MAX_DECL_BYTES, started: new Date().toISOString() }, null, 2) + '\n');
  // The pinned graph must be built from the CLEAN snapshot, before any task materialises a bug (it is the graph of
  // every pinned-snapshot task and the freshness reference).
  if (REPO !== 'S') { assertClean(); pinnedIds(); }
  for (const t of tasks) {
    const pendingAny = () => METHODS.some((m) => !done.has(`${t.task_id}|full|${m}`)) || (nested?.tasks?.[t.task_id]?.corpora ?? []).some((c: any) => METHODS.some((m) => !done.has(`${t.task_id}|${c.strategy}-${c.target_lines}|${m}`)));
    if (!pendingAny()) continue;
    const t0 = performance.now();
    if (REPO === 'S') {
      const corpus = checkoutSnapshot(cfg, t.task_id);
      // experiment-1 snapshot cache dir: the frozen per-commit graph is reused (identical hashes, see regression-s.ts)
      await evalCorpus(t, { name: 'full', files: corpus.files, strategy: 'full', target_lines: null, lines: null }, corpus.repoRoot, corpus.commit, null, corpus.cacheDir);
      console.error(`[S] ${t.task_id} ${Math.round((performance.now() - t0) / 1000)}s`);
      continue;
    }
    const R = REPOS[repoName!];
    assertClean(); // a previous interruption must never leave another task's bug in the tree
    const snap = (t as { snapshot?: { kind: string; patch?: string; apply?: string; patch_sha256?: string } }).snapshot;
    const restore = snap?.kind === 'revert_fix' ? materialise(repoName!, snap.patch!, snap.apply ?? 'exact') : () => {};
    currentRestore = restore;
    try {
      const root = abs(R.corpusRoot);
      const files = listCorpusFiles(root, ['src']);
      const commit = sha(`${R.pinned}|${snap?.patch_sha256 ?? 'pinned'}`).slice(0, 16);
      const gdir = abs(`.cache/exp3/stage1/${REPO}/graphs/${commit}`); // one build per snapshot (pinned shared by B–E tasks)
      const build = fs.existsSync(path.join(gdir, 'graph.sqlite')) ? JSON.parse(fs.readFileSync(path.join(gdir, 'build.json'), 'utf8')) : buildGraphChild(root, gdir);
      fs.writeFileSync(path.join(gdir, 'build.json'), JSON.stringify(build));
      const g = loadGraph(path.join(gdir, 'graph.sqlite'));
      // Freshness: how much of the graph a bug-snapshot change touches (vs the pinned graph), i.e. what would be stale
      // without a rebuild, and how many files the change spans.
      let fresh: Record<string, unknown> = {};
      if (snap?.kind === 'revert_fix') {
        const P = pinnedIds();
        const ids = new Set(g.edges.map((e) => e.id));
        const added = g.edges.filter((e) => !P.edges.has(e.id));
        const removed = [...P.edges].filter((id) => !ids.has(id)).length;
        const nodeIds = new Set(g.nodes.map((n) => n.id));
        const changedFiles = new Set([...added.map((e) => e.file), ...g.nodes.filter((n) => !P.nodes.has(n.id)).map((n) => n.file)].filter(Boolean));
        fresh = { edges_added: added.length, edges_removed: removed, nodes_added: [...nodeIds].filter((x) => !P.nodes.has(x)).length, nodes_removed: [...P.nodes].filter((x) => !nodeIds.has(x)).length, files_with_graph_changes: changedFiles.size, stale_edge_share: +((added.length + removed) / Math.max(1, P.edges.size)).toFixed(6) };
      }
      append('graph-builds.jsonl', { task_id: t.task_id, snapshot: snap?.kind ?? 'pinned', ...build, nodes: g.nodes.length, edges: g.edges.length, freshness: fresh });
      await evalCorpus(t, { name: 'full', files, strategy: 'full', target_lines: null, lines: null }, root, commit, g);
      const fileSet = new Set(files);
      const comm = nested ? JSON.parse(fs.readFileSync(abs(nested.communities), 'utf8')) : null;
      for (const c of nested?.tasks?.[t.task_id]?.corpora ?? []) {
        const want = new Set<number>(c.communities);
        const manifestFiles = comm.communities.filter((x: any) => want.has(x.id)).flatMap((x: any) => x.files).sort();
        if (sha(manifestFiles.join('\n')) !== c.files_sha256) throw new Error(`corpus hash mismatch ${t.task_id} ${c.strategy}-${c.target_lines}`);
        const cf = manifestFiles.filter((f: string) => fileSet.has(f)); // a reverted fix may remove a file it had added
        await evalCorpus(t, { name: `${c.strategy}-${c.target_lines}`, files: cf, strategy: c.strategy, target_lines: c.target_lines, lines: c.lines }, root, commit, g);
      }
      if (snap?.kind === 'revert_fix') fs.rmSync(path.join(gdir, 'graph.sqlite'), { force: true }); // per-task bug graphs: 0.1–1.2 GB each; stats kept in graph-builds.jsonl
    } finally { restore(); currentRestore = null; }
    console.error(`[${REPO}] ${t.task_id} ${Math.round((performance.now() - t0) / 1000)}s rss ${rss()} MB`);
  }
  console.log(`done: ${done.size} (task, corpus, method) rows in ${path.relative(process.cwd(), OUT)}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); }); // helper servers must not hold the process open
