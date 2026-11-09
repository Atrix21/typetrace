/**
 * Experiment 3 scale fix: the embedding vector cache is streamed and memoised per process. Cached vectors must come back
 * exactly as stored (same Float32 values, same token counts), with no subprocess call when nothing is missing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Embedder, type EmbedItem } from '../../src/retrieval/embeddings.js';

describe('embedding cache (streamed, memoised)', () => {
  it('returns stored vectors and token counts for cached items without embedding anything', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embcache-'));
    const e = new Embedder(dir);
    const key = (it: EmbedItem) => (e as unknown as { key(i: EmbedItem): string }).key(it);
    const items: EmbedItem[] = Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, text: `chunk ${i} ${'x'.repeat(i % 50)}`, kind: 'doc' }));
    const lines = items.map((it, i) => JSON.stringify({ k: key(it), v: [(i + 1) / 7, -(i + 1) / 3, 0.1 * (i + 1)], t: i + 1 }));
    fs.writeFileSync(path.join(dir, 'vectors.jsonl'), lines.join('\n') + '\n');
    const r = e.embed(items);
    expect(r.computed).toBe(0);
    for (const [i, it] of items.entries()) {
      expect(Array.from(r.vectors.get(it.id)!)).toEqual(Array.from(Float32Array.from([(i + 1) / 7, -(i + 1) / 3, 0.1 * (i + 1)])));
      expect(r.tokens.get(it.id)).toBe(i + 1);
    }
    // memoised: a second call does not re-read the file (removing it changes nothing)
    fs.rmSync(path.join(dir, 'vectors.jsonl'));
    expect(e.embed(items.slice(0, 5)).computed).toBe(0);
  });
});
