/**
 * Language registry. TypeScript (and JavaScript via the same compiler) use the typed TypeScript-compiler front-end;
 * every other language uses a tree-sitter front-end (WebAssembly grammars from tree-sitter-wasms, no native build).
 * `initLanguages()` must be awaited once per process before any tree-sitter parse; parsing is synchronous afterwards.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { Language, Parser, type Tree } from 'web-tree-sitter';

export type LangId = 'typescript' | 'python' | 'go' | 'java' | 'rust' | 'javascript';
export interface LangSpec { id: LangId; exts: string[]; grammar: string | null; tier: 'typed' | 'resolved' | 'basic' }

export const LANGUAGES: LangSpec[] = [
  { id: 'typescript', exts: ['.ts', '.tsx'], grammar: null, tier: 'typed' },
  { id: 'python', exts: ['.py'], grammar: 'python', tier: 'resolved' },
  { id: 'go', exts: ['.go'], grammar: 'go', tier: 'basic' },
  { id: 'java', exts: ['.java'], grammar: 'java', tier: 'basic' },
  { id: 'rust', exts: ['.rs'], grammar: 'rust', tier: 'basic' },
  { id: 'javascript', exts: ['.js', '.jsx', '.mjs', '.cjs'], grammar: 'javascript', tier: 'basic' },
];

export function langOf(file: string): LangSpec | null {
  if (file.endsWith('.d.ts')) return null;
  const ext = path.extname(file);
  return LANGUAGES.find((l) => l.exts.includes(ext)) ?? null;
}

const require = createRequire(import.meta.url);
const languages = new Map<string, Language>();
const parsers = new Map<string, Parser>();
let initialised: Promise<void> | null = null;

/** Load the tree-sitter runtime and every grammar once. Idempotent. */
export function initLanguages(): Promise<void> {
  initialised ??= (async () => {
    await Parser.init();
    const dir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
    for (const l of LANGUAGES) {
      if (!l.grammar) continue;
      const lang = await Language.load(path.join(dir, `tree-sitter-${l.grammar}.wasm`));
      const p = new Parser();
      p.setLanguage(lang);
      languages.set(l.id, lang);
      parsers.set(l.id, p);
    }
  })();
  return initialised;
}

export function parse(lang: LangId, text: string): Tree {
  const p = parsers.get(lang);
  if (!p) throw new Error(`tree-sitter grammar for ${lang} not loaded: await initLanguages() first`);
  const t = p.parse(text);
  if (!t) throw new Error(`tree-sitter failed to parse (${lang})`);
  return t;
}
