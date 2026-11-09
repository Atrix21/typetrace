/**
 * Experiment 3 (M2.8): compact, agent-facing retrieval methods with identical output format, schema and token cap.
 *
 *   compact_graph    ranking = hybrid (frozen experiment-1 config, graph propagation on); output = pointers +
 *                    relationship lines (callers/callees/handlers/routes) from the code graph.
 *   compact_nograph  ranking = hybrid_nograph (same config with wGraph = wFact = 0); output = pointers only.
 * Both: same renderer, same CompactOptions except `relations`, same 800-token cap; the no-graph variant spends the
 * cap on more symbols. Signatures come from source text for both, so the control never touches the graph.
 * Results (for retrieval metrics) = listed symbols in rank order, then neighbour symbols in order of mention.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Corpus, IndexStats, RetrievalBudget, RetrievalMethod, RetrievalOutput, RetrievalQuery, RetrievedItem } from '../types.js';
import { CompactIndex, DEFAULT_COMPACT, renderCompact, sourceSignature, type CompactOptions } from './compact-context.js';
import { HybridRetriever } from './hybrid-retrieval.js';
import { loadOrBuildGraph } from './graph-retrieval.js';

export const COMPACT_TOKEN_CAP = 800;
export const COMPACT_MAX_SYMBOLS = 25;
export const COMPACT_OPTIONS: Omit<CompactOptions, 'relations'> = { ...DEFAULT_COMPACT, maxTokens: COMPACT_TOKEN_CAP, maxSymbols: COMPACT_MAX_SYMBOLS };

export class CompactRetriever implements RetrievalMethod {
  private idx: CompactIndex | null = null;
  private repoRoot = '';
  private lines = new Map<string, string[]>();
  constructor(readonly name: string, private base: HybridRetriever, private relations: boolean) {}

  async prepare(corpus: Corpus): Promise<IndexStats> {
    const t0 = performance.now();
    this.repoRoot = corpus.repoRoot;
    this.lines.clear();
    const b = await this.base.prepare(corpus);
    let g: Record<string, unknown> = {};
    if (this.relations) {
      const lg = await loadOrBuildGraph(corpus);
      this.idx = new CompactIndex(lg.nodes, lg.edges);
      g = { nodes: lg.nodes.length, edges: lg.edges.length };
    }
    return { method: this.name, index_ms: performance.now() - t0, index_llm_tokens: 0, embedding_tokens: b.embedding_tokens, details: { base: b.details, relations: this.relations, options: { ...COMPACT_OPTIONS, relations: this.relations }, graph: g } };
  }

  private sig = (file: string, start: number, end: number) => {
    let l = this.lines.get(file);
    if (!l) { l = fs.readFileSync(path.join(this.repoRoot, file), 'utf8').split('\n'); this.lines.set(file, l); }
    return sourceSignature(l, start, end);
  };

  async retrieve(q: RetrievalQuery, budget: RetrievalBudget): Promise<RetrievalOutput> {
    const t0 = performance.now();
    // Ranking only: ask the base for its full ranked list (context rendering is discarded).
    const r = await this.base.retrieve(q, { maxResults: Math.max(budget.maxResults, 50), maxContextTokens: Number.MAX_SAFE_INTEGER });
    const c = renderCompact(this.idx, q.query, r.results, { ...COMPACT_OPTIONS, relations: this.relations, signature: this.sig });
    const byKey = new Map(r.results.map((it) => [`${it.file}::${it.symbol}`, it]));
    const items: RetrievedItem[] = [];
    const seen = new Set<string>();
    for (const k of [...c.listed, ...c.mentioned]) {
      if (seen.has(k)) continue;
      seen.add(k);
      const it = byKey.get(k);
      const [file, symbol] = k.split('::');
      items.push(it ? { ...it, evidence: c.listed.includes(k) ? 'listed' : 'neighbour' } : { file, symbol: symbol ?? null, start_line: null, end_line: null, score: null, evidence: 'neighbour' });
    }
    return { task_id: q.task_id, method: this.name, results: items.slice(0, budget.maxResults), context: c.text, latency_ms: performance.now() - t0, llm_tokens: { input: 0, output: 0 }, metadata: { listed: c.listed.length, mentioned: c.mentioned.length, tokens: c.tokens } };
  }
}
