/**
 * Index state shared by the CLI, the server and the background jobs (src/product/index-state.ts), and the vector
 * cache read by a server while a background job appends to it (src/retrieval/embeddings.ts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Embedder } from '../../src/retrieval/embeddings.js';
import { diffManifest, findIndexedRepo, jobRunning, paths, readMeta, tryLock, unlock, writeMeta } from '../../src/product/index-state.js';

const saved = process.env.TYPETRACE_CACHE;
beforeAll(() => { process.env.TYPETRACE_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-state-')); });
afterAll(() => { if (saved === undefined) delete process.env.TYPETRACE_CACHE; else process.env.TYPETRACE_CACHE = saved; });

describe('index state', () => {
  it('diffs manifests into added, changed and removed files', () => {
    expect(diffManifest({ a: '1:1', b: '2:2', c: '3:3' }, { a: '1:1', b: '2:9', d: '4:4' })).toEqual({ added: ['d'], removed: ['c'], changed: ['b'] });
  });

  it('merges index.json fields, so one job never undoes the other', () => {
    const repo = '/tmp/tt-meta-repo';
    writeMeta(repo, { files: 3, graph_at: 'g1' });
    writeMeta(repo, { vectors_at: 'v1' });
    writeMeta(repo, { graph_at: 'g2' });
    expect(readMeta(repo)).toMatchObject({ repo, files: 3, graph_at: 'g2', vectors_at: 'v1', embeddings: 'auto' });
  });

  it('locks a job kind to one live process and clears a lock left by a dead one', () => {
    const repo = '/tmp/tt-lock-repo';
    expect(tryLock(repo, 'graph')).toBe(true);
    expect(jobRunning(repo, 'graph')).toBe(process.pid);
    expect(tryLock(repo, 'graph')).toBe(false);
    unlock(repo, 'graph');
    expect(jobRunning(repo, 'graph')).toBeNull();
    fs.writeFileSync(path.join(paths(repo).jobs, 'embed.lock'), '2147483646'); // no such process
    expect(jobRunning(repo, 'embed')).toBeNull();
    expect(tryLock(repo, 'embed')).toBe(true);
    unlock(repo, 'embed');
  });

  it('finds the nearest indexed repository above a directory (tools with one global configuration)', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-find-'));
    fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
    expect(findIndexedRepo(path.join(repo, 'src', 'deep'))).toBeNull();
    fs.mkdirSync(paths(repo).dir, { recursive: true });
    fs.writeFileSync(paths(repo).graph, '');
    expect(findIndexedRepo(path.join(repo, 'src', 'deep'))).toBe(repo);
  });

  it('reads vectors appended by another process, and skips a line that is still being written', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-vec-'));
    const f = path.join(dir, 'vectors.jsonl');
    const line = (k: string) => JSON.stringify({ k, v: [0.1, 0.2], t: 3 });
    fs.writeFileSync(f, `${line('a')}\n${line('b')}\n${line('c').slice(0, 9)}`);
    expect(Embedder.cachedCount(dir)).toBe(2);
    fs.appendFileSync(f, `${line('c').slice(9)}\n${line('d')}\n`);
    expect(Embedder.cachedCount(dir)).toBe(4);
    expect(Embedder.cachedCount(dir)).toBe(4); // nothing new: nothing re-read
  });
});
