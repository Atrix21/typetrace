#!/usr/bin/env tsx
/**
 * Experiment 3 executable oracle for change-impact tasks (category C): apply the task's scripted edit IN MEMORY (no file
 * is written), type-check the files that transitively import the edited file, and diff the diagnostics against the
 * unedited program. Direct impact = declarations enclosing NEW errors (non-test files); tests = spec files with new
 * errors. Independent of every retrieval method: only the TypeScript checker decides.
 *
 *   npx tsx scripts/exp3/oracle-impact.ts --repo immich|twenty [--only task_id]
 * Output: experiments/03-graph-scale/dataset/evidence/<repo>-impact-oracle.json
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { abs, listCorpusFiles } from '../../src/config.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import { REPOS, type RepoName } from './tasks.js';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const repo = arg('repo') as RepoName;
const only = arg('only');
const root = abs(REPOS[repo].corpusRoot);
const TEST = /(\.spec\.|\.test\.|\/__tests__\/|\/test\/)/;
const drafts = abs(`experiments/03-graph-scale/dataset/drafts/${repo}`);
const tasks = fs.readdirSync(drafts).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(drafts, f), 'utf8')))
  .filter((t) => t.task_type === 'change_impact' && t.oracle_edit && (!only || t.task_id === only));

const cfgPath = path.join(root, 'tsconfig.json');
const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, root, undefined, cfgPath);
const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, incremental: false, composite: false, declaration: false, sourceMap: false };
const files = listCorpusFiles(root, ['src']).map((f) => path.join(root, f));
// Same stub rule as the graph builds (E3-D13/D15): --stub-mb 50 for M, 0 (all third-party) for L.
const STUB_LIMIT = Number(arg('stub-mb') ?? (repo === 'twenty' ? 0 : 50)) * 1e6;
const sizeOf = new Map<string, number>();
const LIB_DIR = path.dirname(ts.getDefaultLibFilePath(options));
function pkgTooBig(fileName: string): boolean {
  const i = fileName.lastIndexOf('/node_modules/');
  if (i < 0 || !/\.d\.(c|m)?ts$/.test(fileName) || fileName.startsWith(LIB_DIR + '/') || fileName.slice(i + 14).startsWith('@types/')) return false;
  const rest = fileName.slice(i + 14).split('/');
  const dir = fileName.slice(0, i + 14) + rest.slice(0, rest[0].startsWith('@') ? 2 : 1).join('/');
  if (!sizeOf.has(dir)) { let t = 0; const w = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') w(p); } else if (/\.d\.(c|m)?ts$/.test(e.name)) t += fs.statSync(p).size; } }; try { w(dir); } catch { /* */ } sizeOf.set(dir, t); }
  return sizeOf.get(dir)! > STUB_LIMIT;
}
function makeHost(override?: { file: string; text: string }): ts.CompilerHost {
  const h = ts.createCompilerHost(options, true);
  const get = h.getSourceFile.bind(h);
  h.getSourceFile = (fn, lang, onErr, create) => {
    if (override && path.resolve(fn) === override.file) return ts.createSourceFile(fn, override.text, lang, true);
    if (pkgTooBig(fn)) return ts.createSourceFile(fn, 'declare const __stub: any;\nexport = __stub;\n', lang, true);
    return get(fn, lang, onErr, create);
  };
  return h;
}

/** Corpus files that transitively import `target` (resolved module graph of the program). */
function importers(program: ts.Program, target: string): Set<string> {
  const rev = new Map<string, Set<string>>();
  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes('/node_modules/')) continue;
    for (const imp of sf.statements) {
      if (!(ts.isImportDeclaration(imp) || ts.isExportDeclaration(imp)) || !imp.moduleSpecifier || !ts.isStringLiteral(imp.moduleSpecifier)) continue;
      const r = ts.resolveModuleName(imp.moduleSpecifier.text, sf.fileName, options, ts.sys).resolvedModule;
      if (!r) continue;
      const to = path.resolve(r.resolvedFileName);
      let s = rev.get(to); if (!s) rev.set(to, (s = new Set())); s.add(path.resolve(sf.fileName));
    }
  }
  const out = new Set<string>([target]);
  const q = [target];
  while (q.length) { const x = q.pop()!; for (const y of rev.get(x) ?? []) if (!out.has(y)) { out.add(y); q.push(y); } }
  return out;
}

const diagKey = (d: ts.Diagnostic) => `${d.code}|${ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 200)}`;
const results: Record<string, unknown>[] = [];
for (const t of tasks) {
  const e = t.oracle_edit;
  const file = path.join(root, e.file);
  const text = fs.readFileSync(file, 'utf8');
  const n = text.split(e.old).length - 1;
  if (n !== 1) { results.push({ task_id: t.task_id, status: 'edit_not_unique', occurrences: n }); continue; }
  const t0 = performance.now();
  const base = ts.createProgram({ rootNames: files, options, host: makeHost() });
  const scope = importers(base, path.resolve(file));
  const before = new Map<string, Set<string>>();
  for (const f of scope) { const sf = base.getSourceFile(f); if (sf) before.set(f, new Set(base.getSemanticDiagnostics(sf).map(diagKey))); }
  const edited = ts.createProgram({ rootNames: files, options, host: makeHost({ file: path.resolve(file), text: text.replace(e.old, e.new) }), oldProgram: base });
  const newErr: { file: string; line: number; key: string }[] = [];
  for (const f of scope) {
    const sf = edited.getSourceFile(f);
    if (!sf) continue;
    for (const d of edited.getSemanticDiagnostics(sf)) {
      if (before.get(f)?.has(diagKey(d))) continue;
      const line = d.start !== undefined ? sf.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
      newErr.push({ file: path.relative(root, f), line, key: diagKey(d) });
    }
  }
  const errFiles = [...new Set(newErr.map((x) => x.file))];
  const idx = new SymbolIndex(root, errFiles.filter((f) => !TEST.test(f)));
  const direct = new Set<string>();
  for (const x of newErr) {
    if (TEST.test(x.file)) continue;
    const s = (idx.byFile.get(x.file) ?? []).filter((y) => y.kind !== 'module' && y.start_line <= x.line && x.line <= y.end_line).sort((a, b) => (a.end_line - a.start_line) - (b.end_line - b.start_line))[0];
    direct.add(s ? s.key : `${x.file}::<module>`);
  }
  results.push({
    task_id: t.task_id, status: 'ok', edit: { file: e.file, note: e.note }, scope_files: scope.size, new_errors: newErr.length,
    direct_impact: [...direct].sort(), tests_with_errors: errFiles.filter((f) => TEST.test(f)).sort(), errors_sample: newErr.slice(0, 20), ms: Math.round(performance.now() - t0),
  });
  console.error(`${t.task_id}: ${newErr.length} new errors in ${errFiles.length} files; direct ${direct.size}`);
}
const out = abs(`experiments/03-graph-scale/dataset/evidence/${repo}-impact-oracle.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generated_by: 'scripts/exp3/oracle-impact.ts', repo, results }, null, 2) + '\n');
console.log(`wrote ${out}`);
