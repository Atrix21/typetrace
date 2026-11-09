/**
 * Experiment 3 metrics that experiment 1 did not have. They complement computeTaskMetrics (unchanged) and operate on
 * the same normalised ranked symbol list, so every method is scored identically.
 *
 *  - path recall@k: share of consecutive ground-truth path pairs (a -> b) with both a and b in the top k;
 *  - impact precision/recall/F1@k for change-impact tasks (direct + indirect impact set vs the top k);
 *  - recall within fixed token budgets (uniform rendering, as in experiment 1) at 500/800/1k/2k/4k/8k;
 *  - natural-output recall: share of relevant symbols anywhere in the method's own output.
 */
import type { GroundTruthTask, SymbolKey } from '../types.js';
import { renderSymbolUniform } from './metrics.js';
import type { NormalisedOutput } from './normalise.js';
import type { SymbolIndex } from './symbol-index.js';

export const EXP3_BUDGETS = [500, 800, 1000, 2000, 4000, 8000];

export interface TaskV2Extras {
  gt_path?: SymbolKey[];
  impact?: { direct?: SymbolKey[]; indirect?: SymbolKey[] };
}

export interface V2Metrics {
  path_recall_10: number | null;
  path_recall_all: number | null;
  impact_precision_20: number | null;
  impact_recall_20: number | null;
  impact_f1_20: number | null;
  recall_at_budget_v2: Record<string, number>;
  rc_hit_at_budget_v2: Record<string, number>;
  natural_recall: number;
  natural_rc_hit: number;
}

export function pathRecall(ranked: string[], k: number, path: SymbolKey[] | undefined): number | null {
  if (!path || path.length < 2) return null;
  const top = new Set(ranked.slice(0, k));
  let hit = 0;
  for (let i = 0; i + 1 < path.length; i++) if (top.has(path[i]) && top.has(path[i + 1])) hit++;
  return hit / (path.length - 1);
}

export function impactPRF(ranked: string[], k: number, impact: TaskV2Extras['impact']): { p: number; r: number; f1: number } | null {
  const truth = new Set([...(impact?.direct ?? []), ...(impact?.indirect ?? [])]);
  if (!truth.size) return null;
  const top = ranked.slice(0, k);
  const tp = top.filter((x) => truth.has(x)).length;
  const p = top.length ? tp / top.length : 0;
  const r = tp / truth.size;
  return { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0 };
}

export function computeV2Metrics(index: SymbolIndex, gt: GroundTruthTask & TaskV2Extras, norm: NormalisedOutput): V2Metrics {
  const S = norm.rankedSymbols;
  const rel = new Set(gt.relevant_symbols);
  const rc = new Set(gt.root_cause_symbols);
  let cum = 0;
  const cumAt: { key: string; cum: number }[] = [];
  for (const key of S) { cum += renderSymbolUniform(index, key, norm.anchorLines.get(key)).tokens; cumAt.push({ key, cum }); }
  const recallAtBudget: Record<string, number> = {};
  const rcAtBudget: Record<string, number> = {};
  for (const B of EXP3_BUDGETS) {
    const within = new Set(cumAt.filter((x) => x.cum <= B).map((x) => x.key));
    recallAtBudget[B] = [...rel].filter((k) => within.has(k)).length / rel.size;
    rcAtBudget[B] = [...rc].some((k) => within.has(k)) ? 1 : 0;
  }
  const all = new Set(S);
  const imp = impactPRF(S, 20, gt.impact);
  return {
    path_recall_10: pathRecall(S, 10, gt.gt_path),
    path_recall_all: pathRecall(S, S.length, gt.gt_path),
    impact_precision_20: imp?.p ?? null,
    impact_recall_20: imp?.r ?? null,
    impact_f1_20: imp?.f1 ?? null,
    recall_at_budget_v2: recallAtBudget,
    rc_hit_at_budget_v2: rcAtBudget,
    natural_recall: [...rel].filter((k) => all.has(k)).length / rel.size,
    natural_rc_hit: [...rc].some((k) => all.has(k)) ? 1 : 0,
  };
}
