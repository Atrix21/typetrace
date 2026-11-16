/**
 * Experiment 6: lean re-implementation of the frozen `hybrid` ranking (BM25 + embeddings + exact symbol, then typed
 * graph propagation and priors), built for small memory: typed-array adjacency, inverted-index BM25, no snippet
 * rendering, graph rows read from SQLite column by column. With the default options it must reproduce the stored
 * stage-1 rankings exactly (scripts/exp6/run.ts checks this per task); new ranking variants are options on top.
 *
 * Semantics mirrored from src/retrieval/{hybrid-retrieval,graph-engine,bm25,embeddings}.ts, including order of
 * floating-point additions, tie-breaks, and the per-seed edge-visit cap.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../../src/config.js';
import { hybridConfig } from '../../src/evaluation/configs.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import { NODE_TYPES, type EdgeType, type NodeType } from '../../src/graph/graph-schema.js';
import { buildChunks } from '../../src/retrieval/chunker.js';
import { DEFAULT_EDGE_WEIGHTS, TEST_PATH_RE } from '../../src/retrieval/graph-engine.js';
import type { HybridConfig } from '../../src/retrieval/hybrid-retrieval.js';
import { extractIdentifierLikeTerms, tokenize } from '../../src/retrieval/text.js';

const TYPE_ID = new Map<string, number>(NODE_TYPES.map((t, i) => [t, i]));
const DECL = new Set<number>(['class', 'function', 'method', 'interface', 'type', 'variable', 'property'].map((t) => TYPE_ID.get(t)!));
const INTRA = new Set<number>(['condition', 'branch', 'return', 'loop', 'exception_handler', 'parameter'].map((t) => TYPE_ID.get(t)!));
const NO_TRANSIT = new Set<number>(['external_dependency', 'repository'].map((t) => TYPE_ID.get(t)!));
const CONDITION = TYPE_ID.get('condition')!;
export const EDGE_TYPES = Object.keys(DEFAULT_EDGE_WEIGHTS) as EdgeType[];
const EDGE_ID = new Map<string, number>(EDGE_TYPES.map((t, i) => [t, i]));

export interface RawNode { id: string; type: string; name?: string | null; qualified_name: string | null; file: string | null; start_line: number | null; end_line: number | null; symbol_key: string | null }
export interface RawEdge { type: string; src: string; dst: string; confidence: number }

/** Graph rows in the order the frozen engine sees them: SQLite `ORDER BY id` (M/L) or the JSON array order (S). */
export function readGraphSqlite(file: string): { nodes: RawNode[]; edges: () => Iterable<RawEdge> } {
  const db = new DatabaseSync(file, { readOnly: true });
  const nodes = db.prepare("SELECT id, type, name, qualified_name, file, start_line, end_line, json_extract(meta, '$.symbol_key') AS symbol_key FROM nodes ORDER BY id").all() as unknown as RawNode[];
  const edges = function* () {
    const st = db.prepare('SELECT type, src, dst, confidence FROM edges ORDER BY id');
    for (const r of st.iterate()) yield r as unknown as RawEdge;
  };
  return { nodes, edges };
}
export function readGraphJson(file: string): { nodes: RawNode[]; edges: () => Iterable<RawEdge> } {
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const nodes = g.nodes.map((n: any) => ({ id: n.id, type: n.type, name: n.name, qualified_name: n.qualified_name, file: n.file, start_line: n.start_line, end_line: n.end_line, symbol_key: n.meta?.symbol_key ?? null }));
  return { nodes, edges: () => g.edges as RawEdge[] };
}

export class LeanGraph {
  readonly n: number;
  readonly type: Uint8Array;
  readonly owner: Int32Array;
  readonly key: (string | null)[];          // symbol key of declaration nodes
  readonly file: (string | null)[];
  readonly qualified: (string | null)[];
  readonly label: (string | null)[];        // qualified name, else plain name (routes, events)
  readonly start: Int32Array;
  readonly end: Int32Array;
  readonly byKey = new Map<string, number>();
  readonly cond: Uint16Array;               // condition nodes owned by a declaration
  // CSR adjacency over projected declaration-level edges, both directions, sorted by target
  adjStart!: Int32Array; adjTo!: Int32Array; adjW!: Float64Array; adjConf!: Float64Array; adjType!: Uint8Array; adjDir!: Uint8Array;
  readonly edgeCount: number;

