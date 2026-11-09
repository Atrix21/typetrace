#!/usr/bin/env tsx
// Experiment 3: embed every chunk of a repository's pinned corpus once (content-hash cache), so stage-1 runs only embed
// the few chunks a bug snapshot changes.  npx tsx scripts/exp3/precompute-embeddings.ts --repo M|L
import path from 'node:path';
import { abs, listCorpusFiles } from '../../src/config.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import { buildChunks } from '../../src/retrieval/chunker.js';
import { Embedder } from '../../src/retrieval/embeddings.js';
import { REPOS } from './tasks.js';
const repo = process.argv[process.argv.indexOf('--repo') + 1] as 'M' | 'L';
const root = abs(REPOS[repo === 'M' ? 'immich' : 'twenty'].corpusRoot);
const t0 = performance.now();
const chunks = buildChunks(new SymbolIndex(root, listCorpusFiles(root, ['src'])));
console.error(`${chunks.length} chunks (${Math.round((performance.now() - t0) / 1000)} s)`);
const e = new Embedder(abs(`.cache/exp3/embeddings-${repo}`));
const t1 = performance.now();
const r = e.embed(chunks.map((c) => ({ id: c.id + '#' + c.start_line, text: c.text, kind: 'doc' as const })));
console.log(JSON.stringify({ repo, chunks: chunks.length, newly_embedded: r.computed, embed_s: Math.round((performance.now() - t1) / 1000), cache: path.relative(process.cwd(), abs(`.cache/exp3/embeddings-${repo}`)) }));
