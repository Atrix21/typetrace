/**
 * Deterministic TypeScript-Compiler-API code graph builder.
 *
 * Pipeline: program -> declarations (pass 1) -> imports/exports/heritage/HAS_TYPE (pass 2) ->
 * framework pre-pass (roles, DI bindings, entities, routes) -> body walk (pass 3) -> sort + stats + coverage.
 */
import type { CoverageReport, GraphEdge, GraphNode, GraphStats } from './graph-schema.js';
import { createProject } from '../parser/typescript-parser.js';
import { GraphCtx, newDiagnostics, type Diagnostics, type Env, type FrameworkIndex } from '../parser/graph-context.js';
import { extractSymbols } from '../parser/symbol-extractor.js';
import { extractHasType, extractHeritage, extractImportsExports } from '../parser/structural-extractor.js';
import { FrameworkExtractor } from '../parser/framework-extractor.js';
import { walkOwners } from '../parser/body-walker.js';
import { computeCoverage } from './graph-validator.js';
import { buildPythonGraph } from '../languages/python.js';
import { headerLang, langOf } from '../languages/registry.js';
import { buildSyntacticGraph, isSyntactic } from '../languages/syntactic.js';

export interface BuildOptions { repoRoot: string; files: string[]; tsconfigPath?: string; maxPackageDeclarationBytes?: number }
export interface BuiltGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  coverage: CoverageReport;
  stats: GraphStats;
  build_ms: number;
  /** Extraction diagnostics (call-site capture log etc.); not persisted in the graph. */
  diagnostics: Diagnostics;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function computeStats(nodes: GraphNode[], edges: GraphEdge[]): GraphStats {
  const nb: Record<string, number> = {}; const eb: Record<string, number> = {}; const ev: Record<string, number> = {};
  for (const n of nodes) nb[n.type] = (nb[n.type] ?? 0) + 1;
  for (const e of edges) { eb[e.type] = (eb[e.type] ?? 0) + 1; ev[e.verification] = (ev[e.verification] ?? 0) + 1; }
  const sortKeys = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b)));
  return { nodes_by_type: sortKeys(nb), edges_by_type: sortKeys(eb), edges_by_verification: sortKeys(ev) };
}

export function buildGraph(opts: BuildOptions): BuiltGraph {
  // Mixed-language repositories: one graph per front-end (TypeScript compiler for TS/JS, Python, tree-sitter for the
  // rest), merged; node and edge ids are qualified by file path, so they cannot collide.
  const hdr = headerLang(opts.files);
  const frontEnd = (f: string) => { const l = langOf(f, hdr)?.id; return l === 'python' ? 'py' : isSyntactic(l) ? 'syn' : 'ts'; };
  const groups = (['ts', 'py', 'syn'] as const).map((k) => opts.files.filter((f) => frontEnd(f) === k)).filter((g) => g.length);
  if (groups.length > 1) {
    const parts = groups.map((files) => buildGraph({ ...opts, files }));
    const nodes = new Map(parts.flatMap((p) => p.nodes).map((n) => [n.id, n])), edges = new Map(parts.flatMap((p) => p.edges).map((e) => [e.id, e]));
    const ns = [...nodes.values()].sort((x, y) => cmp(x.id, y.id)), es = [...edges.values()].sort((x, y) => cmp(x.id, y.id));
    for (const p of parts.slice(1)) parts[0].diagnostics.notes.push(...p.diagnostics.notes);
    return { nodes: ns, edges: es, coverage: parts[0].coverage, stats: computeStats(ns, es), build_ms: parts.reduce((s, p) => s + p.build_ms, 0), diagnostics: parts[0].diagnostics };
  }
  if (opts.files.length && groups[0][0] && frontEnd(groups[0][0]) === 'syn') {
    const g = buildSyntacticGraph(opts.repoRoot, opts.files);
    const stats = computeStats(g.nodes, g.edges);
    const diag = newDiagnostics(); diag.notes.push(...g.notes);
    const coverage = { eligible_files: opts.files.length, parsed_files: opts.files.length, notes: g.notes } as unknown as CoverageReport;
    return { nodes: g.nodes, edges: g.edges, coverage, stats, build_ms: g.build_ms, diagnostics: diag };
  }
  if (opts.files.length && opts.files.every((f) => f.endsWith('.py'))) {
    const g = buildPythonGraph(opts.repoRoot, opts.files);
    const stats = computeStats(g.nodes, g.edges);
    const diag = newDiagnostics(); diag.notes.push(...g.notes);
    const coverage = { eligible_files: opts.files.length, parsed_files: opts.files.length, notes: g.notes } as unknown as CoverageReport;
    return { nodes: g.nodes, edges: g.edges, coverage, stats, build_ms: g.build_ms, diagnostics: diag };
  }
  const t0 = performance.now();
  const project = createProject(opts);
  const ctx = new GraphCtx();
  const diag = newDiagnostics();
  const fwIndex: FrameworkIndex = { roles: new Map(), bindings: new Map(), entities: new Map(), implementers: new Map() };
  const env: Env = { project, ctx, diag, owners: [], heritage: new Map(), fw: fwIndex };

  // EXP3_PHASE_TIMING=1 prints phase durations to stderr (diagnostics only; no effect on the graph).
  const timing = process.env.EXP3_PHASE_TIMING === '1';
  let tp = performance.now();
  const phase = (name: string) => { if (timing) { const n = performance.now(); console.error(`[phase] ${name} ${Math.round(n - tp)} ms rss ${Math.round(process.memoryUsage().rss / 1e6)} MB`); tp = n; } };
  phase('program');
  const symbolPass = extractSymbols(env);
  phase('symbols');
  extractImportsExports(env);
  extractHeritage(env);
  phase('imports+heritage');
  extractHasType(env, symbolPass);
  phase('has-type');
  const fw = new FrameworkExtractor(env);
  fw.prepare(symbolPass);
  phase('framework-prepare');
  walkOwners(env, symbolPass, fw);
  phase('walk');
  fw.finish();
  phase('finish');
  for (const [pkg, bytes] of Object.entries(project.stubbedPackages).sort()) diag.notes.push(`package ${pkg} loaded as an untyped stub: ${(bytes / 1e6).toFixed(1)} MB of declarations exceeds maxPackageDeclarationBytes`);

  const nodes = [...ctx.nodes.values()].sort((a, b) => cmp(a.id, b.id));
  const edges = [...ctx.edges.values()].sort((a, b) => cmp(a.id, b.id));
  const stats = computeStats(nodes, edges);
  const coverage = computeCoverage(project, { nodes, edges }, diag);
  return { nodes, edges, coverage, stats, build_ms: Math.round(performance.now() - t0), diagnostics: diag };
}