  constructor(raw: { nodes: RawNode[]; edges: () => Iterable<RawEdge> }, cfg: HybridConfig['graph']) {
    // Integer ids follow the string order of node ids: the frozen engine sorts frontiers and adjacency by id string.
    const order = raw.nodes.map((_, i) => i).sort((a, b) => (raw.nodes[a].id < raw.nodes[b].id ? -1 : raw.nodes[a].id > raw.nodes[b].id ? 1 : 0));
    const n = (this.n = raw.nodes.length);
    const idOf = new Map<string, number>();
    const rankOfInput = new Int32Array(n);
    order.forEach((inputIdx, rank) => { idOf.set(raw.nodes[inputIdx].id, rank); rankOfInput[inputIdx] = rank; });
    this.type = new Uint8Array(n); this.owner = new Int32Array(n); this.start = new Int32Array(n); this.end = new Int32Array(n);
    this.key = new Array(n).fill(null); this.file = new Array(n).fill(null); this.qualified = new Array(n).fill(null); this.label = new Array(n).fill(null);
    this.cond = new Uint16Array(n);
    for (let i = 0; i < n; i++) {                      // input order: later nodes overwrite byKey, as in the frozen engine
      const r = raw.nodes[i]; const id = rankOfInput[i];
      const t = TYPE_ID.get(r.type); if (t === undefined) throw new Error(`unknown node type ${r.type}`);
      this.type[id] = t; this.file[id] = r.file; this.qualified[id] = r.qualified_name; this.label[id] = r.qualified_name ?? r.name ?? null;
      this.start[id] = r.start_line ?? 0; this.end[id] = r.end_line ?? 0;
      if (DECL.has(t)) {
        const k = r.symbol_key ?? (r.file && r.qualified_name ? `${r.file}::${r.qualified_name}` : null);
        this.key[id] = k;
        if (k) this.byKey.set(k, id);
      }
    }
    // Pass 1 over edges: compact copy + CONTAINS parents.
    let cap = 1 << 20, m = 0;
    let eType = new Uint8Array(cap), eSrc = new Int32Array(cap), eDst = new Int32Array(cap), eConf = new Float64Array(cap);
    const parent = new Int32Array(n).fill(-1);
    const CONTAINS = EDGE_ID.get('CONTAINS')!;
    for (const e of raw.edges()) {
      const t = EDGE_ID.get(e.type); if (t === undefined) throw new Error(`unknown edge type ${e.type}`);
      const s = idOf.get(e.src), d = idOf.get(e.dst);
      if (m === cap) { cap *= 2; const g = <T extends Uint8Array | Int32Array | Float64Array>(a: T): T => { const b = new (a.constructor as any)(cap); b.set(a); return b; }; eType = g(eType); eSrc = g(eSrc); eDst = g(eDst); eConf = g(eConf); }
      // Edges to ids missing from the node table keep the raw id as their own owner in the frozen engine; they can
      // never be reached from a declaration seed, so they are dropped here.
      if (s === undefined || d === undefined) continue;
      eType[m] = t; eSrc[m] = s; eDst[m] = d; eConf[m] = e.confidence; m++;
      if (t === CONTAINS) parent[d] = s;
    }
    this.edgeCount = m;
    for (let i = 0; i < n; i++) {
      let cur = i;
      for (let k = 0; k < 12; k++) { if (!INTRA.has(this.type[cur])) break; const p = parent[cur]; if (p < 0) break; cur = p; }
      this.owner[i] = cur;
    }
    for (let i = 0; i < n; i++) if (this.type[i] === CONDITION) this.cond[this.owner[i]]++;
    // Pass 2: projected adjacency, strongest parallel edge kept (first wins on ties), then sorted by target.
    const slot = new Map<number, number>();
    let acap = 1 << 20, an = 0;
    let aFrom = new Int32Array(acap), aTo = new Int32Array(acap), aW = new Float64Array(acap), aConf = new Float64Array(acap), aType = new Uint8Array(acap), aDir = new Uint8Array(acap);
    const weights = EDGE_TYPES.map((t) => cfg.edgeWeights[t] ?? DEFAULT_EDGE_WEIGHTS[t]);
    for (let i = 0; i < m; i++) {
      const a = this.owner[eSrc[i]], b = this.owner[eDst[i]];
      if (a === b) continue;
      const w = weights[eType[i]]; const conf = cfg.useConfidence ? eConf[i] : 1;
      for (let dir = 0; dir < 2; dir++) {
        const ww = dir === 0 ? w.fwd : w.back; if (ww <= 0) continue;
        const from = dir === 0 ? a : b, to = dir === 0 ? b : a;
        const k = from * n + to;
        const prev = slot.get(k);
        if (prev === undefined) {
          if (an === acap) { acap *= 2; const g = <T extends Uint8Array | Int32Array | Float64Array>(x: T): T => { const y = new (x.constructor as any)(acap); y.set(x); return y; }; aFrom = g(aFrom); aTo = g(aTo); aW = g(aW); aConf = g(aConf); aType = g(aType); aDir = g(aDir); }
          slot.set(k, an); aFrom[an] = from; aTo[an] = to; aW[an] = ww; aConf[an] = conf; aType[an] = eType[i]; aDir[an] = dir; an++;
        } else if (ww * conf > aW[prev] * aConf[prev]) { aW[prev] = ww; aConf[prev] = conf; aType[prev] = eType[i]; aDir[prev] = dir; }
      }
    }
    slot.clear();
    const idx = new Int32Array(an); for (let i = 0; i < an; i++) idx[i] = i;
    idx.sort((x, y) => aFrom[x] - aFrom[y] || aTo[x] - aTo[y]);
    this.adjStart = new Int32Array(n + 1); this.adjTo = new Int32Array(an); this.adjW = new Float64Array(an); this.adjConf = new Float64Array(an); this.adjType = new Uint8Array(an); this.adjDir = new Uint8Array(an);
    for (let i = 0; i < an; i++) { const j = idx[i]; this.adjStart[aFrom[j] + 1]++; this.adjTo[i] = aTo[j]; this.adjW[i] = aW[j]; this.adjConf[i] = aConf[j]; this.adjType[i] = aType[j]; this.adjDir[i] = aDir[j]; }
    for (let i = 0; i < n; i++) this.adjStart[i + 1] += this.adjStart[i];
  }
  degree(u: number): number { return this.adjStart[u + 1] - this.adjStart[u]; }
  typeName(u: number): NodeType { return NODE_TYPES[this.type[u]]; }
  noTransit(u: number): boolean { return NO_TRANSIT.has(this.type[u]); }
}

