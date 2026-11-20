/**
 * Experiment 3 agent stage: answer schema, prompts and automatic scoring (no LLM judge).
 *
 * Every task type gets the same answer format: an ordered list of code locations (file + qualified symbol) plus a short
 * summary. Locations are mapped to canonical symbol keys on the task's own snapshot and scored against the frozen
 * dataset-v2 ground truth:
 *   category A (bug localisation): rc_at_1 / rc_at_3 / rc_any — a root-cause function among the first k locations;
 *   categories B–E: recall of the relevant symbols, precision, ordered-path recall (B/D), impact recall (C).
 * Pre-registered primary task score (protocol Amendment C): A -> rc_at_3 (0/1); B–E -> relevant-symbol recall (0..1).
 */
import type { GroundTruthTask } from '../../types.js';
import type { SymbolIndex } from '../../evaluation/symbol-index.js';

export const ANSWER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'locations'],
  properties: {
    summary: { type: 'string', description: 'Short answer in prose (at most a few sentences)' },
    locations: {
      type: 'array', minItems: 1, maxItems: 20,
      items: {
        type: 'object', additionalProperties: false, required: ['file', 'symbol'],
        properties: {
          file: { type: 'string', description: 'Repository-relative file path, e.g. src/foo/bar.service.ts' },
          symbol: { type: 'string', description: 'Qualified function/method name, e.g. ClassName.methodName or functionName' },
          role: { type: 'string', description: 'Why this location matters (one short phrase)' },
        },
      },
    },
  },
} as const;

export const EXP3_SYSTEM_PROMPT = [
  'You are a senior software engineer working in an unfamiliar TypeScript repository checked out in the current directory.',
  'Answer the user\'s question about this codebase by exploring the code with the available read-only tools.',
  'Besides Read, Grep and Glob you may have a code-search tool provided through MCP (its name starts with mcp__); if you do, use it first to find candidate locations, then verify them by reading the code.',
  'When you are done, call the StructuredOutput tool once with your answer: the code locations (functions or methods) that answer the question, most important first, each with its repository-relative file path and qualified symbol name (ClassName.methodName or functionName), plus a short summary.',
].join(' ');

export function exp3TaskPrompt(t: GroundTruthTask): string {
  if (t.task_type === 'bug_localisation') {
    return `Bug report:\n\n${t.description}\n\nFind the root cause. List first the function(s) that must change to fix the bug, then other functions on the path from the user-visible entry point to the defect.`;
  }
  return `Question about this codebase:\n\n${t.description}\n\nList the functions and methods involved. If the question asks for a path, flow or sequence, list them in order along that path.`;
}

export interface Exp3Answer { summary: string; locations: { file: string; symbol: string; role?: string }[] }

export function parseAnswer(raw: unknown): Exp3Answer | null {
  let x = raw;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return null; } }
  if (!x || typeof x !== 'object') return null;
  const a = x as Record<string, unknown>;
  if (!Array.isArray(a.locations)) return null;
  const locations = a.locations.filter((l): l is { file: string; symbol: string; role?: string } => !!l && typeof (l as any).file === 'string' && typeof (l as any).symbol === 'string');
  if (!locations.length) return null;
  return { summary: typeof a.summary === 'string' ? a.summary : '', locations };
}

