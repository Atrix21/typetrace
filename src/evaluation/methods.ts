/**
 * Method registry. Every factory returns a fresh RetrievalMethod.
 * Graph/hybrid methods are registered lazily so baselines run even if the graph is broken.
 */
import type { RetrievalMethod } from '../types.js';
import { RipgrepRetriever } from '../retrieval/ripgrep.js';
import { BM25Retriever } from '../retrieval/bm25.js';
import { EmbeddingRetriever } from '../retrieval/embeddings.js';
import { GraphifyRetriever } from '../competitors/graphify-adapter.js';
import { CodeReviewGraphRetriever } from '../competitors/code-review-graph-adapter.js';

export type Factory = () => Promise<RetrievalMethod>;

export const PRIMARY_METHODS = ['ripgrep', 'bm25', 'embeddings', 'graphify', 'code_review_graph', 'custom_graph', 'hybrid'];

export const REGISTRY: Record<string, Factory> = {
  ripgrep: async () => new RipgrepRetriever(),
  bm25: async () => new BM25Retriever(),
  embeddings: async () => new EmbeddingRetriever(),
  graphify: async () => new GraphifyRetriever(),
  // Secondary variants (documented, not primary): Graphify's own default 2000 budget / MCP depth 3.
  graphify_budget2000: async () => new GraphifyRetriever({ name: 'graphify_budget2000', budget: 2000 }),
  graphify_depth3: async () => new GraphifyRetriever({ name: 'graphify_depth3', depth: 3 }),
  code_review_graph: async () => new CodeReviewGraphRetriever(),
  code_review_graph_search_only: async () => new CodeReviewGraphRetriever({ name: 'code_review_graph_search_only', policy: 'search_only' }),
  code_review_graph_emb: async () => new CodeReviewGraphRetriever({ name: 'code_review_graph_emb', embeddings: true }),
  // Fairness control (Amendment D2b): CRG with the SAME embedding model as ours (Qwen3-Embedding-0.6B) via its OpenAI-compatible provider.
  code_review_graph_qwen: async () => new CodeReviewGraphRetriever({ name: 'code_review_graph_qwen', embeddings: true, sameEmbedder: true }),
  custom_graph: async () => {
    const { GraphRetriever } = await import('../retrieval/graph-retrieval.js');
    const { customGraphConfig } = await import('./configs.js');
    return new GraphRetriever(customGraphConfig());
  },
  hybrid: async () => {
    const { HybridRetriever } = await import('../retrieval/hybrid-retrieval.js');
    const { hybridConfig } = await import('./configs.js');
    return new HybridRetriever(hybridConfig());
  },
  // ---- Experiment 3 (M2.8). hybrid_nograph = the experiment-1 ablation `no_graph_at_all` (wGraph = wFact = 0).
  hybrid_nograph: async () => {
    const { HybridRetriever } = await import('../retrieval/hybrid-retrieval.js');
    const { hybridConfig } = await import('./configs.js');
    return new HybridRetriever(hybridConfig(HYBRID_NOGRAPH_OVERRIDE), 'hybrid_nograph');
  },
  compact_graph: async () => {
    const { HybridRetriever } = await import('../retrieval/hybrid-retrieval.js');
    const { CompactRetriever } = await import('../retrieval/compact-retrieval.js');
    const { hybridConfig } = await import('./configs.js');
    return new CompactRetriever('compact_graph', new HybridRetriever(hybridConfig(), 'hybrid'), true);
  },
  compact_nograph: async () => {
    const { HybridRetriever } = await import('../retrieval/hybrid-retrieval.js');
    const { CompactRetriever } = await import('../retrieval/compact-retrieval.js');
    const { hybridConfig } = await import('./configs.js');
    return new CompactRetriever('compact_nograph', new HybridRetriever(hybridConfig(HYBRID_NOGRAPH_OVERRIDE), 'hybrid_nograph'), false);
  },
};

/** The single difference between hybrid and hybrid_nograph (identical to experiment 1's `no_graph_at_all` ablation). */
export const HYBRID_NOGRAPH_OVERRIDE = { wGraph: 0, wFact: 0 } as const;

/** Experiment 3 stage-1 methods (approved list + compact variants + ripgrep as the cheapest lexical floor). */
export const STAGE1_METHODS = ['ripgrep', 'bm25', 'embeddings', 'hybrid_nograph', 'hybrid', 'custom_graph', 'compact_nograph', 'compact_graph'];