export interface Contribution { seed: number; score: number }
/** Bounded best-path propagation of the frozen engine. Returns node -> contributions, in first-insertion order. */
export function propagate(g: LeanGraph, seeds: [number, number][], cfg: HybridConfig['graph']): Map<number, Contribution[]> {
  const result = new Map<number, Contribution[]>();
  const best = new Float64Array(g.n); const stamp = new Int32Array(g.n).fill(-1);
  seeds.forEach(([seed, s0], si) => {
    const orderSeen: number[] = [seed];
    stamp[seed] = si; best[seed] = s0;
    let frontier = [seed]; let visited = 0;
    for (let depth = 1; depth <= cfg.depth && frontier.length; depth++) {
      const next = new Set<number>();
      for (const u of frontier) {
        if (u !== seed && g.noTransit(u)) continue;
        const damp = u === seed ? 1 : Math.pow(Math.max(1, (g.degree(u) || 1) / cfg.hubThreshold), cfg.hubPenalty);
        for (let e = g.adjStart[u]; e < g.adjStart[u + 1]; e++) {
          const sc = (best[u] * g.adjW[e] * g.adjConf[e] * cfg.decay) / damp;
          const to = g.adjTo[e];
          if (stamp[to] !== si) { stamp[to] = si; best[to] = sc; orderSeen.push(to); next.add(to); }
          else if (sc > best[to] + 1e-12) { best[to] = sc; next.add(to); }
          if (++visited > cfg.maxVisited) break;
        }
      }
      frontier = [...next].sort((a, b) => a - b);
    }
    for (const node of orderSeen) {
      if (node === seed) continue;
      let r = result.get(node); if (!r) result.set(node, (r = []));
      r.push({ seed, score: best[node] });
    }
  });
  return result;
}
export function aggregate(contribs: Contribution[], aggregation: 'max' | 'sum'): number {
  const c = [...contribs].sort((a, b) => b.score - a.score || a.seed - b.seed);
  return aggregation === 'max' ? c[0].score : c.slice(0, 3).reduce((a, x) => a + x.score, 0);
}

