/**
 * Working across sessions (0.4): what earlier sessions in a repository did, what the codebase looks like, and what
 * changed since the last session. All of it is local and deterministic (no LLM).
 *
 *   worklog     <index dir>/worklog.jsonl, written by the Claude Code hook (claude-setup.ts) after each Read, Edit,
 *               Write and find_relevant_code call: {t, s (session), e: read|edit|query, f?, a?, b?, q?}.
 *               TYPETRACE_WORKLOG=0 turns recording off. It never leaves the index folder.
 *   snapshots   <index dir>/sessions/*.json, written by the hook when a session ends: {t, s, head, manifest}.
 *
 * The three MCP tools answer from these files, the call graph and the repository (git, when it is a git repository).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { GraphEdge, GraphNode } from '../graph/graph-schema.js';
import { diffManifest, type Manifest } from './index-state.js';

export const WORKLOG = 'worklog.jsonl';
export const SESSIONS = 'sessions';

export interface WorkEntry { t: string; s: string; e: 'read' | 'edit' | 'query'; f?: string; a?: number; b?: number; q?: string }
export interface Snapshot { t: string; s: string; head: string | null; manifest: Manifest }

const DECL: GraphNode['type'][] = ['function', 'method', 'class', 'interface', 'route'];
const CALL_EDGES = new Set(['CALLS', 'ROUTES_TO', 'CONTROLLER_CALLS', 'SERVICE_USES', 'CONSUMES_EVENT', 'INSTANTIATES']);

export function readWorklog(indexDir: string, max = 20_000): WorkEntry[] {
  const f = path.join(indexDir, WORKLOG);
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-max);
  const out: WorkEntry[] = [];
  for (const l of lines) { try { const e = JSON.parse(l); if (e && e.s && e.e) out.push(e); } catch { /* a torn line */ } }
  return out;
}

export function readSnapshots(indexDir: string): Snapshot[] {
  const d = path.join(indexDir, SESSIONS);
  if (!fs.existsSync(d)) return [];
  const out: Snapshot[] = [];
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json'))) {
    try { const s = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); if (s?.manifest) out.push(s); } catch { /* partial */ }
  }
  return out.sort((a, b) => (a.t < b.t ? -1 : 1));
}

/** Declarations by file, innermost-first lookup of the one enclosing a line. */
export class DeclIndex {
  private byFile = new Map<string, GraphNode[]>();
  constructor(nodes: GraphNode[]) {
    for (const n of nodes) {
      if (!n.file || n.start_line == null || n.end_line == null || !DECL.includes(n.type)) continue;
      const l = this.byFile.get(n.file) ?? []; l.push(n); this.byFile.set(n.file, l);
    }
  }
  inFile(file: string): GraphNode[] { return this.byFile.get(file) ?? []; }
  enclosing(file: string, line: number): GraphNode | null {
    let best: GraphNode | null = null;
    for (const n of this.inFile(file)) if (n.start_line! <= line && line <= n.end_line! && (!best || n.end_line! - n.start_line! < best.end_line! - best.start_line!)) best = n;
    return best;
  }
  overlapping(file: string, a: number, b: number): GraphNode[] {
    const hit = this.inFile(file).filter((n) => n.start_line! <= b && a <= n.end_line!);
    // innermost only: drop a declaration that contains another hit
    return hit.filter((n) => !hit.some((m) => m !== n && n.start_line! <= m.start_line! && m.end_line! <= n.end_line! && (m.end_line! - m.start_line!) < (n.end_line! - n.start_line!)));
  }
}

const label = (n: GraphNode) => n.qualified_name || n.name;
const loc = (n: GraphNode) => `${n.file}:${n.start_line}-${n.end_line}`;

