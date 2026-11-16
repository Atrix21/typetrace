/**
 * Experiment 6: ranking variants on top of the lean engine. `frozen` is the reference (must equal the stored hybrid).
 * A variant sees only the query, the indexes and the fused base signals: never a task's ground truth.
 */
import type { HybridConfig } from '../../src/retrieval/hybrid-retrieval.js';
import { baseSignals, prior, rankFrozen, type LeanGraph, type LeanText, type Ranked, type Signals } from './lean.js';

export interface Ctx { text: LeanText; graph: LeanGraph; sig: Signals; cfg: HybridConfig; query: string; qv: Float32Array; ctxVecs?: Float32Array[] }

/** Seed selection. prior: order candidates by base x ranking prior (kind, test path); perFile: cap seeds per file. */
export function pickSeeds(c: Ctx, o: { prior?: boolean; perFile?: number; n?: number; needNode?: boolean }): [string, number][] {
  const n = o.n ?? c.cfg.graph.seeds;
  const w = (k: string) => {
    if (!o.prior) return 1;
    const node = c.graph.byKey.get(k);
    const kind = node !== undefined ? c.graph.typeName(node) : c.text.chunkByKey.get(k)?.kind ?? 'module';
    return prior(c.cfg.graph, c.graph, kind, k.split('::')[0], node ?? null);
  };
  const cand = [...c.sig.base.entries()].map(([k, s]) => [k, s, s * w(k)] as [string, number, number]).sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1));
  const perFile = new Map<string, number>(); const out: [string, number][] = [];
  for (const [k, s] of cand) {
    if (out.length >= n) break;
    if (o.needNode && !c.graph.byKey.has(k)) continue;
    const f = k.split('::')[0]; const used = perFile.get(f) ?? 0;
    if (o.perFile && used >= o.perFile) continue;
    perFile.set(f, used + 1); out.push([k, s]);
  }
  return out.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

const withSeeds = (o: Parameters<typeof pickSeeds>[1], over: Partial<HybridConfig> = {}) => (c: Ctx) => rankFrozen(c.text, c.graph, c.sig, { ...c.cfg, ...over }, 50, { seeds: pickSeeds(c, o) }).ranked;

/** Graph-context embeddings: the semantic signal uses header+code vectors ('ctx'), or the better of both per chunk ('max'), or their mean. */
const ctxVariant = (mode: 'ctx' | 'max' | 'avg', graph: boolean) => (c: Ctx): Ranked[] => {
  if (!c.ctxVecs) throw new Error('run with --ctx');
  const a = c.text.cosine(c.qv), b = c.text.cosine(c.qv, c.ctxVecs);
  const cos = mode === 'ctx' ? b : a.map((x, i) => (mode === 'max' ? Math.max(x, b[i]) : (x + b[i]) / 2));
  const sig = baseSignals(c.text, c.query, c.qv, c.cfg, cos);
  return rankFrozen(c.text, graph ? c.graph : null, sig, graph ? c.cfg : { ...c.cfg, wGraph: 0 }).ranked;
};

export const VARIANTS: Record<string, (c: Ctx) => Ranked[]> = {
  ctx: ctxVariant('ctx', true), ctx_max: ctxVariant('max', true), ctx_avg: ctxVariant('avg', true),
  ctx_nograph: ctxVariant('ctx', false), ctx_avg_nograph: ctxVariant('avg', false),
  frozen: (c) => rankFrozen(c.text, c.graph, c.sig, c.cfg).ranked,
  nograph: (c) => rankFrozen(c.text, null, c.sig, { ...c.cfg, wGraph: 0 }).ranked,
  seed_prior: withSeeds({ prior: true }),
  seed_file2: withSeeds({ perFile: 2 }),
  seed_file1: withSeeds({ perFile: 1 }),
  seed_prior_file2: withSeeds({ prior: true, perFile: 2 }),
  seed_prior_file1: withSeeds({ prior: true, perFile: 1 }),
  seed_node: withSeeds({ needNode: true }),
  seed_prior_node_file2: withSeeds({ prior: true, perFile: 2, needNode: true }),
  wgraph05: (c) => rankFrozen(c.text, c.graph, c.sig, { ...c.cfg, wGraph: 0.5 }).ranked,
  depth2: (c) => rankFrozen(c.text, c.graph, c.sig, { ...c.cfg, graph: { ...c.cfg.graph, depth: 2 } }).ranked,
  depth1: (c) => rankFrozen(c.text, c.graph, c.sig, { ...c.cfg, graph: { ...c.cfg.graph, depth: 1 } }).ranked,
};
