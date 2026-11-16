/** Which files TypeTrace indexes in a repository (shared by the CLI and the language reports). */
import fs from 'node:fs';
import path from 'node:path';
import { listCorpusFiles } from '../config.js';
import { ALL_EXTS, headerLang, langOf } from '../languages/registry.js';

// Build output, dependencies, virtualenvs and generated code are not indexed.
const SKIP = /(^|\/)(node_modules|bower_components|dist|build|out|target|obj|\.venv|venv|site-packages|__pycache__|vendor|third_party|Pods|Carthage|DerivedData|coverage|\.next|\.nuxt|\.svelte-kit)(\/|$)/;
const GENERATED = /\.(min|bundle)\.js$|\.pb\.(go|cc|h)$|_pb2(_grpc)?\.py$|\.g\.(cs|dart)$|\.designer\.cs$|_generated\.go$/i;
const MAX_FILE_BYTES = 1_000_000;

/** Source files TypeTrace indexes (every supported language), excluding build output, dependencies and generated code. */
export function sourceFiles(repo: string, include: string[]): string[] {
  return listCorpusFiles(repo, include, ALL_EXTS).filter((f) => !SKIP.test(f) && !GENERATED.test(f) && langOf(f) && fs.statSync(path.join(repo, f)).size <= MAX_FILE_BYTES);
}

/** "120 Go, 31 TypeScript" */
export function languageSummary(files: string[]): string {
  const h = headerLang(files), n = new Map<string, number>();
  for (const f of files) { const l = langOf(f, h); if (l) n.set(l.name, (n.get(l.name) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(', ');
}
