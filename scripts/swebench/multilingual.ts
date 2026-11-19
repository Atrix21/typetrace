#!/usr/bin/env tsx
/**
 * Experiment 08: retrieval head-to-head on SWE-bench Multilingual (Java, Rust, Go, PHP, Ruby, C, C++, JavaScript,
 * TypeScript). Protocol: experiments/08-swebench-multilingual/protocol.md. Same procedure as experiment 05 (Python),
 * generalised to every language the product indexes:
 *
 *   npx tsx scripts/swebench/multilingual.ts --out experiments/08-swebench-multilingual/results [--methods a,b] [--only id,id] [--limit N] [--gt-only]
 *
 * Per instance: check out the repository at base_commit; the corpus is the product's own file selection
 * (src/product/source-files.ts); ground truth is derived from the gold patch with the syntactic declaration index
 * only; then every method is prepared and queried with the same budget and scored with the same metrics.
 * Resumable: (instance, method) rows already in metrics.jsonl are skipped. --gt-only derives ground truth and stops
 * (the pre-registered dry run; no retrieval method runs).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { abs } from '../../src/config.js';
import { validateTasks } from '../../src/evaluation/ground-truth.js';
import { REGISTRY } from '../../src/evaluation/methods.js';
import { computeTaskMetrics } from '../../src/evaluation/metrics.js';
import { normaliseOutput } from '../../src/evaluation/normalise.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import { countTokens } from '../../src/evaluation/token-accounting.js';
import { buildGraph } from '../../src/graph/graph-builder.js';
import { grammarLanguages, headerLang, initLanguages, langOf } from '../../src/languages/registry.js';
import { languageSummary, sourceFiles } from '../../src/product/source-files.js';
import { EmbeddingRetriever } from '../../src/retrieval/embeddings.js';
import { clearGraphCache, primeGraphCache } from '../../src/retrieval/graph-retrieval.js';
import type { Corpus, GroundTruthTask } from '../../src/types.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = abs(arg('out', 'experiments/08-swebench-multilingual/results')!);
export const ML_METHODS = ['bm25', 'embeddings', 'hybrid_nograph', 'hybrid', 'compact_graph', 'custom_graph', 'graphify', 'code_review_graph', 'code_review_graph_emb'];
const METHODS = (arg('methods') ?? ML_METHODS.join(',')).split(',');
const ONLY = arg('only')?.split(',');
const LIMIT = Number(arg('limit', '0'));
const GT_ONLY = process.argv.includes('--gt-only');
const BUDGET = { maxResults: 50, maxContextTokens: 8000 };
const DATA = abs('.cache/swebench-ml/ml-test.json'); // scripts/swebench/get-multilingual.sh
const REPOS_DIR = abs('targets/swebench-ml');

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

/** Old-side changed lines per file of the gold patch (deleted/modified lines, and the line an insertion follows). */
export function changedOldLines(patch: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let file: string | null = null, old = 0;
  for (const l of patch.split('\n')) {
    if (l.startsWith('diff --git ')) { file = null; continue; }
    if (l.startsWith('--- ')) { const p = l.slice(4).replace(/^a\//, ''); file = l === '--- /dev/null' ? null : p; continue; }
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

/** Same rule as experiment 05, for every corpus file: innermost enclosing declaration; module level only when the
 *  patch changes no declaration in that file. Files outside the corpus (docs, build files, vendored code) are ignored. */
export function groundTruth(index: SymbolIndex, corpus: Set<string>, patch: string): string[] {
  const keys = new Set<string>();
  for (const [file, lines] of changedOldLines(patch)) {
    if (!corpus.has(file) || !lines.size) continue;
    const decls = (index.byFile.get(file) ?? []).filter((d) => d.kind !== 'module');
    const inFile = new Set<string>();
    let moduleLevel = false;
    for (const ln of lines) {
      const enc = decls.filter((d) => d.start_line <= ln && ln <= d.end_line).sort((a, b) => (a.end_line - a.start_line) - (b.end_line - b.start_line))[0];
      if (enc) inFile.add(enc.key); else moduleLevel = true;
    }
    if (!inFile.size && moduleLevel) inFile.add(`${file}::<module>`);
    for (const k of inFile) keys.add(k);
  }
  return [...keys].sort();
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
  let insts = (JSON.parse(fs.readFileSync(DATA, 'utf8')) as Instance[]).sort((a, b) => (a.repo + a.instance_id < b.repo + b.instance_id ? -1 : 1));
  if (ONLY) insts = insts.filter((i) => ONLY.includes(i.instance_id));
  if (LIMIT) insts = insts.slice(0, LIMIT);
  const mfile = path.join(OUT, 'metrics.jsonl');
  const done = new Set((fs.existsSync(mfile) ? fs.readFileSync(mfile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []).map((r) => `${r.task_id}|${r.method}`));
  const append = (f: string, o: unknown) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n');
  const seen = new Set((fs.existsSync(path.join(OUT, 'tasks.jsonl')) ? fs.readFileSync(path.join(OUT, 'tasks.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).task_id) : []));
  for (const inst of insts) {
    const pending = GT_ONLY ? [] : METHODS.filter((m) => !done.has(`${inst.instance_id}|${m}`));
    if (!GT_ONLY && !pending.length) continue;
    const t0 = performance.now();
    const root = checkout(inst);
    const files = sourceFiles(root, ['']);
    await initLanguages(grammarLanguages(files));
    const index = new SymbolIndex(root, files);
    const gt = groundTruth(index, new Set(files), inst.patch);
    const hdr = headerLang(files);
    const langs = [...new Set(gt.map((k) => langOf(k.split('::')[0], hdr)?.name ?? '?'))].sort();
    if (!gt.length) { if (!seen.has(inst.instance_id)) append('excluded.jsonl', { task_id: inst.instance_id, repo: inst.repo, reason: 'gold patch changes no existing declaration in a corpus file' }); seen.add(inst.instance_id); continue; }
    const task = { task_id: inst.instance_id, split: 'test', description: inst.problem_statement, root_cause_symbols: gt, relevant_symbols: gt, relevant_files: [...new Set(gt.map((k) => k.split('::')[0]))], task_type: 'bug_localisation', repo: inst.repo } as GroundTruthTask;
    const bad = validateTasks([task], index).filter((i) => i.level === 'error');
    if (bad.length) { if (!seen.has(inst.instance_id)) append('excluded.jsonl', { task_id: inst.instance_id, repo: inst.repo, reason: `ground truth invalid: ${bad.map((b) => b.msg).join('; ')}` }); seen.add(inst.instance_id); continue; }
    if (!seen.has(inst.instance_id)) append('tasks.jsonl', { task_id: inst.instance_id, repo: inst.repo, base_commit: inst.base_commit, files: files.length, languages: languageSummary(files), gt_languages: langs, ground_truth: gt });
    seen.add(inst.instance_id);
    if (GT_ONLY) { log(`${inst.instance_id} ${files.length} files gt=${gt.length} (${langs.join(', ')})`); continue; }
    const cacheDir = abs(`.cache/swebench-ml/run/${inst.instance_id}`);
    const corpus: Corpus = { repoRoot: root, commit: inst.base_commit, files, cacheDir };
    clearGraphCache();
    // Failures (decision E8-D02): a method that throws, or a competitor call over TYPETRACE_PY_TIMEOUT_MS, is recorded in
    // failures.jsonl with no metrics row, and the run goes on. The instance then lacks that method and the analysis
    // leaves it out (counted per method). A failed method is retried when the run resumes.
    const fail = (method: string, stage: string, e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      append('failures.jsonl', { task_id: inst.instance_id, repo: inst.repo, method, stage, error: msg.slice(0, 2000), at: new Date().toISOString() });
      log(`FAILED ${inst.instance_id} ${method} (${stage}): ${msg.split('\n')[0].slice(0, 200)}`);
    };
    try {
      const g = buildGraph({ repoRoot: root, files, maxPackageDeclarationBytes: files.length > 5000 ? 0 : 50e6 });
      primeGraphCache(corpus, { nodes: g.nodes, edges: g.edges, build_ms: g.build_ms, cached: true });
      append('graphs.jsonl', { task_id: inst.instance_id, nodes: g.nodes.length, edges: g.edges.length, build_ms: g.build_ms, notes: g.diagnostics.notes });
    } catch (e) { fail('(graph)', 'graph build', e); }
    EmbeddingRetriever.embeddingCacheDir = abs(`.cache/swebench-ml/emb/${inst.repo.replace('/', '__')}`);
    for (const name of pending) {
      let m: Awaited<ReturnType<(typeof REGISTRY)[string]>> | null = null;
      let st: Awaited<ReturnType<NonNullable<typeof m>['prepare']>>, out: Awaited<ReturnType<NonNullable<typeof m>['retrieve']>>, prep: number;
      try {
        m = await REGISTRY[name]();
        const ts = performance.now();
        st = await m.prepare(corpus);
        prep = performance.now() - ts;
        out = await m.retrieve({ task_id: task.task_id, query: task.description }, BUDGET);
      } catch (e) { fail(name, m ? 'prepare/retrieve' : 'load', e); continue; } finally { await m?.close?.(); }
      const norm = normaliseOutput(index, out);
      const row = { ...computeTaskMetrics(index, task, norm, { native_context_tokens: countTokens(out.context), latency_ms: out.latency_ms, llm_tokens: 0, n_results: out.results.length }), method: name, repo: inst.repo, corpus_files: files.length, gt_languages: langs };
      append('metrics.jsonl', row);
      fs.appendFileSync(path.join(OUT, 'raw', `${name}.jsonl`), JSON.stringify({ task_id: task.task_id, method: name, results: out.results.slice(0, 50) }) + '\n');
      append('infra.jsonl', { task_id: task.task_id, method: name, prepare_ms: Math.round(prep), index_ms: Math.round(st.index_ms), query_ms: Math.round(out.latency_ms) });
      done.add(`${inst.instance_id}|${name}`);
    }
    fs.rmSync(cacheDir, { recursive: true, force: true });
    log(`${inst.instance_id} ${files.length} files gt=${gt.length} ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
  log('done');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
