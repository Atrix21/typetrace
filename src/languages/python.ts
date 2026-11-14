/**
 * Python front-end (tree-sitter). Emits the same graph schema as the TypeScript front-end, so ranking, graph
 * propagation and rendering are unchanged.
 *
 * Declarations: modules, classes, functions, methods (qualified `Class.method`, nested `outer.inner`).
 * Edges:
 *   CONTAINS   repository -> file -> class/function -> method
 *   IMPORTS    file -> file (absolute, relative and `from pkg import submodule`)
 *   EXTENDS    class -> base class (resolved through scopes and imports)
 *   CALLS      enclosing function/method/module -> callee, resolved syntactically:
 *                f()                      enclosing function scopes, module definitions, imported names (re-exports followed)
 *                self.m() / cls.m()       method of the enclosing class or its bases (MRO order)
 *                super().m()              method of a base class
 *                X() / X.m()              class constructor (__init__) / class attribute
 *                mod.f() / pkg.mod.f()    function in an imported module
 *                self.attr.m()            attr typed from `self.attr = X(...)` anywhere in the class
 *              these are `static_verified` (syntax, no guesswork, confidence 0.8–1.0);
 *                obj.m() with an unknown receiver -> every method named m when there are at most 3 in the repository,
 *              `semantic_inferred`, confidence 0.3/n; otherwise no edge.
 *   INSTANTIATES  caller -> class for X()
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Node as TSNode } from 'web-tree-sitter';
import type { GraphEdge, GraphNode } from '../graph/graph-schema.js';
import { GraphCtx } from '../parser/graph-context.js';
import { parse } from './registry.js';

export interface Decl { key: string; file: string; name: string; kind: 'function' | 'method' | 'class' | 'module'; start_line: number; end_line: number; parent: string | null }

/** Syntactic declaration spans (for the symbol index / chunking / scoring). */
export function pythonDeclarations(file: string, text: string): Decl[] {
  const out: Decl[] = [];
  const tree = parse('python', text);
  const lines = text.split('\n').length;
  out.push({ key: `${file}::<module>`, file, name: '<module>', kind: 'module', start_line: 1, end_line: lines, parent: null });
  const visit = (n: TSNode, scope: string[], cls: string | null) => {
    for (const c of n.namedChildren) {
      if (!c) continue;
      const d = c.type === 'decorated_definition' ? c.childForFieldName('definition') : c;
      const startNode = c; // decorators included in the span
      if (d && (d.type === 'function_definition' || d.type === 'class_definition')) {
        const nm = d.childForFieldName('name')?.text;
        if (!nm) continue;
        const q = [...scope, nm].join('.');
        const kind = d.type === 'class_definition' ? 'class' : cls && scope.length && scope[scope.length - 1] === cls ? 'method' : 'function';
        const parent = d.type === 'function_definition' && cls && scope[scope.length - 1] === cls ? `${file}::${scope.join('.')}` : null;
        out.push({ key: `${file}::${q}`, file, name: q, kind, start_line: startNode.startPosition.row + 1, end_line: d.endPosition.row + 1, parent });
        const body = d.childForFieldName('body');
        if (body) visit(body, [...scope, nm], d.type === 'class_definition' ? nm : null);
      } else if (c.type !== 'function_definition' && c.type !== 'class_definition' && c.namedChildCount && !['block', 'string'].includes(c.type)) {
        // descend into if/try/with blocks at the same scope (e.g. definitions under `if TYPE_CHECKING:`)
        if (['if_statement', 'try_statement', 'with_statement', 'else_clause', 'elif_clause', 'except_clause', 'finally_clause', 'block'].includes(c.type)) visit(c, scope, cls);
      } else if (c.type === 'block') visit(c, scope, cls);
    }
  };
  visit(tree.rootNode, [], null);
  tree.delete();
  return out;
}

/* ------------------------------------------------------------------------------------------------------------ */

interface Def { id: string; kind: 'function' | 'method' | 'class'; name: string; qualified: string; file: string; node: TSNode; cls: string | null; scope: string[] }
interface FileInfo { rel: string; module: string; isPkg: boolean; tree: ReturnType<typeof parse>; defs: Map<string, Def>; topNames: Map<string, string>; imports: Map<string, { kind: 'module'; target: string } | { kind: 'symbol'; module: string; name: string }> }

