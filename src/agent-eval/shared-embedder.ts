/**
 * One query-embedding model shared by several retrieval daemons (experiment 10: parallel agent workers).
 *
 * The model (Qwen3-Embedding-0.6B via scripts/embeddings/embed_server.py, or the ONNX backend) is loaded once, by
 * `startSharedEmbedServer`, behind an HTTP endpoint on 127.0.0.1. A daemon started with TYPETRACE_EMBED_URL set uses
 * `RemoteQueryEmbedder` instead of loading its own copy. Vectors are identical: the same server process computes them,
 * with the same instruction, pinned revision and rounding (scripts/embeddings/embed_server.py).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PersistentQueryEmbedder } from './mcp/retrieval-server.js';
import type { QueryEmbedder } from '../retrieval/embeddings.js';

export interface SharedEmbedServer { url: string; info: Record<string, unknown>; close(): Promise<void> }

export async function startSharedEmbedServer(): Promise<SharedEmbedServer> {
  const embedder = new PersistentQueryEmbedder();
  const info = await embedder.ready;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { text, kind } = JSON.parse(body || '{}');
        if (typeof text !== 'string') throw new Error('text must be a string');
        const r = await embedder.embed(text, kind === 'doc' ? 'doc' : 'query');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ vector: Array.from(r.vector), tokens: r.tokens }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url, info,
    close: () => new Promise<void>((resolve) => { embedder.close(); server.close(() => resolve()); }),
  };
}

/** QueryEmbedder backed by a shared server (TYPETRACE_EMBED_URL). */
export class RemoteQueryEmbedder implements QueryEmbedder {
  readonly ready: Promise<Record<string, unknown>>;
  constructor(private url: string, private timeoutMs = 120_000) {
    this.ready = this.embedQuery('ping').then(() => ({ remote: url }));
  }
  async embedQuery(text: string): Promise<{ vector: Float32Array; tokens: number }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const r = await fetch(this.url, { method: 'POST', body: JSON.stringify({ text, kind: 'query' }), signal: ctrl.signal });
      const j = await r.json() as { vector?: number[]; tokens?: number; error?: string };
      if (!r.ok || !j.vector) throw new Error(`shared embedder: ${j.error ?? r.status}`);
      return { vector: Float32Array.from(j.vector), tokens: j.tokens ?? 0 };
    } finally { clearTimeout(timer); }
  }
  close() { /* the server is owned by the runner */ }
}
