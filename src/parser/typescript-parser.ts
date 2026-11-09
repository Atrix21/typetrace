/**
 * TypeScript program creation: tsconfig + explicit corpus files -> ts.Program / TypeChecker.
 * All paths exposed to the rest of the graph code are repo-relative POSIX paths.
 */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

export interface ProjectOptions {
  repoRoot: string;
  /** Repo-relative POSIX paths of the corpus files. */
  files: string[];
  /** Optional tsconfig (absolute, or relative to repoRoot). Defaults to <repoRoot>/tsconfig.json when present. */
  tsconfigPath?: string;
  /**
   * Experiment 3 (scale): external packages whose declaration files total more than this many bytes are loaded as an
   * untyped stub (`any`), so one declaration-heavy dependency cannot exhaust memory. Off when undefined (the default,
   * and the setting of experiments 1-2). Stubbed packages are listed in Project.stubbedPackages / coverage notes.
   */
  maxPackageDeclarationBytes?: number;
}

export interface Project {
  repoRoot: string;
  files: string[]; // sorted corpus (repo-relative)
  program: ts.Program;
  checker: ts.TypeChecker;
  options: ts.CompilerOptions;
  tsconfig: string | null; // repo-relative, or null
  sourceFiles: Map<string, ts.SourceFile>; // rel -> parsed source file (only files the program contains)
  parseFailures: { file: string; error: string }[];
  repoName: string;
  packageJson: { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  /** Repo-relative path of a source file if it is part of the corpus, else null. */
  relOf(sf: ts.SourceFile | string): string | null;
  isLib(sf: ts.SourceFile): boolean;
  /** Packages loaded as untyped stubs (maxPackageDeclarationBytes), with their declaration size in bytes. */
  stubbedPackages: Record<string, number>;
}

const STUB_DECLARATION = 'declare const __stubbedPackage: any;\nexport = __stubbedPackage;\n';

/** Package root directory and name for a file inside node_modules, else null. */
function packageRootOf(file: string): { root: string; name: string } | null {
  const f = file.replace(/\\/g, '/');
  const i = f.lastIndexOf('/node_modules/');
  if (i < 0) return null;
  const rest = f.slice(i + '/node_modules/'.length).split('/');
  const n = rest[0].startsWith('@') ? 2 : 1;
  if (rest.length <= n) return null;
  return { root: f.slice(0, i + '/node_modules/'.length) + rest.slice(0, n).join('/'), name: rest.slice(0, n).join('/') };
}

function declarationBytes(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (/\.d\.(c|m)?ts$/.test(e.name)) { try { total += fs.statSync(p).size; } catch { /* ignore */ } }
    }
  };
  walk(dir);
  return total;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function createProject(opts: ProjectOptions): Project {
  const repoRoot = path.resolve(opts.repoRoot);
  const files = [...opts.files].sort();
  const absByRel = new Map<string, string>();
  const relByAbs = new Map<string, string>();
  for (const f of files) {
    const a = toPosix(path.resolve(repoRoot, f));
    absByRel.set(f, a);
    relByAbs.set(a, f);
  }

  // --- compiler options from tsconfig
  let tsconfig: string | null = null;
  let options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    experimentalDecorators: true, skipLibCheck: true, strict: false,
  };
  const extraRoots: string[] = []; // ambient .d.ts files matched by tsconfig "include"
  const cfgPath = opts.tsconfigPath
    ? path.resolve(repoRoot, opts.tsconfigPath)
    : fs.existsSync(path.join(repoRoot, 'tsconfig.json')) ? path.join(repoRoot, 'tsconfig.json') : null;
  if (cfgPath && fs.existsSync(cfgPath)) {
    tsconfig = toPosix(path.relative(repoRoot, cfgPath));
    const read = ts.readConfigFile(cfgPath, ts.sys.readFile);
    if (!read.error) {
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(cfgPath), undefined, cfgPath);
      options = parsed.options;
      for (const f of parsed.fileNames) if (f.endsWith('.d.ts') && !f.includes('/node_modules/')) extraRoots.push(toPosix(f));
    }
  }
  options = {
    ...options,
    noEmit: true, incremental: false, composite: false, tsBuildInfoFile: undefined,
    declaration: false, declarationMap: false, sourceMap: false, emitDeclarationOnly: false,
    allowJs: false, checkJs: false, noResolve: false,
  };

  const rootNames = [...new Set([...files.map((f) => absByRel.get(f)!).filter((a) => fs.existsSync(a)), ...extraRoots])];
  const host = ts.createCompilerHost(options, true);
  const stubbedPackages: Record<string, number> = {};
  if (opts.maxPackageDeclarationBytes !== undefined) {
    const limit = opts.maxPackageDeclarationBytes;
    const sizeOf = new Map<string, number>();
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, lang, onError, shouldCreate) => {
      const pk = packageRootOf(fileName);
      if (pk && /\.d\.(c|m)?ts$/.test(fileName)) {
        let size = sizeOf.get(pk.root);
        if (size === undefined) sizeOf.set(pk.root, (size = declarationBytes(pk.root)));
        if (size > limit) {
          stubbedPackages[pk.name] = size;
          return ts.createSourceFile(fileName, STUB_DECLARATION, lang, true);
        }
      }
      return getSourceFile(fileName, lang, onError, shouldCreate);
    };
  }
  const program = ts.createProgram({ rootNames, options, host });
  const checker = program.getTypeChecker();

  const sourceFiles = new Map<string, ts.SourceFile>();
  const parseFailures: { file: string; error: string }[] = [];
  for (const f of files) {
    const sf = program.getSourceFile(absByRel.get(f)!);
    if (!sf) {
      parseFailures.push({ file: f, error: fs.existsSync(absByRel.get(f)!) ? 'not included in program' : 'file not found' });
      continue;
    }
    sourceFiles.set(f, sf);
    const diags = program.getSyntacticDiagnostics(sf);
    if (diags.length) parseFailures.push({ file: f, error: ts.flattenDiagnosticMessageText(diags[0].messageText, '\n').slice(0, 200) });
  }

  let pkg: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')); } catch { /* none */ }

  const relOf = (sf: ts.SourceFile | string): string | null =>
    relByAbs.get(typeof sf === 'string' ? sf : sf.fileName) ?? null;

  return {
    repoRoot, files, program, checker, options, tsconfig, sourceFiles, parseFailures,
    repoName: pkg.name ?? path.basename(repoRoot),
    packageJson: { dependencies: pkg.dependencies ?? {}, devDependencies: pkg.devDependencies ?? {} },
    relOf,
    isLib: (sf) => program.isSourceFileDefaultLibrary(sf),
    stubbedPackages,
  };
}

// ---- position helpers (lines and columns are both 1-based)
export interface Span { start_line: number; end_line: number; start_col: number; end_col: number }

export function spanOf(sf: ts.SourceFile, node: ts.Node): Span {
  const s = sf.getLineAndCharacterOfPosition(node.getStart(sf, false));
  const e = sf.getLineAndCharacterOfPosition(node.getEnd());
  return { start_line: s.line + 1, end_line: e.line + 1, start_col: s.character + 1, end_col: e.character + 1 };
}

export function lineColOfPos(sf: ts.SourceFile, pos: number): { line: number; col: number } {
  const p = sf.getLineAndCharacterOfPosition(pos);
  return { line: p.line + 1, col: p.character + 1 };
}

export function startOf(sf: ts.SourceFile, node: ts.Node): { line: number; col: number } {
  return lineColOfPos(sf, node.getStart(sf, false));
}

/** Collapse whitespace and truncate for evidence/meta text. */
export function shortText(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