/** What earlier sessions worked on, most recent first (the current session last, if it already did something). */
export function recentWork(entries: WorkEntry[], decls: DeclIndex, o: { sessions?: number; current?: string } = {}): string {
  if (!entries.length) return 'No earlier sessions recorded in this repository yet (TypeTrace records the code each Claude Code session searches, reads and edits).';
  const order: string[] = [];
  const by = new Map<string, WorkEntry[]>();
  for (const e of entries) { if (!by.has(e.s)) { by.set(e.s, []); order.push(e.s); } by.get(e.s)!.push(e); }
  const sessions = order.reverse().slice(0, o.sessions ?? 3);
  const parts: string[] = [];
  for (const s of sessions) {
    const es = by.get(s)!;
    const when = es[es.length - 1].t.slice(0, 16).replace('T', ' ');
    const queries = [...new Set(es.filter((e) => e.e === 'query' && e.q).map((e) => e.q!))].slice(0, 5);
    const edited = new Map<string, number>(), read = new Map<string, number>();
    for (const e of es) {
      if (!e.f) continue;
      if (e.e === 'edit') { for (const n of e.a ? decls.overlapping(e.f, e.a, e.b ?? e.a) : []) edited.set(`${label(n)} (${loc(n)})`, (edited.get(`${label(n)} (${loc(n)})`) ?? 0) + 1); edited.set(e.f, (edited.get(e.f) ?? 0) + 1); }
      if (e.e === 'read') {
        const ns = e.a ? decls.overlapping(e.f, e.a, e.b ?? e.a + 200) : [];
        if (ns.length && ns.length <= 6) for (const n of ns) read.set(`${label(n)} (${loc(n)})`, (read.get(`${label(n)} (${loc(n)})`) ?? 0) + 1);
        else read.set(e.f, (read.get(e.f) ?? 0) + 1);
      }
    }
    const top = (m: Map<string, number>, k: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([x]) => x);
    const lines = [s === o.current ? `This session (latest activity ${when}):` : `Session ending ${when}:`];
    if (queries.length) lines.push(`  searched: ${queries.map((q) => JSON.stringify(q)).join('; ')}`);
    const ed = top(edited, 6).filter((x) => x.includes('('));
    const edFiles = top(edited, 6).filter((x) => !x.includes('('));
    if (ed.length || edFiles.length) lines.push(`  edited: ${(ed.length ? ed : edFiles).join('; ')}`);
    const rd = top(read, 10);
    if (rd.length) lines.push(`  read: ${rd.join('; ')}`);
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}

/** Top-level areas, most-called declarations and entry points, from the call graph. */
export function overview(files: string[], nodes: GraphNode[], edges: GraphEdge[], o: { top?: number; under?: string } = {}): string {
  const under = (o.under ?? '').replace(/^\.?\/*/, '').replace(/\/*$/, '');
  const inScope = (f: string | null) => !!f && (!under || f === under || f.startsWith(under + '/'));
  const fs2 = files.filter(inScope);
  if (!fs2.length) return under ? `No indexed files under ${under}.` : 'The index is empty.';
  const depth = under ? under.split('/').length + 1 : 1;
  const areaOf = (f: string) => { const p = f.split('/'); return p.length > depth ? p.slice(0, depth).join('/') + '/' : f; };
  const ext = (f: string) => path.extname(f).slice(1) || 'other';
  const areas = new Map<string, { files: number; exts: Map<string, number> }>();
  for (const f of fs2) { const a = areaOf(f); const v = areas.get(a) ?? { files: 0, exts: new Map() }; v.files++; v.exts.set(ext(f), (v.exts.get(ext(f)) ?? 0) + 1); areas.set(a, v); }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inDeg = new Map<string, number>(), outDeg = new Map<string, number>();
  for (const e of edges) {
    if (!CALL_EDGES.has(e.type)) continue;
    const s = byId.get(e.src), d = byId.get(e.dst);
    if (!s || !d || s.file === d.file && s.id === d.id) continue;
    if (inScope(d.file) && DECL.includes(d.type)) inDeg.set(d.id, (inDeg.get(d.id) ?? 0) + 1);
    if (inScope(s.file) && DECL.includes(s.type)) outDeg.set(s.id, (outDeg.get(s.id) ?? 0) + 1);
  }
  const top = o.top ?? 12;
  const most = [...inDeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([id, n]) => `${label(byId.get(id)!)} (${loc(byId.get(id)!)}) — called from ${n} places`);
  const allRoutes = nodes.filter((n) => n.type === 'route' && inScope(n.file));
  const routes = allRoutes.slice(0, top).map((n) => `${n.name} (${n.file}:${n.start_line})`);
  if (allRoutes.length > top) routes.push(`… ${allRoutes.length - top} more routes; pass "under" to narrow`);
  const entries = routes.length ? routes : [...outDeg.entries()].filter(([id]) => !inDeg.has(id)).sort((a, b) => b[1] - a[1]).slice(0, Math.ceil(top / 2)).map(([id, n]) => `${label(byId.get(id)!)} (${loc(byId.get(id)!)}) — calls ${n}, called by none indexed`);
  const lines = [`${fs2.length} indexed files${under ? ` under ${under}/` : ''}.`, '', 'Areas (files, main languages):'];
  for (const [a, v] of [...areas.entries()].sort((x, y) => y[1].files - x[1].files).slice(0, 15)) lines.push(`  ${a} — ${v.files} (${[...v.exts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => k).join(', ')})`);
  if (areas.size > 15) lines.push(`  … ${areas.size - 15} more; pass "under" to look inside an area`);
  if (most.length) { lines.push('', 'Most-called functions and methods:'); for (const m of most) lines.push(`  ${m}`); }
  if (entries.length) { lines.push('', routes.length ? 'Routes:' : 'Likely entry points (call much, called by nothing indexed):'); for (const m of entries) lines.push(`  ${m}`); }
  return lines.join('\n');
}

function git(repo: string, args: string[]): string | null {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return r.status === 0 ? r.stdout : null;
}

/** Changed line ranges (new side) per file since `head`, from git (committed and uncommitted changes). */
export function gitChangedLines(repo: string, head: string): Map<string, [number, number][]> | null {
  const out = git(repo, ['diff', '-U0', '--no-color', '--no-ext-diff', head, '--']);
  if (out == null) return null;
  const m = new Map<string, [number, number][]>();
  let file: string | null = null;
  for (const l of out.split('\n')) {
    if (l.startsWith('+++ ')) { file = l === '+++ /dev/null' ? null : l.slice(4).replace(/^b\//, ''); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h && file) { const a = Number(h[1]), n = h[2] === undefined ? 1 : Number(h[2]); const r = m.get(file) ?? []; r.push([a, Math.max(a, a + n - 1)]); m.set(file, r); }
  }
  return m;
}

/** What changed since the previous session ended: files, functions (exact with git), and who calls them. */
export function changesSince(repo: string, snapshots: Snapshot[], current: Manifest, decls: DeclIndex, nodes: GraphNode[], edges: GraphEdge[], o: { top?: number } = {}): string {
  const prev = snapshots[snapshots.length - 1];
  if (!prev) return 'No earlier session recorded in this repository yet (TypeTrace notes the state of the code when a Claude Code session ends).';
  const d = diffManifest(prev.manifest, current);
  const head = git(repo, ['rev-parse', 'HEAD'])?.trim() ?? null;
  const lines = [`Since the previous session ended (${prev.t.slice(0, 16).replace('T', ' ')})${prev.head && head && prev.head !== head ? `, the checkout moved from ${prev.head.slice(0, 10)} to ${head.slice(0, 10)}` : ''}:`];
  if (!d.added.length && !d.changed.length && !d.removed.length) { lines.push('  no indexed file changed.'); return lines.join('\n'); }
  const exact = prev.head ? gitChangedLines(repo, prev.head) : null;
  const changedDecls: GraphNode[] = [];
  for (const f of [...d.changed, ...d.added]) {
    const ranges = exact?.get(f);
    const ns = ranges ? ranges.flatMap(([a, b]) => decls.overlapping(f, a, b)) : d.added.includes(f) ? decls.inFile(f) : [];
    for (const n of ns) if (!changedDecls.includes(n)) changedDecls.push(n);
  }
  const top = o.top ?? 15;
  const fmt = (xs: string[], k: number) => xs.slice(0, k).join(', ') + (xs.length > k ? `, … ${xs.length - k} more` : '');
  if (d.changed.length) lines.push(`  changed files (${d.changed.length}): ${fmt(d.changed, 12)}`);
  if (d.added.length) lines.push(`  new files (${d.added.length}): ${fmt(d.added, 8)}`);
  if (d.removed.length) lines.push(`  removed files (${d.removed.length}): ${fmt(d.removed, 8)}`);
  if (changedDecls.length) {
    lines.push(`  changed functions and methods${exact ? '' : ' (in new files; git not available for exact ranges)'}:`);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const callers = new Map<string, Set<string>>();
    for (const e of edges) if (CALL_EDGES.has(e.type)) { const s = callers.get(e.dst) ?? new Set(); s.add(e.src); callers.set(e.dst, s); }
    for (const n of changedDecls.slice(0, top)) {
      const cs = [...(callers.get(n.id) ?? [])].map((id) => byId.get(id)).filter((x): x is GraphNode => !!x && x.file !== null && x.id !== n.id);
      lines.push(`    ${label(n)} (${loc(n)})${cs.length ? ` — called by ${cs.slice(0, 4).map((c) => `${label(c)} (${c.file}:${c.start_line})`).join(', ')}${cs.length > 4 ? `, … ${cs.length - 4} more` : ''}` : ''}`);
    }
    if (changedDecls.length > top) lines.push(`    … ${changedDecls.length - top} more`);
  } else if (!exact && d.changed.length) lines.push('  (not a git repository, or the previous commit is gone: changed functions cannot be located exactly; read the changed files)');
  return lines.join('\n');
}
