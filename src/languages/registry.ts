/**
 * Language registry. TypeScript and JavaScript use the TypeScript-compiler front-end (types and module resolution
 * from the compiler); Python has its own scope-resolving tree-sitter front-end; the other languages share the
 * tree-sitter front-end in `syntactic.ts`. Grammars are WebAssembly builds from tree-sitter-wasms (no native build).
 *
 * `initLanguages(ids)` must be awaited before any tree-sitter parse of those languages; parsing is synchronous after.
 * Grammars load on demand (some take seconds), so a process only pays for the languages its files use.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser, type Tree } from 'web-tree-sitter';

export type LangId = 'typescript' | 'javascript' | 'python' | 'go' | 'java' | 'kotlin' | 'scala' | 'csharp' | 'rust' | 'c' | 'cpp' | 'ruby' | 'php' | 'swift';
/** typed: TypeScript compiler; resolved: Python scope/import resolution; syntactic: tree-sitter with declared types, imports and names. */
export type Tier = 'typed' | 'resolved' | 'syntactic';
/** `vendored`: the grammar's .wasm ships in this package's grammars/ (a newer build than tree-sitter-wasms has). */
export interface LangSpec { id: LangId; name: string; exts: string[]; grammar: string | null; tier: Tier; vendored?: boolean }

export const LANGUAGES: LangSpec[] = [
  { id: 'typescript', name: 'TypeScript', exts: ['.ts', '.tsx', '.mts', '.cts'], grammar: null, tier: 'typed' },
  { id: 'javascript', name: 'JavaScript', exts: ['.js', '.jsx', '.mjs', '.cjs'], grammar: null, tier: 'typed' },
  { id: 'python', name: 'Python', exts: ['.py'], grammar: 'python', tier: 'resolved' },
  { id: 'go', name: 'Go', exts: ['.go'], grammar: 'go', tier: 'syntactic' },
  { id: 'java', name: 'Java', exts: ['.java'], grammar: 'java', tier: 'syntactic' },
  { id: 'kotlin', name: 'Kotlin', exts: ['.kt'], grammar: 'kotlin', tier: 'syntactic', vendored: true },
  { id: 'scala', name: 'Scala', exts: ['.scala'], grammar: 'scala', tier: 'syntactic', vendored: true },
  { id: 'csharp', name: 'C#', exts: ['.cs'], grammar: 'c_sharp', tier: 'syntactic' },
  { id: 'rust', name: 'Rust', exts: ['.rs'], grammar: 'rust', tier: 'syntactic' },
  { id: 'c', name: 'C', exts: ['.c', '.h'], grammar: 'c', tier: 'syntactic' },
  { id: 'cpp', name: 'C++', exts: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++'], grammar: 'cpp', tier: 'syntactic' },
  { id: 'ruby', name: 'Ruby', exts: ['.rb'], grammar: 'ruby', tier: 'syntactic' },
  { id: 'php', name: 'PHP', exts: ['.php'], grammar: 'php', tier: 'syntactic' },
  { id: 'swift', name: 'Swift', exts: ['.swift'], grammar: 'swift', tier: 'syntactic' },
];
export const ALL_EXTS = LANGUAGES.flatMap((l) => l.exts);
const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));
export const spec = (id: LangId): LangSpec => BY_ID.get(id)!;

/** `.h` is C++ when the repository has any C++ source, else C. */
export type HeaderLang = 'c' | 'cpp';
export function headerLang(files: string[]): HeaderLang {
  return files.some((f) => spec('cpp').exts.includes(path.extname(f)) && !f.endsWith('.h')) ? 'cpp' : 'c';
}

export function langOf(file: string, header: HeaderLang = 'c'): LangSpec | null {
  if (/\.d\.(c|m)?ts$/.test(file)) return null;
  const ext = path.extname(file);
  if (ext === '.h') return spec(header);
  return LANGUAGES.find((l) => l.exts.includes(ext)) ?? null;
}

/** Languages (with a tree-sitter grammar) used by these files. */
export function grammarLanguages(files: string[]): LangId[] {
  const h = headerLang(files);
  const out = new Set<LangId>();
  for (const f of files) { const l = langOf(f, h); if (l?.grammar) out.add(l.id); }
  return [...out].sort();
}

const require = createRequire(import.meta.url);
const parsers = new Map<LangId, Parser>();
const loading = new Map<LangId, Promise<void>>();
let runtime: Promise<void> | null = null;

/** Load the tree-sitter runtime and the grammars of `ids` (default: Python). Idempotent. */
export async function initLanguages(ids: LangId[] = ['python']): Promise<void> {
  runtime ??= Parser.init();
  await runtime;
  const dir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
  const vendored = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'grammars'); // src/languages or dist/languages
  await Promise.all(ids.map((id) => {
    const g = spec(id).grammar;
    if (!g) return Promise.resolve();
    let p = loading.get(id);
    if (!p) {
      p = Language.load(path.join(spec(id).vendored ? vendored : dir, `tree-sitter-${g}.wasm`)).then((lang) => { const ps = new Parser(); ps.setLanguage(lang); parsers.set(id, ps); });
      loading.set(id, p);
    }
    return p;
  }));
}

export function parse(lang: LangId, text: string): Tree {
  const p = parsers.get(lang);
  if (!p) throw new Error(`tree-sitter grammar for ${lang} not loaded: await initLanguages(['${lang}']) first`);
  const t = p.parse(text);
  if (!t) throw new Error(`tree-sitter failed to parse (${lang})`);
  return t;
}
