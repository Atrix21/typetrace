/**
 * Experiment 11: scoring of T1 and T2 answers (T3 is judged by judge.ts). Shared by the runner and rescore.ts.
 * Primary: T1 function recall; T2 file recall (code-review-graph's own unit). Accuracy: T1 a changed function in the
 * first three; T2 another changed file among the first three listed files other than the seed.
 * Files and locations are resolved with resolveFile (E11-D07: the path as given wins when it is a corpus file).
 */
import type { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import type { GroundTruthTask } from '../../src/types.js';
import { normFile, parseAnswer, resolveFile, scoreAnswer } from '../../src/agent-eval/exp3/score.js';

export interface ScoredItem { id: string; task: 'T1' | 'T2'; repo: string; prompt: string; gt: string[]; gtFiles: string[]; seed?: string }

export function scoreT12(index: SymbolIndex, it: ScoredItem, raw: unknown, split: string) {
  const answer = parseAnswer(raw);
  const gt = it.task === 'T2' ? it.gt.filter((k) => k.split('::')[0] !== it.seed) : it.gt;
  const gtFiles = it.task === 'T2' ? it.gtFiles.filter((f) => f !== it.seed) : it.gtFiles;
  const task = { task_id: it.id, split, description: it.prompt, root_cause_symbols: gt, relevant_symbols: gt, relevant_files: gtFiles, task_type: 'bug_localisation', repo: it.repo } as GroundTruthTask;
  const s = scoreAnswer(index, task, answer);
  const listed = [...new Set((answer?.locations ?? []).map((l) => (index ? resolveFile(index, l.file) : normFile(l.file))))].filter((f) => !(it.task === 'T2' && f === it.seed));
  const fileRecall = gtFiles.filter((f) => listed.includes(f)).length / gtFiles.length;
  const fileAt3 = listed.slice(0, 3).some((f) => gtFiles.includes(f)) ? 1 : 0;
  return {
    ...s, file_recall: fileRecall, file_at_3: fileAt3, function_recall: s.recall,
    primary: answer ? (it.task === 'T1' ? s.recall : fileRecall) : 0,
    accuracy: answer ? (it.task === 'T1' ? s.rc_at_3 : fileAt3) : 0,
    top1: answer ? s.rc_at_1 : 0, gt_size: gt.length, gt_files: gtFiles.length,
  };
}