/** Content-hash embedding cache (vectors.jsonl), streamed once per process. */
export class VectorCache {
  private m = new Map<string, Float32Array>();
  private prefix: string;
  constructor(dir: string) {
    const cfg = loadConfig();
    this.prefix = `${cfg.embeddings.model}@${cfg.embeddings.revision}\0${cfg.embeddings.max_seq}\0`;
    const file = `${dir}/vectors.jsonl`;
    const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(32 * 1024 * 1024); let rest = '';
    const take = (l: string) => { if (!l) return; const d = JSON.parse(l); this.m.set(d.k, Float32Array.from(d.v)); };
    try {
      for (;;) { const n = fs.readSync(fd, buf, 0, buf.length, null); if (n <= 0) break; const lines = (rest + buf.toString('utf8', 0, n)).split('\n'); rest = lines.pop() ?? ''; for (const l of lines) take(l); }
      take(rest);
    } finally { fs.closeSync(fd); }
  }
  get(kind: 'doc' | 'query', text: string): Float32Array | undefined {
    return this.m.get(crypto.createHash('sha256').update(`${this.prefix}${kind}\0${text}`).digest('hex'));
  }
  get size() { return this.m.size; }
}

export interface LeanChunk { id: string; file: string; symbol: string; kind: string; start_line: number; end_line: number; text: string }

/** Text side of one snapshot: declaration chunks, inverted-index BM25, chunk vectors. */
export class LeanText {
  readonly index: SymbolIndex;
  readonly chunks: LeanChunk[] = [];
  readonly chunkByKey = new Map<string, LeanChunk>();
  readonly vecs: Float32Array[] = [];
  private post = new Map<string, { docs: Int32Array; tfs: Int32Array }>();
  private len: Int32Array; private avgdl: number;
  constructor(repoRoot: string, files: string[], vectors: VectorCache) {
    this.index = new SymbolIndex(repoRoot, files);
    const full = buildChunks(this.index);
    this.len = new Int32Array(full.length);
    const tmp = new Map<string, number[]>();
    let total = 0;
    full.forEach((c, i) => {
      const v = vectors.get('doc', c.text); if (!v) throw new Error(`no cached vector for chunk ${c.id} (the snapshot was never embedded)`);
      this.vecs.push(v);
      const lc: LeanChunk = { id: c.id, file: c.file, symbol: c.symbol, kind: c.kind, start_line: c.start_line, end_line: c.end_line, text: c.text };
      this.chunks.push(lc); this.chunkByKey.set(c.id, lc);
      const toks = tokenize(c.text); this.len[i] = toks.length; total += toks.length;
      const tf = new Map<string, number>(); for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [t, f] of tf) { let p = tmp.get(t); if (!p) tmp.set(t, (p = [])); p.push(i, f); }
    });
    this.avgdl = total / Math.max(1, full.length);
    for (const [t, p] of tmp) { const docs = new Int32Array(p.length / 2), tfs = new Int32Array(p.length / 2); for (let i = 0; i < docs.length; i++) { docs[i] = p[2 * i]; tfs[i] = p[2 * i + 1]; } this.post.set(t, { docs, tfs }); }
  }
  /** [chunk index, score], score desc, ties by index: identical to BM25Index.search. */
  bm25(query: string, limit: number): [number, number][] {
    const k1 = 1.2, b = 0.75, N = this.chunks.length;
    const q = new Map<string, number>(); for (const t of tokenize(query)) q.set(t, (q.get(t) ?? 0) + 1);
    const s = new Float64Array(N);
    for (const [t, qf] of q) {
      const p = this.post.get(t); if (!p) continue;
      const idf = Math.log(1 + (N - p.docs.length + 0.5) / (p.docs.length + 0.5));
      for (let i = 0; i < p.docs.length; i++) { const d = p.docs[i], f = p.tfs[i]; s[d] += qf * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * this.len[d]) / this.avgdl))); }
    }
    const hits: [number, number][] = []; for (let i = 0; i < N; i++) if (s[i] > 0) hits.push([i, s[i]]);
    hits.sort((x, y) => y[1] - x[1] || x[0] - y[0]);
    return hits.slice(0, limit);
  }
  cosine(qv: Float32Array, vecs: Float32Array[] = this.vecs): Float64Array {
    const out = new Float64Array(vecs.length);
    for (let i = 0; i < vecs.length; i++) { const v = vecs[i]; let s = 0; for (let j = 0; j < v.length; j++) s += qv[j] * v[j]; out[i] = s; }
    return out;
  }
}

