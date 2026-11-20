#!/usr/bin/env tsx
/**
 * E11-D07: re-score stored answers with the fixed file resolution (src/agent-eval/exp3/score.ts, resolveFile).
 *
 *   npx tsx scripts/exp11/rescore.ts --exp 10 --dir experiments/10-swebench-agents/results/main
 *   npx tsx scripts/exp11/rescore.ts --exp 11 --task T1|T2 --dir experiments/11-vendor-setups/results/pilot-T1
 *
 * Only runs that list a path the old cleaning changed are re-scored (every other run's score cannot change). Each
 * affected issue's corpus is rebuilt exactly as its experiment built it. Writes <dir>/rescore-E11-D07.jsonl with the
 * old and the new score of each re-scored run; the original runs.jsonl is never changed.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abs, listCorpusFiles } from '../../src/config.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import { grammarLanguages, initLanguages } from '../../src/languages/registry.js';
import { sourceFiles } from '../../src/product/source-files.js';
import type { GroundTruthTask } from '../../src/types.js';
import { cleanFile, normFile, parseAnswer, scoreAnswer } from '../../src/agent-eval/exp3/score.js';
import { scoreT12 } from './score.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const EXP = arg('exp')!;
const DIR = abs(arg('dir')!);
const TASK = arg('task', 'T1') as 'T1' | 'T2';
const OUT = path.join(DIR, 'rescore-E11-D07.jsonl');
const log = (s: string) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const readJsonl = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const memFreeGb = () => { const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); return m ? Number(m[1]) / 1048576 : 0; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const changes = (p: string) => cleanFile(p) !== normFile(p);

function clone(repo: string): string {
  const name = repo.replace('/', '__');
  for (const d of ['targets/swebench', 'targets/swebench-ml', 'targets/exp11']) if (fs.existsSync(path.join(abs(d), name, '.git'))) return path.join(abs(d), name);
  const dir = path.join(abs(EXP === '10' ? 'targets/swebench-ml' : 'targets/exp11'), name);
  log(`cloning ${repo}`);
  const r = spawnSync('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', `https://github.com/${repo}.git`, dir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`clone ${repo}: ${r.stderr}`);
  return dir;
}

function snapshot(repo: string, commit: string, tmp: string): string {
  const c = clone(repo);
  if (spawnSync('git', ['-C', c, 'cat-file', '-e', `${commit}^{commit}`]).status !== 0) spawnSync('git', ['-C', c, 'fetch', '-q', 'origin', commit]);
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const a = spawnSync('bash', ['-c', `git -C '${c}' archive --format=tar '${commit}' | tar -x -C '${tmp}'`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (a.status !== 0) throw new Error(`archive ${repo}@${commit}: ${a.stderr.slice(-300)}`);
  return tmp;
}

async function main() {
  const runs = readJsonl(path.join(DIR, 'runs.jsonl'));
  const key = EXP === '10' ? 'issue' : 'item';
  const need = runs.filter((r) => r.answer && (r.answer.locations ?? []).some((l: { file: string }) => changes(l.file)));
  const done = new Set(readJsonl(OUT).map((r) => r.run_id));
  const items = [...new Set(need.map((r) => r[key] as string))];
  log(`${need.length} of ${runs.length} runs can change, ${items.length} issues; ${done.size} already re-scored`);
  // Ground truth and commits, as each experiment had them.
  const meta = new Map<string, { repo: string; commit: string; gt: string[]; gtFiles: string[]; seed?: string; bench?: string }>();
  if (EXP === '10') {
    const gtOf = new Map<string, string[]>();
    for (const f of ['.cache/swebench-ml/gt-dryrun/tasks.jsonl', 'experiments/08-swebench-multilingual/results/tasks.jsonl', 'experiments/05-swebench-python/results/tasks.jsonl'])
      for (const t of readJsonl(abs(f))) { const g = typeof t.ground_truth === 'string' ? JSON.parse(t.ground_truth.replace(/'/g, '"')) : t.ground_truth; if (g?.length) gtOf.set(t.task_id, g); }
    for (const [bench, file] of [['lite', '.cache/swebench/lite-test.json'], ['ml', '.cache/swebench-ml/ml-test.json']] as const)
      for (const x of JSON.parse(fs.readFileSync(abs(file), 'utf8'))) if (gtOf.has(x.instance_id)) meta.set(x.instance_id, { repo: x.repo, commit: x.base_commit, gt: gtOf.get(x.instance_id)!, gtFiles: [...new Set(gtOf.get(x.instance_id)!.map((k) => k.split('::')[0]))], bench });
  } else {
    for (const t of readJsonl(abs('experiments/11-vendor-setups/data/tasks.jsonl'))) meta.set(t.task_id, { repo: t.repo, commit: t.base_commit, gt: t.ground_truth, gtFiles: t.gt_files, seed: t.seed_file });
  }
  await initLanguages();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rescore-'));
  for (const item of items) {
    const todo = need.filter((r) => r[key] === item && !done.has(r.run_id));
    if (!todo.length) continue;
    while (memFreeGb() < 5) { log('waiting for 5 GB free'); await sleep(30_000); }
    const m = meta.get(item);
    if (!m) { log(`${item}: no ground truth found, skipped`); continue; }
    const root = snapshot(m.repo, m.commit, path.join(tmp, 'snap'));
    const files = EXP === '10' && m.bench === 'lite' ? listCorpusFiles(root, [''], ['.py']) : sourceFiles(root, ['']);
    await initLanguages(grammarLanguages(files));
    const index = new SymbolIndex(root, files);
    for (const r of todo) {
      let before: Record<string, unknown>, after: Record<string, unknown>;
      if (EXP === '10') {
        const task = { task_id: item, split: 'main', description: '', root_cause_symbols: m.gt, relevant_symbols: m.gt, relevant_files: m.gtFiles, task_type: 'bug_localisation', repo: m.repo } as unknown as GroundTruthTask;
        const s = scoreAnswer(index, task, parseAnswer(r.answer));
        const pick = (o: any) => ({ task_score: o.task_score, rc_at_1: o.rc_at_1, rc_at_3: o.rc_at_3, rc_any: o.rc_any, recall: o.recall, precision: o.precision });
        before = pick(r.score); after = pick(s);
      } else {
        const s = scoreT12(index, { id: item, task: TASK, repo: m.repo, prompt: '', gt: m.gt, gtFiles: m.gtFiles, seed: m.seed }, r.answer, 'pilot');
        before = { primary: r.score.primary, accuracy: r.score.accuracy, top1: r.score.top1, file_recall: r.score.file_recall, function_recall: r.score.function_recall };
        after = { primary: s.primary, accuracy: s.accuracy, top1: s.top1, file_recall: s.file_recall, function_recall: s.function_recall };
      }
      fs.appendFileSync(OUT, JSON.stringify({ run_id: r.run_id, item, arm: r.arm, before, after, changed: JSON.stringify(before) !== JSON.stringify(after) }) + '\n');
    }
    log(`${item} (${m.repo}): ${todo.length} runs re-scored`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const out = readJsonl(OUT);
  log(`done: ${out.length} re-scored, ${out.filter((r) => r.changed).length} changed`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