const BUILTIN_NOISE = new Set(['get', 'set', 'append', 'extend', 'items', 'keys', 'values', 'update', 'pop', 'add', 'join', 'split', 'format', 'strip', 'replace', 'startswith', 'endswith', 'lower', 'upper', 'copy', 'remove', 'insert', 'index', 'count', 'read', 'write', 'close', 'open', 'encode', 'decode', 'sort', 'clear', 'setdefault', '__init__']);

function moduleName(rel: string): { module: string; isPkg: boolean } {
  const noExt = rel.replace(/\.py$/, '');
  const isPkg = noExt.endsWith('/__init__') || noExt === '__init__';
  const mod = (isPkg ? noExt.replace(/\/?__init__$/, '') : noExt).split('/').join('.');
  return { module: mod, isPkg };
}

export function buildPythonGraph(repoRoot: string, files: string[], repoName = path.basename(repoRoot)): { nodes: GraphNode[]; edges: GraphEdge[]; build_ms: number; notes: string[] } {
  const t0 = performance.now();
  const ctx = new GraphCtx();
  const notes: string[] = [];
  const repoId = `repository:${repoName}`;
  ctx.node('repository', repoId, repoName, null, null, null, { language: 'python', file_count: files.length });
  const S = (extraction: string, conf = 1) => ({ extraction, confidence: conf, verification: 'static_verified' as const });

  // module -> file, with suffix aliases so `src/` layouts and repo-relative roots both resolve
  const infos = new Map<string, FileInfo>();
  const byModule = new Map<string, string>();
  for (const rel of files) {
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    const { module, isPkg } = moduleName(rel);
    const tree = parse('python', text);
    infos.set(rel, { rel, module, isPkg, tree, defs: new Map(), topNames: new Map(), imports: new Map() });
    const parts = module.split('.');
    for (let i = 0; i < parts.length; i++) {
      const m = parts.slice(i).join('.');
      if (!byModule.has(m) || i === 0) byModule.set(m, rel);
    }
    const lines = text.split('\n').length;
    ctx.node('file', `file:${rel}`, rel.split('/').pop()!, '<module>', rel, { start_line: 1, end_line: lines, start_col: 1, end_col: 1 },
      { symbol_key: `${rel}::<module>`, path: rel, language: 'python', lines, is_test: /(^|\/)(tests?|testing)\/|(^|\/)test_[^/]*\.py$|_test\.py$/.test(rel) });
    ctx.edge({ type: 'CONTAINS', src: repoId, dst: `file:${rel}`, file: rel, line: 1, col: 1, ...S('py-syntax'), key: 'contains' });
  }
  const resolveModule = (name: string): string | null => byModule.get(name) ?? null;

  // pass 1: declarations
  const methodsByName = new Map<string, Def[]>();
  const classBases = new Map<string, TSNode[]>(); // class def id -> base expression nodes
  for (const fi of infos.values()) {
    const visit = (n: TSNode, scope: string[], cls: string | null, parentId: string) => {
      for (const c of n.namedChildren) {
        if (!c) continue;
        const d = c.type === 'decorated_definition' ? c.childForFieldName('definition') : c;
        if (d && (d.type === 'function_definition' || d.type === 'class_definition')) {
          const nm = d.childForFieldName('name')?.text;
          if (!nm) continue;
          const qualified = [...scope, nm].join('.');
          const isClass = d.type === 'class_definition';
          const kind: Def['kind'] = isClass ? 'class' : cls && scope[scope.length - 1] === cls ? 'method' : 'function';
          const id = `${kind}:${fi.rel}::${qualified}`;
          const params = d.childForFieldName('parameters')?.text ?? '';
          const sig = isClass ? `class ${nm}${d.childForFieldName('superclasses')?.text ?? ''}` : `def ${nm}${params.length > 160 ? params.slice(0, 157) + '...)' : params}`;
          ctx.node(kind, id, nm, qualified, fi.rel, { start_line: c.startPosition.row + 1, end_line: d.endPosition.row + 1, start_col: c.startPosition.column + 1, end_col: d.endPosition.column + 1 },
            { symbol_key: `${fi.rel}::${qualified}`, signature: sig, language: 'python', decorators: c.type === 'decorated_definition' ? c.namedChildren.filter((x) => x?.type === 'decorator').map((x) => x!.text.slice(0, 80)) : [] });
          ctx.edge({ type: 'CONTAINS', src: parentId, dst: id, file: fi.rel, line: c.startPosition.row + 1, col: 1, ...S('py-syntax'), key: 'contains' });
          const def: Def = { id, kind, name: nm, qualified, file: fi.rel, node: d, cls: kind === 'method' ? cls : null, scope };
          fi.defs.set(qualified, def);
          if (!scope.length) fi.topNames.set(nm, id);
          if (kind === 'method') { const a = methodsByName.get(nm) ?? []; a.push(def); methodsByName.set(nm, a); }
          if (isClass) classBases.set(id, (d.childForFieldName('superclasses')?.namedChildren ?? []).filter((x): x is TSNode => !!x && x.type !== 'keyword_argument'));
          const body = d.childForFieldName('body');
          if (body) visit(body, [...scope, nm], isClass ? nm : null, id);
        } else if (['if_statement', 'try_statement', 'with_statement', 'else_clause', 'elif_clause', 'except_clause', 'finally_clause', 'block'].includes(c.type)) {
          visit(c, scope, cls, parentId);
        }
      }
    };
    visit(fi.tree.rootNode, [], null, `file:${fi.rel}`);
  }

  // pass 2: imports (module level and nested)
  for (const fi of infos.values()) {
    const pkgOf = (level: number) => { const p = fi.module.split('.'); return p.slice(0, Math.max(0, p.length - (fi.isPkg ? level - 1 : level))).join('.'); };
    const walk = (n: TSNode) => {
      for (const c of n.namedChildren) {
        if (!c) continue;
        if (c.type === 'import_statement') {
          for (const x of c.namedChildren) {
            if (!x) continue;
            const full = x.type === 'aliased_import' ? x.childForFieldName('name')!.text : x.text;
            const alias = x.type === 'aliased_import' ? x.childForFieldName('alias')!.text : full.split('.')[0];
            const target = x.type === 'aliased_import' ? full : full.split('.')[0];
            fi.imports.set(alias, { kind: 'module', target });
            const f = resolveModule(full);
            if (f) ctx.edge({ type: 'IMPORTS', src: `file:${fi.rel}`, dst: `file:${f}`, file: fi.rel, line: c.startPosition.row + 1, col: 1, ...S('py-import'), evidence: c.text.slice(0, 120) });
          }
        } else if (c.type === 'import_from_statement') {
          const modNode = c.childForFieldName('module_name');
          let base = modNode?.text ?? '';
          if (modNode?.type === 'relative_import') {
            const dots = (base.match(/^\.+/) ?? [''])[0].length;
            const rest = base.slice(dots);
            base = [pkgOf(dots), rest].filter(Boolean).join('.');
          }
          for (const x of c.namedChildren) {
            if (!x || x === modNode || x.type === 'wildcard_import') continue;
            if (x.type !== 'dotted_name' && x.type !== 'aliased_import') continue;
            const nm = x.type === 'aliased_import' ? x.childForFieldName('name')!.text : x.text;
            const alias = x.type === 'aliased_import' ? x.childForFieldName('alias')!.text : nm;
            const sub = resolveModule(`${base}.${nm}`);
            fi.imports.set(alias, sub ? { kind: 'module', target: `${base}.${nm}` } : { kind: 'symbol', module: base, name: nm });
          }
          const f = resolveModule(base);
          if (f && f !== fi.rel) ctx.edge({ type: 'IMPORTS', src: `file:${fi.rel}`, dst: `file:${f}`, file: fi.rel, line: c.startPosition.row + 1, col: 1, ...S('py-import'), evidence: c.text.slice(0, 120) });
        } else if (c.type !== 'function_definition' && c.type !== 'class_definition' && c.namedChildCount) walk(c);
      }
    };
    walk(fi.tree.rootNode);
  }

  /** Symbol `name` exported by module `mod` (follows re-exports up to 4 hops). Returns a def id or a module file. */
  const lookupIn = (mod: string, name: string, depth = 0): { def?: string; module?: string } | null => {
    const f = resolveModule(mod);
    if (!f || depth > 4) return null;
    const fi = infos.get(f)!;
    const top = fi.topNames.get(name);
    if (top) return { def: top };
    const imp = fi.imports.get(name);
    if (imp?.kind === 'symbol') return lookupIn(imp.module, imp.name, depth + 1);
    if (imp?.kind === 'module') return { module: imp.target };
    if (resolveModule(`${mod}.${name}`)) return { module: `${mod}.${name}` };
    return null;
  };
  const resolveName = (fi: FileInfo, name: string, scopes: string[][]): { def?: string; module?: string } | null => {
    for (const sc of scopes) { const d = fi.defs.get([...sc, name].join('.')); if (d && (sc.length === 0 || d.kind !== 'method')) return { def: d.id }; }
    const top = fi.topNames.get(name);
    if (top) return { def: top };
    const imp = fi.imports.get(name);
    if (imp?.kind === 'symbol') return lookupIn(imp.module, imp.name);
    if (imp?.kind === 'module') return { module: imp.target };
    return null;
  };
  const defById = new Map<string, Def>();
  for (const fi of infos.values()) for (const d of fi.defs.values()) defById.set(d.id, d);

  // EXTENDS + MRO
  const bases = new Map<string, string[]>();
  for (const [cid, exprs] of classBases) {
    const c = defById.get(cid)!; const fi = infos.get(c.file)!;
    const out: string[] = [];
    for (const e of exprs) {
      const r = resolveExpr(fi, e, c.scope);
      if (r?.def && defById.get(r.def)?.kind === 'class') { out.push(r.def); ctx.edge({ type: 'EXTENDS', src: cid, dst: r.def, file: c.file, line: e.startPosition.row + 1, col: e.startPosition.column + 1, ...S('py-scope'), evidence: e.text.slice(0, 80) }); }
    }
    bases.set(cid, out);
  }
  function resolveExpr(fi: FileInfo, e: TSNode, scope: string[]): { def?: string; module?: string } | null {
    if (e.type === 'identifier') return resolveName(fi, e.text, scopesOf(scope));
    if (e.type === 'attribute') {
      const obj = e.childForFieldName('object'); const attr = e.childForFieldName('attribute')?.text;
      if (!obj || !attr) return null;
      const r = resolveExpr(fi, obj, scope);
      if (r?.module) return lookupIn(r.module, attr);
      if (r?.def && defById.get(r.def)?.kind === 'class') { const m = methodOf(r.def, attr); return m ? { def: m } : null; }
    }
    return null;
  }
  function scopesOf(scope: string[]): string[][] { const out: string[][] = []; for (let i = scope.length; i >= 0; i--) out.push(scope.slice(0, i)); return out; }
  function methodOf(classId: string, name: string, seen = new Set<string>()): string | null {
    if (seen.has(classId)) return null;
    seen.add(classId);
    const c = defById.get(classId); if (!c) return null;
    const own = infos.get(c.file)!.defs.get(`${c.qualified}.${name}`);
    if (own) return own.id;
    for (const b of bases.get(classId) ?? []) { const m = methodOf(b, name, seen); if (m) return m; }
    return null;
  }

  // self.attr types: self.x = ClassName(...) anywhere in a class's methods
  const attrTypes = new Map<string, Map<string, string>>();
  for (const fi of infos.values()) for (const d of fi.defs.values()) {
    if (d.kind !== 'method' || !d.cls) continue;
    const clsId = `class:${fi.rel}::${d.scope.join('.')}`;
    const stack: TSNode[] = [d.node];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.type === 'assignment') {
        const l = n.childForFieldName('left'), r = n.childForFieldName('right');
        if (l?.type === 'attribute' && l.childForFieldName('object')?.text === 'self' && r?.type === 'call') {
          const t = resolveExpr(fi, r.childForFieldName('function')!, d.scope);
          if (t?.def && defById.get(t.def)?.kind === 'class') { let m = attrTypes.get(clsId); if (!m) attrTypes.set(clsId, (m = new Map())); m.set(l.childForFieldName('attribute')!.text, t.def); }
        }
      }
      for (const c of n.namedChildren) if (c && c.type !== 'function_definition' && c.type !== 'class_definition') stack.push(c);
    }
  }

  // pass 3: calls
  let resolved = 0, inferred = 0, unresolved = 0;
  for (const fi of infos.values()) {
    const owners: { id: string; node: TSNode; scope: string[]; cls: string | null }[] = [{ id: `file:${fi.rel}`, node: fi.tree.rootNode, scope: [], cls: null }];
    for (const d of fi.defs.values()) if (d.kind !== 'class') owners.push({ id: d.id, node: d.node, scope: [...d.scope, d.name], cls: d.cls ? `class:${fi.rel}::${d.scope.join('.')}` : null });
    for (const o of owners) {
      const stack: TSNode[] = [o.node.type === 'module' ? o.node : o.node.childForFieldName('body')!].filter(Boolean);
      while (stack.length) {
        const n = stack.pop()!;
        for (const c of n.namedChildren) if (c && c.type !== 'function_definition' && c.type !== 'class_definition' && c.type !== 'decorated_definition') stack.push(c);
        if (n.type !== 'call') continue;
        const fn = n.childForFieldName('function');
        if (!fn) continue;
        const line = n.startPosition.row + 1, col = n.startPosition.column + 1, ev = n.text.slice(0, 100);
        const emit = (dst: string, conf: number, how: string, verification: 'static_verified' | 'semantic_inferred' = 'static_verified') => {
          ctx.edge({ type: 'CALLS', src: o.id, dst, file: fi.rel, line, col, extraction: how, confidence: conf, verification, evidence: ev });
        };
        let target: string | null = null;
        if (fn.type === 'identifier' || (fn.type === 'attribute' && fn.childForFieldName('object')?.type !== 'call')) {
          const obj = fn.type === 'attribute' ? fn.childForFieldName('object') : null;
          const attr = fn.type === 'attribute' ? fn.childForFieldName('attribute')?.text ?? '' : '';
          if (obj && (obj.text === 'self' || obj.text === 'cls') && o.cls) target = methodOf(o.cls, attr);
          else if (obj && obj.type === 'attribute' && obj.childForFieldName('object')?.text === 'self' && o.cls) {
            const t = attrTypes.get(o.cls)?.get(obj.childForFieldName('attribute')!.text);
            if (t) target = methodOf(t, attr);
          }
          if (!target) {
            const r = resolveExpr(fi, fn, o.scope);
            if (r?.def) target = r.def;
          }
          if (target) {
            const d = defById.get(target);
            if (d?.kind === 'class') {
              ctx.edge({ type: 'INSTANTIATES', src: o.id, dst: target, file: fi.rel, line, col, ...S('py-scope', 0.9), evidence: ev });
              const init = methodOf(target, '__init__');
              if (init) { emit(init, 0.9, 'py-scope'); resolved++; continue; }
            }
            emit(target, 1, 'py-scope'); resolved++; continue;
          }
          if (obj && attr && !BUILTIN_NOISE.has(attr)) {
            const cands = methodsByName.get(attr) ?? [];
            if (cands.length && cands.length <= 3) { for (const c of cands) emit(c.id, 0.3 / cands.length, 'py-name-heuristic', 'semantic_inferred'); inferred++; continue; }
          }
          unresolved++;
        } else if (fn.type === 'attribute' && fn.childForFieldName('object')?.type === 'call' && fn.childForFieldName('object')!.childForFieldName('function')?.text === 'super' && o.cls) {
          const attr = fn.childForFieldName('attribute')!.text;
          for (const b of bases.get(o.cls) ?? []) { const m = methodOf(b, attr); if (m) { emit(m, 0.9, 'py-super'); resolved++; break; } }
        } else unresolved++;
      }
    }
  }
  for (const fi of infos.values()) fi.tree.delete();
  notes.push(`python calls: ${resolved} resolved syntactically, ${inferred} name-inferred (<=3 candidates), ${unresolved} unresolved (builtins, external libraries, dynamic receivers)`);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return { nodes: [...ctx.nodes.values()].sort((a, b) => cmp(a.id, b.id)), edges: [...ctx.edges.values()].sort((a, b) => cmp(a.id, b.id)), build_ms: Math.round(performance.now() - t0), notes };
}