export interface Signals {
  /** symbol key -> fused base score, in the frozen insertion order */
  base: Map<string, number>;
  parts: Map<string, { bm25?: number; sem?: number; symbol?: number }>;
}

/** Fused seed scores of the frozen hybrid: wLex*bm25/max + wSem*normalised cosine + wSym*exact symbol. */
export function baseSignals(text: LeanText, query: string, qv: Float32Array, c: HybridConfig, cosOverride?: Float64Array): Signals {
  const base = new Map<string, number>(); const parts: Signals['parts'] = new Map();
  const add = (key: string, sig: 'bm25' | 'sem' | 'symbol', v: number, w: number) => {
    if (v <= 0 || w <= 0) return;
    base.set(key, (base.get(key) ?? 0) + w * v);
    let p = parts.get(key); if (!p) parts.set(key, (p = {})); p[sig] = v;
  };
  if (c.wLex > 0) { const hits = text.bm25(query, c.candidatePool); const max = hits[0]?.[1] ?? 1; for (const [i, s] of hits) add(text.chunks[i].id, 'bm25', s / max, c.wLex); }
  if (c.wSem > 0) {
    const sc = cosOverride ?? text.cosine(qv);
    const sorted = Float64Array.from(sc).sort();
    const med = sorted[Math.floor(sorted.length / 2)], max = sorted[sorted.length - 1];
    const order = Array.from(sc, (s, i) => [i, s] as [number, number]).sort((a, b) => b[1] - a[1]).slice(0, c.candidatePool);
    for (const [i, s] of order) add(text.chunks[i].id, 'sem', Math.max(0, (s - med) / Math.max(1e-9, max - med)), c.wSem);
  }
  if (c.wSym > 0) {
    const ids = extractIdentifierLikeTerms(query).map((t) => t.toLowerCase());
    if (ids.length) for (const ch of text.chunks) { const last = ch.symbol.split('.').pop()!.toLowerCase(); if (ids.includes(last) || ids.includes(ch.symbol.toLowerCase())) add(ch.id, 'symbol', 1, c.wSym); }
  }
  return { base, parts };
}

export function prior(cfg: HybridConfig['graph'], g: LeanGraph | null, kind: string, file: string, node: number | null): number {
  const pr = cfg.priors;
  let p = 1;
  if (pr.enabled) { p = pr.types[kind] ?? 0.5; if (TEST_PATH_RE.test(file)) p *= pr.testPath; }
  if (g && cfg.cfBonus > 0 && node != null) p *= 1 + cfg.cfBonus * Math.min(1, g.cond[node] / 4);
  return p;
}

export interface Ranked { key: string; file: string; symbol: string; start_line: number; end_line: number; score: number; node_type: string | null }

const OUTPUT = (cfg: HybridConfig['graph']) => new Set(cfg.outputTypes as string[]);

/** The frozen hybrid ranking (top `limit`), given base signals. `seedOverride` lets a variant choose other seeds. */
export function rankFrozen(text: LeanText, g: LeanGraph | null, sig: Signals, c: HybridConfig, limit = 50, hooks: { seeds?: [string, number][]; extra?: Map<string, number> } = {}): { ranked: Ranked[]; seeds: [string, number][]; final: Map<string, number> } {
  const final = new Map(sig.base);
  let seedKeys: [string, number][] = [];
  if (g && c.wGraph > 0) {
    seedKeys = hooks.seeds ?? [...sig.base.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, c.graph.seeds);
    const maxB = seedKeys[0]?.[1] ?? 1;
    const seeds = new Map<number, number>();
    for (const [k, s] of seedKeys) { const n = g.byKey.get(k); if (n !== undefined) seeds.set(n, s / maxB); }
    const out = OUTPUT(c.graph);
    for (const [node, contribs] of propagate(g, [...seeds.entries()], c.graph)) {
      if (!out.has(g.typeName(node))) continue;
      const k = g.key[node]; if (!k) continue;
      final.set(k, (final.get(k) ?? 0) + c.wGraph * aggregate(contribs, c.graph.aggregation));
    }
  }
  if (hooks.extra) for (const [k, v] of hooks.extra) final.set(k, (final.get(k) ?? 0) + v);
  for (const [k, v] of final) {
    const node = g?.byKey.get(k);
    const kind = node !== undefined ? g!.typeName(node) : text.chunkByKey.get(k)?.kind ?? 'module';
    final.set(k, v * prior(c.graph, g, kind, k.split('::')[0], node ?? null));
  }
  const ranked = [...final.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([k, s]) => toRanked(text, g, k, s));
  return { ranked, seeds: seedKeys, final };
}

