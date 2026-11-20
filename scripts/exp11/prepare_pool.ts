#!/usr/bin/env tsx
/**
 * Experiment 11: derive the ground truth of the multi-file pool, in the frozen pool order (pool-order.json).
 *
 *   npx tsx scripts/exp11/prepare_pool.ts [--valid N] [--only id,id]
 *
 * Per instance, in order, until N instances are valid (default 800: 2 pilots of 30 and 2 tasks at the cap of 250,
 * plus a margin for the size and per-repository caps):
 *   1. check out the repository at base_commit (blobless clone, reused across instances);
 *   2. the corpus is the product's own file selection (src/product/source-files.ts), as in experiment 8;
 *   3. the corpus size is recorded; the size cap is applied when T1 and T2 are assigned (assign_pool.py), once the
 *      sizes and index build times are known (the largest corpus experiment 10 indexed had 18,812 files);
 *   4. ground truth from the gold patch with experiment 8's rule (copied below unchanged): the innermost enclosing
 *      declaration of each changed line; module level only when no declaration in that file changed;
 *   5. valid only when the ground truth spans at least 2 corpus files (the protocol's multi-file rule);
 *   6. T2's seed file: the ground-truth file with the most changed lines in the gold patch, ties by path.
 *
 * Output (experiments/11-vendor-setups/data/): tasks.jsonl (valid), excluded.jsonl (with the reason). Resumable:
 * instances already in either file are skipped. Problem statements and patches stay in .cache (not committed).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { abs } from '../../src/config.js';
import { validateTasks } from '../../src/evaluation/ground-truth.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import { grammarLanguages, headerLang, initLanguages, langOf } from '../../src/languages/registry.js';
import { languageSummary, sourceFiles } from '../../src/product/source-files.js';
import type { GroundTruthTask } from '../../src/types.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const WANT = Number(arg('valid', '800'));
const ONLY = arg('only')?.split(',');
const OUT = abs('experiments/11-vendor-setups/data');
const CLONES = abs('targets/exp11');
// Clones made by earlier experiments are reused (same repositories, any commit can be checked out).
const EARLIER = [abs('targets/swebench'), abs('targets/swebench-ml')];

interface Instance { instance_id: string; repo: string; base_commit: string; patch: string; language: string; source: string; modified_nodes?: string }
const log = (s: string) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const git = (cwd: string, args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.slice(0, 400)}`);
  return r.stdout;
};

function checkout(inst: Instance): string {
  const name = inst.repo.replace('/', '__');
  const dir = [...EARLIER.map((d) => path.join(d, name)), path.join(CLONES, name)].find((d) => fs.existsSync(path.join(d, '.git'))) ?? path.join(CLONES, name);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(CLONES, { recursive: true });
    log(`cloning ${inst.repo}`);
    git(CLONES, ['clone', '-q', '--filter=blob:none', '--no-checkout', `https://github.com/${inst.repo}.git`, dir]);
  }
  try { git(dir, ['cat-file', '-e', `${inst.base_commit}^{commit}`]); } catch { git(dir, ['fetch', '-q', 'origin', inst.base_commit]); }
  git(dir, ['-c', 'advice.detachedHead=false', 'checkout', '-q', '-f', inst.base_commit]);
  git(dir, ['clean', '-q', '-fdx']);
  return dir;
}

// ---- experiment 8's rule, copied unchanged from scripts/swebench/multilingual.ts (that script runs on import) ----

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

// ---- end of the copied rule ----

/** Added plus deleted lines per file of the patch (the seed-file rule). */
export function changedLineCounts(patch: string): Map<string, number> {
  const out = new Map<string, number>();
  let file: string | null = null;
  for (const l of patch.split('\n')) {
    if (l.startsWith('diff --git ')) { file = /^diff --git a\/(\S+) b\//.exec(l)?.[1] ?? null; continue; }
    if (l.startsWith('--- ') || l.startsWith('+++ ') || !file) continue;
    if ((l.startsWith('+') || l.startsWith('-'))) out.set(file, (out.get(file) ?? 0) + 1);
  }
  return out;
}

export function seedFile(gtFiles: string[], counts: Map<string, number>): string {
  return [...gtFiles].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : 1))[0];
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const order: { id: string; language: string }[] = JSON.parse(fs.readFileSync(abs('experiments/11-vendor-setups/pool-order.json'), 'utf8')).order;
  const byId = new Map<string, Instance>();
  for (const f of ['swebench-full.json', 'polybench.json']) for (const r of JSON.parse(fs.readFileSync(abs(`.cache/exp11/${f}`), 'utf8')) as Instance[]) byId.set(r.instance_id, r);
  const read = (f: string) => (fs.existsSync(path.join(OUT, f)) ? fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const valid = new Set(read('tasks.jsonl').map((r) => r.task_id));
  const seen = new Set([...valid, ...read('excluded.jsonl').map((r) => r.task_id)]);
  const append = (f: string, o: unknown) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n');
  for (const [pos, o] of order.entries()) {
    if (valid.size >= WANT && !ONLY) break;
    if (ONLY ? !ONLY.includes(o.id) : seen.has(o.id)) continue;
    const inst = byId.get(o.id)!;
    const t0 = performance.now();
    const exclude = (reason: string, extra: Record<string, unknown> = {}) => { append('excluded.jsonl', { task_id: inst.instance_id, position: pos, repo: inst.repo, language: o.language, reason, ...extra }); seen.add(inst.instance_id); log(`${inst.instance_id}: excluded (${reason})`); };
    let root: string;
    try { root = checkout(inst); } catch (e) { exclude(`checkout failed: ${(e as Error).message.slice(0, 200)}`); continue; }
    const files = sourceFiles(root, ['']);
    await initLanguages(grammarLanguages(files));
    const index = new SymbolIndex(root, files);
    const gt = groundTruth(index, new Set(files), inst.patch);
    const gtFiles = [...new Set(gt.map((k) => k.split('::')[0]))].sort();
    if (!gt.length) { exclude('gold patch changes no existing declaration in a corpus file', { files: files.length }); continue; }
    if (gtFiles.length < 2) { exclude('ground truth spans 1 corpus file', { files: files.length, gt_size: gt.length }); continue; }
    const task = { task_id: inst.instance_id, split: 'test', description: (inst as Instance & { problem_statement: string }).problem_statement, root_cause_symbols: gt, relevant_symbols: gt, relevant_files: gtFiles, task_type: 'bug_localisation', repo: inst.repo } as GroundTruthTask;
    const bad = validateTasks([task], index).filter((i) => i.level === 'error');
    if (bad.length) { exclude(`ground truth invalid: ${bad.map((b) => b.msg).join('; ')}`); continue; }
    const counts = changedLineCounts(inst.patch);
    const hdr = headerLang(files);
    append('tasks.jsonl', {
      task_id: inst.instance_id, position: pos, source: inst.source, repo: inst.repo, language: o.language, base_commit: inst.base_commit,
      files: files.length, languages: languageSummary(files), gt_languages: [...new Set(gt.map((k) => langOf(k.split('::')[0], hdr)?.name ?? '?'))].sort(),
      ground_truth: gt, gt_files: gtFiles, seed_file: seedFile(gtFiles, counts), changed_lines: Object.fromEntries(gtFiles.map((f) => [f, counts.get(f) ?? 0])),
      polybench_nodes: inst.modified_nodes ? (JSON.parse(inst.modified_nodes) as string[]).length : null,
    });
    valid.add(inst.instance_id); seen.add(inst.instance_id);
    log(`${inst.instance_id} [${o.language}] ${files.length} files gt=${gt.length} in ${gtFiles.length} files (${valid.size}/${WANT}) ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
  log(`done: ${valid.size} valid`);
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