/** Repository-relative path from whatever the agent wrote (absolute workspace paths, ./ prefixes, line suffixes). */
export function cleanFile(f: string): string {
  let p = f.trim().replace(/\\/g, '/').replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, '');
  const i = p.lastIndexOf('/app/');
  if (p.startsWith('/') && i >= 0) p = p.slice(i + 5);
  const s = p.indexOf('src/');
  if (s > 0 && !p.startsWith('src/')) p = p.slice(s);
  return p;
}
export function cleanSymbol(s: string): string {
  return s.trim().replace(/\(.*$/s, '').replace(/^.*::/, '').replace(/#/g, '.').replace(/\s+/g, '');
}

/** Canonical key for one answered location, or null if it names nothing in the snapshot. */
/** Trim, posix separators, no :line suffix, no ./, and an absolute workspace path made relative (after /app/). */
export function normFile(f: string): string {
  let p = f.trim().replace(/\\/g, '/').replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, '');
  const i = p.lastIndexOf('/app/');
  if (p.startsWith('/') && i >= 0) p = p.slice(i + 5);
  return p;
}

/**
 * The corpus file an answer names. The path as given wins when it is a corpus file. Only otherwise the older
 * cleaning applies (cut before the first "src/", then a unique suffix match), which experiment 3's answers needed.
 * Fix of 2026-11-21 (E11-D07): cleaning first turned "gson/src/main/..." into "src/main/..." and, in monorepos with
 * several packages/<x>/src/, made correct answers ambiguous.
 */
export function resolveFile(index: SymbolIndex, file: string): string {
  const raw = normFile(file);
  if (index.byFile.has(raw)) return raw;
  for (const f of [raw, cleanFile(file)]) {
    if (index.byFile.has(f)) return f;
    const cands = [...index.byFile.keys()].filter((k) => k.endsWith('/' + f) || f.endsWith('/' + k));
    if (cands.length === 1) return cands[0];
  }
  return cleanFile(file);
}

export function resolveLocation(index: SymbolIndex, file: string, symbol: string): string | null {
  const f = resolveFile(index, file);
  const sym = cleanSymbol(symbol);
  const direct = `${f}::${sym}`;
  if (index.byKey.has(direct)) return direct;
  const last = sym.split('.').pop()!;
  const inFile = (index.byFile.get(f) ?? []).filter((s) => s.kind !== 'module' && (s.name === sym || s.name.endsWith('.' + last) || s.name === last));
  if (inFile.length === 1) return inFile[0].key;
  if (inFile.length > 1) { const exact = inFile.find((s) => s.name.endsWith(sym)); if (exact) return exact.key; }
  if (!index.byFile.has(f) && sym.includes('.')) {
    const global = [...index.byKey.keys()].filter((k) => k.endsWith('::' + sym));
    if (global.length === 1) return global[0];
  }
  return null;
}

export interface Exp3Score {
  answered: number; resolved: number;
  rc_at_1: number | null; rc_at_3: number | null; rc_any: number | null;
  recall: number; precision: number | null; path_recall: number | null; impact_recall: number | null;
  task_score: number;
  keys: (string | null)[];
}

export function scoreAnswer(index: SymbolIndex, t: GroundTruthTask, a: Exp3Answer | null): Exp3Score {
  const keys = (a?.locations ?? []).map((l) => resolveLocation(index, l.file, l.symbol));
  const ordered = keys.filter((k): k is string => !!k).filter((k, i, xs) => xs.indexOf(k) === i);
  const rel = new Set(t.relevant_symbols), rc = new Set(t.root_cause_symbols);
  const isA = t.task_type === 'bug_localisation';
  const hitRc = (k: number) => (ordered.slice(0, k).some((x) => rc.has(x)) ? 1 : 0);
  const recall = [...rel].filter((k) => ordered.includes(k)).length / rel.size;
  const precision = ordered.length ? ordered.filter((k) => rel.has(k)).length / ordered.length : null;
  const set = new Set(ordered);
  const path = t.gt_path && t.gt_path.length >= 2 ? t.gt_path : null;
  const path_recall = path ? path.slice(1).filter((k, i) => set.has(path[i]) && set.has(k)).length / (path.length - 1) : null;
  const imp = t.impact ? [...(t.impact.direct ?? []), ...(t.impact.indirect ?? [])] : [];
  const impact_recall = imp.length ? imp.filter((k) => set.has(k)).length / imp.length : null;
  const rc_at_3 = isA ? hitRc(3) : null;
  return {
    answered: a?.locations.length ?? 0, resolved: ordered.length,
    rc_at_1: isA ? hitRc(1) : null, rc_at_3, rc_any: isA ? hitRc(Infinity) : null,
    recall, precision, path_recall, impact_recall,
    task_score: a ? (isA ? rc_at_3! : recall) : 0,
    keys,
  };
}
