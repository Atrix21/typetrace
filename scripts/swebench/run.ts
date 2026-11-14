#!/usr/bin/env tsx
/**
 * Experiment 05: retrieval head-to-head on SWE-bench Lite (Python). Protocol: experiments/05-swebench-python/protocol.md.
 *
 *   npx tsx scripts/swebench/run.ts --out experiments/05-swebench-python/results [--methods a,b] [--only id,id] [--limit N]
 *
 * Per instance: check out the repository at base_commit, derive ground truth from the gold patch (syntactic declaration
 * index only), build the Python graph, then prepare + query every method with the same budget and score with the same
 * metrics as experiment 3. Resumable: (instance, method) rows in metrics.jsonl are skipped.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { abs, listCorpusFiles } from '../../src/config.js';
import { validateTasks } from '../../src/evaluation/ground-truth.js';
import { REGISTRY } from '../../src/evaluation/methods.js';
import { computeTaskMetrics } from '../../src/evaluation/metrics.js';
import { normaliseOutput } from '../../src/evaluation/normalise.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import { countTokens } from '../../src/evaluation/token-accounting.js';
import { initLanguages } from '../../src/languages/registry.js';
import { buildPythonGraph, pythonDeclarations } from '../../src/languages/python.js';
import { EmbeddingRetriever } from '../../src/retrieval/embeddings.js';
import { clearGraphCache, primeGraphCache } from '../../src/retrieval/graph-retrieval.js';
import type { Corpus, GroundTruthTask } from '../../src/types.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = abs(arg('out', 'experiments/05-swebench-python/results')!);
export const SWE_METHODS = ['bm25', 'embeddings', 'hybrid_nograph', 'hybrid', 'compact_graph', 'custom_graph', 'graphify', 'code_review_graph', 'code_review_graph_emb'];
const METHODS = (arg('methods') ?? SWE_METHODS.join(',')).split(',');
const ONLY = arg('only')?.split(',');
const LIMIT = Number(arg('limit', '0'));
const BUDGET = { maxResults: 50, maxContextTokens: 8000 };
const DATA = abs('.cache/swebench/lite-test.json');
const REPOS_DIR = abs('targets/swebench');

interface Instance { instance_id: string; repo: string; base_commit: string; patch: string; problem_statement: string }
const log = (s: string) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const git = (cwd: string, args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.slice(0, 400)}`);
  return r.stdout;
};

function checkout(inst: Instance): string {
  const dir = path.join(REPOS_DIR, inst.repo.replace('/', '__'));
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
    log(`cloning ${inst.repo}`);
    git(REPOS_DIR, ['clone', '-q', '--filter=blob:none', '--no-checkout', `https://github.com/${inst.repo}.git`, dir]);
  }
  git(dir, ['-c', 'advice.detachedHead=false', 'checkout', '-q', '-f', inst.base_commit]);
  git(dir, ['clean', '-q', '-fdx']);
  return dir;
}

/** Old-side changed lines per .py file of the gold patch (deleted/modified lines, and the line an insertion follows). */
export function changedOldLines(patch: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let file: string | null = null, old = 0, isNew = false;
  for (const l of patch.split('\n')) {
    if (l.startsWith('diff --git ')) { file = null; isNew = false; continue; }
    if (l.startsWith('--- ')) { isNew = l === '--- /dev/null'; const p = l.slice(4).replace(/^a\//, ''); file = !isNew && p.endsWith('.py') ? p : null; continue; }
    if (l.startsWith('+++ ')) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(l);
    if (h) { old = Number(h[1]); continue; }
    if (!file) continue;
    let s = out.get(file); if (!s) out.set(file, (s = new Set()));
    if (l.startsWith('-')) { s.add(old); old++; }
    else if (l.startsWith('+')) s.add(Math.max(1, old - 1));
    else old++;
  }
  return out;
}

export function groundTruth(root: string, patch: string): string[] {
  const keys = new Set<string>();
  for (const [file, lines] of changedOldLines(patch)) {
    const p = path.join(root, file);
    if (!fs.existsSync(p) || !lines.size) continue;
    const decls = pythonDeclarations(file, fs.readFileSync(p, 'utf8')).filter((d) => d.kind !== 'module');
    const inFile = new Set<string>();
    let moduleLevel = false;
    for (const ln of lines) {
      const enc = decls.filter((d) => d.start_line <= ln && ln <= d.end_line).sort((a, b) => (a.end_line - a.start_line) - (b.end_line - b.start_line))[0];
      if (enc) inFile.add(enc.key); else moduleLevel = true;
    }
    // module-level edits (typically imports added beside the fix) count only when no declaration in the file changed
    if (!inFile.size && moduleLevel) inFile.add(`${file}::<module>`);
    for (const k of inFile) keys.add(k);
  }
  return [...keys].sort();
}

async function main() {
  await initLanguages();
  fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
  let insts = (JSON.parse(fs.readFileSync(DATA, 'utf8')) as Instance[]).sort((a, b) => (a.repo + a.instance_id < b.repo + b.instance_id ? -1 : 1));
  if (ONLY) insts = insts.filter((i) => ONLY.includes(i.instance_id));
  if (LIMIT) insts = insts.slice(0, LIMIT);
  const mfile = path.join(OUT, 'metrics.jsonl');
  const done = new Set((fs.existsSync(mfile) ? fs.readFileSync(mfile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []).map((r) => `${r.task_id}|${r.method}`));
  const append = (f: string, o: unknown) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n');
  for (const inst of insts) {
    const pending = METHODS.filter((m) => !done.has(`${inst.instance_id}|${m}`));
    if (!pending.length) continue;
    const t0 = performance.now();
    const root = checkout(inst);
    const files = listCorpusFiles(root, [''], ['.py']);
    const gt = groundTruth(root, inst.patch);
    if (!gt.length) { append('excluded.jsonl', { task_id: inst.instance_id, reason: 'gold patch changes no existing .py declaration' }); continue; }
    const task = { task_id: inst.instance_id, split: 'test', description: inst.problem_statement, root_cause_symbols: gt, relevant_symbols: gt, relevant_files: [...new Set(gt.map((k) => k.split('::')[0]))], task_type: 'bug_localisation', repo: inst.repo } as GroundTruthTask;
    const index = new SymbolIndex(root, files);
    const bad = validateTasks([task], index).filter((i) => i.level === 'error');
    if (bad.length) { append('excluded.jsonl', { task_id: inst.instance_id, reason: `ground truth invalid: ${bad.map((b) => b.msg).join('; ')}` }); continue; }
    append('tasks.jsonl', { task_id: inst.instance_id, repo: inst.repo, base_commit: inst.base_commit, files: files.length, ground_truth: gt });
    const cacheDir = abs(`.cache/swebench/run/${inst.instance_id}`);
    const corpus: Corpus = { repoRoot: root, commit: inst.base_commit, files, cacheDir };
    clearGraphCache();
    const g = buildPythonGraph(root, files, inst.repo);
    primeGraphCache(corpus, { nodes: g.nodes, edges: g.edges, build_ms: g.build_ms, cached: true });
    EmbeddingRetriever.embeddingCacheDir = abs(`.cache/swebench/emb/${inst.repo.replace('/', '__')}`);
    append('graphs.jsonl', { task_id: inst.instance_id, nodes: g.nodes.length, edges: g.edges.length, build_ms: g.build_ms, notes: g.notes });
    for (const name of pending) {
      const m = await REGISTRY[name]();
      const ts = performance.now();
      const st = await m.prepare(corpus);
      const prep = performance.now() - ts;
      const out = await m.retrieve({ task_id: task.task_id, query: task.description }, BUDGET);
      await m.close?.();
      const norm = normaliseOutput(index, out);
      const row = { ...computeTaskMetrics(index, task, norm, { native_context_tokens: countTokens(out.context), latency_ms: out.latency_ms, llm_tokens: 0, n_results: out.results.length }), method: name, repo: inst.repo, corpus_files: files.length };
      append('metrics.jsonl', row);
      fs.appendFileSync(path.join(OUT, 'raw', `${name}.jsonl`), JSON.stringify({ task_id: task.task_id, method: name, results: out.results.slice(0, 50) }) + '\n');
      append('infra.jsonl', { task_id: task.task_id, method: name, prepare_ms: Math.round(prep), index_ms: Math.round(st.index_ms), query_ms: Math.round(out.latency_ms) });
      done.add(`${inst.instance_id}|${name}`);
    }
    fs.rmSync(cacheDir, { recursive: true, force: true }); // per-instance competitor graphs are large (django); embeddings stay cached per repository
    log(`${inst.instance_id} ${files.length} files gt=${gt.length} ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
  log('done');
}
main().catch((e) => { console.error(e); process.exit(1); });