export function toRanked(text: LeanText, g: LeanGraph | null, k: string, s: number): Ranked {
  const node = g?.byKey.get(k); const ch = text.chunkByKey.get(k);
  const has = node !== undefined;
  const qualified = (has ? g!.qualified[node] : null) ?? ch?.symbol ?? k.split('::')[1];
  return {
    key: k, file: (has ? g!.file[node] : null) ?? ch?.file ?? k.split('::')[0], symbol: qualified,
    start_line: has && g!.start[node] ? g!.start[node] : ch?.start_line ?? 1, end_line: has && g!.end[node] ? g!.end[node] : ch?.end_line ?? 1,
    score: s, node_type: has ? g!.typeName(node) : null,
  };
}

export const FROZEN_HYBRID = (): HybridConfig => hybridConfig();
export const FROZEN_NOGRAPH = (): HybridConfig => hybridConfig({ wGraph: 0, wFact: 0 });

/**
 * Index-time graph context (experiment 6, direction 5): the chunk text with a header naming the routes, events and
 * the nearest callers and callees of the declaration, taken from the projected graph. Deterministic; no model.
 */
const CALLISH = new Set(['CALLS', 'CONTROLLER_CALLS', 'SERVICE_USES', 'REPOSITORY_ACCESSES'].map((t) => EDGE_ID.get(t)!));
const E_ROUTE = EDGE_ID.get('ROUTES_TO')!, E_PUB = EDGE_ID.get('PUBLISHES_EVENT')!, E_CON = EDGE_ID.get('CONSUMES_EVENT')!;
export function contextText(text: LeanText, g: LeanGraph, ch: LeanChunk, maxCallers = 5, maxCallees = 8): string {
  const node = g.byKey.get(ch.id);
  if (node === undefined) return ch.text;
  const callers: string[] = [], callees: string[] = [], routes: string[] = [], handles: string[] = [], emits: string[] = [];
  for (let e = g.adjStart[node]; e < g.adjStart[node + 1]; e++) {
    const to = g.adjTo[e], t = g.adjType[e], back = g.adjDir[e] === 1; const lab = g.label[to];
    if (!lab) continue;
    if (t === E_ROUTE && back) routes.push(lab);
    else if (t === E_CON && back) handles.push(lab);
    else if (t === E_PUB && !back) emits.push(lab);
    else if (CALLISH.has(t) && g.key[to]) (back ? callers : callees).push((TEST_PATH_RE.test(g.file[to] ?? '') ? '~' : '') + lab);
  }
  const pick = (xs: string[], n: number) => [...new Set(xs)].sort().filter((x) => !x.startsWith('~')).slice(0, n);   // non-test code only, name order
  const lines: string[] = [];
  if (routes.length) lines.push(`// route: ${pick(routes, 3).join(', ')}`);
  if (handles.length) lines.push(`// handles: ${pick(handles, 3).join(', ')}`);
  if (emits.length) lines.push(`// emits: ${pick(emits, 3).join(', ')}`);
  const cr = pick(callers, maxCallers), ce = pick(callees, maxCallees);
  if (cr.length) lines.push(`// called by: ${cr.join(', ')}`);
  if (ce.length) lines.push(`// calls: ${ce.join(', ')}`);
  if (!lines.length) return ch.text;
  const nl = ch.text.indexOf('\n');
  return ch.text.slice(0, nl + 1) + lines.join('\n') + '\n' + ch.text.slice(nl + 1);
}
