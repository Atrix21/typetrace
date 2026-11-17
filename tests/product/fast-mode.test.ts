/**
 * Fast first index: while no vectors exist, the served method (compact_graph, read-only cache) must rank exactly
 * like compact_graph_lex (BM25 + symbols + graph facts + propagation, wSem = 0). That is what makes the measured
 * quality of compact_graph_lex the quality a user gets before the background embedding finishes. No model is loaded.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTRY } from '../../src/evaluation/methods.js';
import { buildGraph } from '../../src/graph/graph-builder.js';
import { Embedder, EmbeddingRetriever } from '../../src/retrieval/embeddings.js';
import { primeGraphCache } from '../../src/retrieval/graph-retrieval.js';
import type { Corpus } from '../../src/types.js';
import { FIXTURE, fixtureOpts } from '../graph/helpers.js';

const BUDGET = { maxResults: 50, maxContextTokens: 8000 };
const QUERIES = ['create a new user account', 'find a user by email address', 'what happens when a user is not found', 'save the user to the database'];
let corpus: Corpus;

beforeAll(() => {
  const o = fixtureOpts();
  corpus = { repoRoot: FIXTURE, commit: 'fixture', files: o.files, cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tt-fast-')) };
  const g = buildGraph(o);
  primeGraphCache(corpus, { nodes: g.nodes, edges: g.edges, build_ms: g.build_ms, cached: true });
  EmbeddingRetriever.embeddingCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-fast-emb-')); // empty: nothing embedded yet
  EmbeddingRetriever.defaultQueryEmbedder = null;
  Embedder.cachedOnly = true;
}, 120_000);
afterAll(() => { Embedder.cachedOnly = false; EmbeddingRetriever.embeddingCacheDir = null; });

describe('fast first index', () => {
  it('with no vectors yet, the served tool ranks exactly like compact_graph_lex', async () => {
    const served = (await REGISTRY.compact_graph()) as Awaited<ReturnType<typeof REGISTRY.compact_graph>> & { coverage: { covered: number; total: number } };
    const lex = await REGISTRY.compact_graph_lex();
    await served.prepare(corpus);
    await lex.prepare(corpus);
    expect(served.coverage.covered).toBe(0);
    expect(served.coverage.total).toBeGreaterThan(10);
    for (const q of QUERIES) {
      const a = await served.retrieve({ task_id: 't', query: q }, BUDGET);
      const b = await lex.retrieve({ task_id: 't', query: q }, BUDGET);
      expect(a.context, q).toBe(b.context);
      expect(a.context.length, q).toBeGreaterThan(0);
      expect(a.results.map((r) => `${r.file}::${r.symbol}`)).toEqual(b.results.map((r) => `${r.file}::${r.symbol}`));
    }
  });
});
