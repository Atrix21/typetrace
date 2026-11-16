/**
 * Experiment 6: the indexed versions of two query-time hot spots must return what the original scans returned.
 *  - GraphEngine.evidenceLines: per-owner index instead of a scan of every edge per call.
 *  - renderCompact: neighbours that are themselves ranked results are shown first (membership now precomputed).
 */
import { describe, expect, it } from 'vitest';
import { CompactIndex, renderCompact } from '../../src/retrieval/compact-context.js';
import { DEFAULT_GRAPH_CONFIG, GraphEngine } from '../../src/retrieval/graph-engine.js';
import { fixtureGraph } from './helpers.js';

const EVIDENCE = ['CALLS', 'THROWS', 'CHECKS', 'RETURNS', 'WRITES', 'MUTATES', 'CATCHES', 'BRANCHES_TO', 'QUERIES_DATABASE', 'CALLS_EXTERNAL_API'];

describe('GraphEngine.evidenceLines', () => {
  it('equals the edge scan for every declaration, and callers cannot corrupt the index', () => {
    const g = fixtureGraph();
    const eng = new GraphEngine(g.nodes, g.edges, DEFAULT_GRAPH_CONFIG);
    let nonEmpty = 0;
    for (const d of eng.decls) {
      const want = [...new Set(g.edges.filter((e) => (eng.owner.get(e.src) ?? e.src) === d.id && e.line != null && EVIDENCE.includes(e.type)).map((e) => e.line!))].sort((a, b) => a - b);
      const got = eng.evidenceLines(d.id);
      expect(got).toEqual(want);
      if (want.length) nonEmpty++;
      got.push(-1); // a caller mutating the returned array
      expect(eng.evidenceLines(d.id)).toEqual(want);
    }
    expect(nonEmpty).toBeGreaterThan(10);
    expect(eng.evidenceLines('no-such-node')).toEqual([]);
  });
});

describe('renderCompact neighbour order', () => {
  it('lists a neighbour that is itself a ranked result before other neighbours of the same relation', () => {
    const g = fixtureGraph();
    const idx = new CompactIndex(g.nodes, g.edges);
    const resolvable = (id: string) => { const x = idx.nodes.get(id)!; return !!x.file && !!x.qualified_name && idx.byKey.get(`${x.file}::${x.qualified_name}`)?.id === id; };
    const label = (id: string) => idx.label(id);
    // A declaration with more callees than are shown (3), one of the hidden ones being a declaration that can be ranked.
    let n: ReturnType<typeof idx.nodes.get>, hidden: string | undefined;
    for (const [id, rels] of idx.rels) {
      if (!resolvable(id)) continue;
      const callees = rels.filter((r) => r.dir === 'out' && r.type === 'CALLS').map((r) => r.other).sort((a, b) => (label(a) < label(b) ? -1 : 1));
      hidden = callees.slice(3).find(resolvable);
      if (hidden) { n = idx.nodes.get(id); break; }
    }
    expect(hidden).toBeTruthy();
    const item = (x: NonNullable<typeof n>) => ({ file: x.file!, symbol: x.qualified_name, start_line: x.start_line, end_line: x.end_line });
    const opt = { maxTokens: 800, maxSymbols: 10, neighbours: 3, relations: true };
    const callsLine = (ranked: ReturnType<typeof item>[]) => renderCompact(idx, 'q', ranked, opt).text.split('\n').find((l) => l.includes('→ calls:'))!;
    expect(callsLine([item(n!)])).not.toContain(label(hidden!));
    expect(callsLine([item(n!), item(idx.nodes.get(hidden!)!)]).split('→ calls: ')[1].startsWith(label(hidden!))).toBe(true);
  });
});
