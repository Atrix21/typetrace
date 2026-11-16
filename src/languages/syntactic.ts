/**
 * Tree-sitter front-end for Go, Java, Kotlin, Scala, C#, Rust, C, C++, Ruby, PHP and Swift. It emits the same graph
 * schema as the TypeScript and Python front-ends, so search, graph propagation and rendering are unchanged.
 *
 * Declarations: types (class, struct, interface, trait, enum, record, object, module) and functions; methods are
 * qualified `Type.method`, including Go receivers, Rust `impl` blocks, C++ out-of-line `Type::method` and Swift
 * extensions. Overloads in one file get `#2`, `#3`, ... suffixes.
 *
 * Edges:
 *   CONTAINS              repository -> file -> type -> method
 *   IMPORTS               file -> file, when an import names a repository file: Go packages (via go.mod), Java,
 *                         Kotlin and Scala imports, Rust `use` and `mod`, C/C++ `#include`, Ruby `require`, PHP `use`
 *                         and `require`
 *   EXTENDS / IMPLEMENTS  type -> base type, resolved by name through imports, the package and the repository
 *   INSTANTIATES          caller -> type, for `new X()`, `X()`, `X{...}`, `X.new`
 *   CALLS                 caller -> callee. `static_verified` when the target follows from the syntax: calls on
 *                         `this`/`self`, implicit-this calls, calls on receivers whose type is declared (fields,
 *                         parameters, typed locals, `new X()` / `X()` / `X::new()` / `X{}` initialisers), static
 *                         `Type.method()` calls, and functions in the same file, an imported module or the same
 *                         package, and chained calls through declared return types. `semantic_inferred` (confidence
 *                         0.1-0.5) when only the name matches (at most 3 candidates), in the languages where such
 *                         guesses measured >= 50% precise (see GUESS_RECEIVER / GUESS_BARE). Otherwise no edge.
 *
 * This is a syntactic front-end: no compiler, no type inference beyond declared types and constructor initialisers.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Node as TSNode } from 'web-tree-sitter';
import type { GraphEdge, GraphNode } from '../graph/graph-schema.js';
import { GraphCtx } from '../parser/graph-context.js';
import { headerLang, langOf, parse, type LangId } from './registry.js';

type Kind = 'class' | 'interface' | 'function' | 'method';
/** What a language adapter reports for a declaration node. `container`: an `impl`/extension/companion block whose
 *  functions belong to type `name` (or, with name null, to the enclosing type). */
interface RawDef { kind: Kind | 'container'; name: string | null | undefined; owner?: string | null; ctor?: boolean; trait?: string | null; ret?: TSNode | null }
interface CallInfo { name: string; recv: TSNode | null; ctor?: boolean; path?: string | null }
interface Bind { name: string; type?: TSNode | string | null; value?: TSNode | null; field?: boolean }
interface Imp { kind: 'module' | 'path' | 'use'; spec: string; alias?: string | null; wildcard?: boolean; relative?: boolean; line: number }

interface Adapter {
  def(n: TSNode): RawDef | null;
  call(n: TSNode): CallInfo | null;
  binds(n: TSNode): Bind[] | null;
  member(n: TSNode): { obj: TSNode; name: string } | null;
  bases(n: TSNode): string[];
  imports(root: TSNode): Imp[];
  pkg(root: TSNode, file: string): string | null;
  isSelf(n: TSNode): boolean;
  isSuper(n: TSNode): boolean;
  implicitThis: boolean;
  /** Where methods of a type may be declared: its own file, its directory (Go package), or anywhere (Rust impls,
   *  Swift extensions, C++ out-of-line definitions, Ruby reopened classes, C# partial classes). */
  ownerScope: 'file' | 'dir' | 'repo';
  ctorNames: (cls: string) => string[];
}

/* ---------------------------------------------- helpers ---------------------------------------------- */

const F = (n: TSNode | null | undefined, f: string): TSNode | null => n?.childForFieldName(f) ?? null;
const kids = (n: TSNode | null | undefined): TSNode[] => (n ? n.namedChildren.filter((x): x is TSNode => !!x) : []);
const kid = (n: TSNode | null | undefined, ...types: string[]): TSNode | null => kids(n).find((c) => types.includes(c.type)) ?? null;
const fieldAll = (n: TSNode, f: string): TSNode[] => n.childrenForFieldName(f).filter((x): x is TSNode => !!x);
const hasToken = (n: TSNode, tok: string) => n.children.some((c) => !!c && !c.isNamed && c.type === tok);
const unquote = (s: string) => s.replace(/^[a-z]*["'`]+|["'`]+$/g, '');
const IDENT = /^[A-Za-z_$][\w$]*[!?]?$/;

/** Simple type name from a type node or text: generics, pointers, references, nullability and qualifiers removed. */
const WRAPPERS = new Set(['Option', 'Result', 'Box', 'Rc', 'Arc', 'Weak', 'Cow', 'Pin', 'RefCell', 'Cell', 'Mutex', 'RwLock', 'MutexGuard', 'Ref', 'RefMut', 'OnceCell', 'OnceLock',
  'Optional', 'CompletableFuture', 'Future', 'Promise', 'Task', 'ValueTask', 'Mono', 'Single', 'Maybe', 'Lazy', 'Deferred', 'Try', 'Nullable', 'Provider', 'AtomicReference',
  'shared_ptr', 'unique_ptr', 'weak_ptr', 'optional', 'std::shared_ptr', 'std::unique_ptr', 'std::optional']);
/** First type argument of `W<A, B>` / `W[A]`, or null. */
function firstTypeArg(s: string): string | null {
  const i = s.search(/[<[]/);
  if (i < 0) return null;
  let d = 0;
  for (let j = i + 1; j < s.length; j++) {
    const ch = s[j];
    if (ch === '<' || ch === '[') d++;
    else if (ch === '>' || ch === ']') { if (d === 0) return s.slice(i + 1, j).trim(); d--; }
    else if (ch === ',' && d === 0) return s.slice(i + 1, j).trim();
  }
  return null;
}
export function typeName(t: TSNode | string | null | undefined): string | null {
  if (!t) return null;
  let s = (typeof t === 'string' ? t : t.text).trim().replace(/^(?:->|:)\s*/, '');
  if (!s || s.length > 200) return null;
  for (let i = 0; i < 4; i++) {
    const m = /^\s*(?:&\s*(?:'\w+\s+)?(?:mut\s+)?)?([\w:]+)\s*[<[]/.exec(s);
    const inner = m && WRAPPERS.has(m[1]) ? firstTypeArg(s) : null;
    if (!inner) break;
    s = inner;
  }
  for (let i = 0; i < 6 && /<[^<>]*>/.test(s); i++) s = s.replace(/<[^<>]*>/g, '');
  s = s.replace(/^(?:&\s*(?:'\w+\s+)?(?:mut\s+)?|\*+\s*|(?:const|volatile|struct|class|enum|union|dyn|impl|mut|ref|final|readonly)\s+|\?)+/, '');
  s = s.replace(/[?!*&\s]+$/, '').replace(/(\[\s*\])+$/, '');
  if (/^(\[|map\[|func\b|chan\b|\(|fn\b)/.test(s)) return null;
  s = s.replace(/\[[^\]]*\]$/, '').replace(/\(.*$/s, '');
  const seg = s.split(/::|\.|\\/).pop()!.trim();
  return /^[A-Za-z_]\w*$/.test(seg) ? seg : null;
}

/** Declared return type: Go result lists take their first type. */
function retTypeName(t: TSNode | null | undefined): string | null {
  if (!t) return null;
  if (t.type === 'parameter_list') return retTypeName(F(kid(t, 'parameter_declaration'), 'type'));
  return typeName(t);
}

/** Innermost name of a C/C++ declarator (through pointer/reference/array/init declarators). */
function declName(d: TSNode | null): TSNode | null {
  for (let i = 0; d && i < 12; i++) {
    if (['identifier', 'field_identifier', 'qualified_identifier', 'destructor_name', 'operator_name', 'type_identifier'].includes(d.type)) return d;
    d = F(d, 'declarator') ?? (['parenthesized_declarator', 'reference_declarator'].includes(d.type) ? kids(d)[0] ?? null : null);
  }
  return null;
}
function cQualified(q: TSNode): { name: string; scope: string | null } {
  if (q.type !== 'qualified_identifier') return { name: q.text, scope: null };
  const name = F(q, 'name'), scope = F(q, 'scope');
  if (name?.type === 'qualified_identifier') { const inner = cQualified(name); return { name: inner.name, scope: inner.scope ?? scope?.text ?? null }; }
  return { name: name?.text ?? q.text, scope: scope?.text ?? null };
}

const PRIMITIVE = new Set(['int', 'long', 'short', 'byte', 'char', 'float', 'double', 'bool', 'boolean', 'void', 'var', 'val', 'let', 'auto', 'string', 'object', 'dynamic', 'any',
  'usize', 'isize', 'u8', 'u16', 'u32', 'u64', 'i8', 'i16', 'i32', 'i64', 'f32', 'f64', 'str', 'uint', 'int32', 'int64', 'uint32', 'uint64', 'float32', 'float64', 'rune', 'error', 'unsigned', 'signed', 'size_t', 'Self', 'self', 'mixed', 'callable', 'iterable', 'array']);
/** Calls whose receiver type is unknown but whose method returns the receiver's value (wrappers, clones). */
const PASSTHROUGH = new Set(['unwrap', 'expect', 'unwrap_or_default', 'unwrap_or', 'unwrap_or_else', 'clone', 'to_owned', 'as_ref', 'as_mut', 'borrow', 'borrow_mut', 'lock', 'read', 'write',
  'get', 'orElse', 'orElseThrow', 'orElseGet', 'getOrThrow', 'join', 'await', 'Result', 'GetAwaiter', 'GetResult', 'value']);
/**
 * Name-only guesses (<=3 candidates) are kept only where hand-checked precision was >= 50% (experiments/07-languages,
 * results/hand-check.json). Methods on a receiver of unknown type: Swift 83%, Go 71%, C# 58%, Scala 58%, Kotlin 57%,
 * C++ 2/2 kept; Rust 22%, Ruby 18%, Java 12%, PHP 8% dropped. Bare function names: C 100%, C++ 100%, Rust 3/3 kept;
 * unmeasured elsewhere (bare calls there resolve through scope, imports and packages), so not guessed.
 * C++ namespace-qualified guesses (0/3) dropped.
 */
const GUESS_RECEIVER = new Set<LangId>(['go', 'swift', 'csharp', 'scala', 'kotlin', 'cpp']);
const GUESS_BARE = new Set<LangId>(['c', 'cpp', 'rust']);
const NOISE = new Set(['get', 'set', 'add', 'put', 'remove', 'delete', 'clear', 'size', 'len', 'length', 'count', 'contains', 'has', 'keys', 'values', 'items',
  'push', 'pop', 'append', 'insert', 'map', 'filter', 'reduce', 'each', 'forEach', 'iter', 'into', 'from', 'to_string', 'toString', 'String', 'Error', 'equals',
  'hashCode', 'clone', 'copy', 'unwrap', 'expect', 'ok', 'err', 'is_some', 'is_none', 'close', 'open', 'read', 'write', 'flush', 'print', 'println', 'printf',
  'format', 'log', 'debug', 'info', 'warn', 'error', 'join', 'split', 'trim', 'replace', 'start', 'stop', 'run', 'call', 'apply', 'new', 'init', 'begin', 'end',
  'c_str', 'data', 'first', 'last', 'next', 'value', 'name', 'id', 'type', 'key', 'Equals', 'GetHashCode', 'ToString', 'Dispose', 'Add', 'Remove', 'Get', 'Set',
  // standard-library names that collide with repository methods (measured on the language report sample)
  'push_back', 'emplace_back', 'emplace', 'pop_back', 'front', 'back', 'empty', 'resize', 'reserve', 'find', 'erase', 'substr', 'str', 'visit', 'swap',
  'of', 'asList', 'valueOf', 'parseInt', 'stream', 'collect', 'toList', 'isEmpty', 'getClass', 'compareTo', 'hasNext', 'iterator', 'getMessage', 'printStackTrace',
  'require', 'check', 'let', 'also', 'takeIf', 'use', 'lazy', 'listOf', 'mapOf', 'setOf', 'emptyList', 'Run', 'Wait', 'Invoke', 'Select', 'Where', 'ToList', 'Any',
  'args', 'arg', 'unwrap_or', 'unwrap_or_else', 'map_err', 'and_then', 'as_ref', 'as_str', 'as_bytes', 'to_owned', 'is_empty', 'iter_mut', 'into_iter', 'chars', 'bytes', 'lines', 'trim_end', 'trim_start', 'starts_with', 'ends_with', 'current_dir', 'hidden', 'spawn',
  'include?', 'respond_to?', 'inspect', 'to_s', 'to_a', 'to_h', 'to_i', 'to_sym', 'merge', 'fetch', 'key?', 'empty?', 'nil?', 'is_a?', 'kind_of?', 'send', 'freeze', 'dup', 'slice', 'tap', 'then', 'each_with_object', 'any?', 'all?', 'select', 'reject', 'detect', 'present?', 'blank?',
  '__toString', 'rewind', 'any', 'reveal', 'shouldBeCalled', 'willReturn', 'method', 'with', 'expects', 'resume', 'cancel', 'sink', 'store', 'subscribe', 'sorted', 'compactMap', 'flatMap', 'contains']);

/* --------------------------------------------- adapters --------------------------------------------- */

const javaLike = { implicitThis: true, ownerScope: 'file' as const };

const GO: Adapter = {
  implicitThis: false, ownerScope: 'dir', ctorNames: () => [],
  def(n) {
    if (n.type === 'function_declaration') return { kind: 'function', name: F(n, 'name')?.text, ret: F(n, 'result') };
    if (n.type === 'method_declaration') {
      const p = kid(F(n, 'receiver'), 'parameter_declaration');
      return { kind: 'method', name: F(n, 'name')?.text, owner: typeName(F(p, 'type')), ret: F(n, 'result') };
    }
    if (n.type === 'type_spec') return { kind: F(n, 'type')?.type === 'interface_type' ? 'interface' : 'class', name: F(n, 'name')?.text };
    return null;
  },
  call(n) {
    if (n.type === 'call_expression') {
      const fn = F(n, 'function');
      if (fn?.type === 'identifier') return { name: fn.text, recv: null };
      if (fn?.type === 'selector_expression') return { name: F(fn, 'field')?.text ?? '', recv: F(fn, 'operand') };
    } else if (n.type === 'composite_literal') {
      const t = typeName(F(n, 'type'));
      if (t) return { name: t, recv: null, ctor: true };
    }
    return null;
  },
  binds(n) {
    switch (n.type) {
      case 'parameter_declaration': case 'field_declaration': case 'var_spec':
        return [...fieldAll(n, 'name')].map((x, i) => ({ name: x.text, type: F(n, 'type'), value: kids(F(n, 'value'))[i] ?? null, field: n.type === 'field_declaration' }));
      case 'short_var_declaration': {
        const r = kids(F(n, 'right'));
        return kids(F(n, 'left')).map((x, i) => ({ name: x.text, value: r[i] ?? null }));
      }
    }
    return null;
  },
  member(n) { return n.type === 'selector_expression' && F(n, 'operand') ? { obj: F(n, 'operand')!, name: F(n, 'field')?.text ?? '' } : null; },
  bases(n) {
    const t = F(n, 'type');
    if (t?.type !== 'struct_type') return [];
    return kids(kid(t, 'field_declaration_list')).filter((f) => f.type === 'field_declaration' && !F(f, 'name')).map((f) => typeName(F(f, 'type'))).filter((x): x is string => !!x);
  },
  imports(root) {
    const out: Imp[] = [];
    const visit = (n: TSNode) => {
      for (const c of kids(n)) {
        if (c.type === 'import_spec') { const p = unquote(F(c, 'path')?.text ?? ''); out.push({ kind: 'module', spec: p, alias: F(c, 'name')?.text ?? p.split('/').pop(), line: c.startPosition.row + 1 }); }
        else if (c.type === 'import_declaration' || c.type === 'import_spec_list') visit(c);
      }
    };
    visit(root);
    return out;
  },
  pkg: (_r, file) => path.posix.dirname(file),
  isSelf: () => false, isSuper: () => false,
};

const JAVA: Adapter = {
  ...javaLike, ctorNames: (c) => [c],
  def(n) {
    switch (n.type) {
      case 'class_declaration': case 'record_declaration': case 'enum_declaration': return { kind: 'class', name: F(n, 'name')?.text };
      case 'interface_declaration': case 'annotation_type_declaration': return { kind: 'interface', name: F(n, 'name')?.text };
      case 'method_declaration': return { kind: 'function', name: F(n, 'name')?.text, ret: F(n, 'type') };
      case 'constructor_declaration': case 'compact_constructor_declaration': return { kind: 'function', name: F(n, 'name')?.text, ctor: true };
    }
    return null;
  },
  call(n) {
    if (n.type === 'method_invocation') return { name: F(n, 'name')?.text ?? '', recv: F(n, 'object') };
    if (n.type === 'object_creation_expression') { const t = typeName(F(n, 'type')); if (t) return { name: t, recv: null, ctor: true }; }
    return null;
  },
  binds(n) {
    switch (n.type) {
      case 'formal_parameter': case 'catch_formal_parameter': case 'enhanced_for_statement': case 'resource':
        return F(n, 'name') ? [{ name: F(n, 'name')!.text, type: F(n, 'type') ?? kid(n, 'catch_type'), value: F(n, 'value') }] : null;
      case 'spread_parameter': { const d = kid(n, 'variable_declarator'); return d && F(d, 'name') ? [{ name: F(d, 'name')!.text, type: kids(n).find((x) => x.type !== 'variable_declarator') ?? null }] : null; }
      case 'local_variable_declaration': case 'field_declaration':
        return fieldAll(n, 'declarator').filter((d) => F(d, 'name')).map((d) => ({ name: F(d, 'name')!.text, type: F(n, 'type'), value: F(d, 'value'), field: n.type === 'field_declaration' }));
    }
    return null;
  },
  member(n) { return n.type === 'field_access' && F(n, 'object') ? { obj: F(n, 'object')!, name: F(n, 'field')?.text ?? '' } : null; },
  bases(n) {
    const out: TSNode[] = [];
    const sc = F(n, 'superclass'); if (sc) out.push(...kids(sc));
    const si = F(n, 'interfaces') ?? kid(n, 'super_interfaces'); if (si) out.push(...kids(kid(si, 'type_list')));
    const ei = kid(n, 'extends_interfaces'); if (ei) out.push(...kids(kid(ei, 'type_list')));
    return out.map(typeName).filter((x): x is string => !!x);
  },
  imports(root) {
    return kids(root).filter((c) => c.type === 'import_declaration').map((c) => {
      const id = kid(c, 'scoped_identifier', 'identifier');
      return { kind: 'use' as const, spec: id?.text ?? '', wildcard: !!kid(c, 'asterisk'), line: c.startPosition.row + 1 };
    }).filter((i) => i.spec);
  },
  pkg: (root) => kid(kid(root, 'package_declaration'), 'scoped_identifier', 'identifier')?.text ?? null,
  isSelf: (n) => n.type === 'this', isSuper: (n) => n.type === 'super',
};

// tree-sitter-grammars/tree-sitter-kotlin 1.x (vendored, grammars/): names are `identifier`, few fields
const KID = ['identifier', 'simple_identifier', 'type_identifier'];
const KOTLIN: Adapter = {
  ...javaLike, ctorNames: () => ['constructor'],
  def(n) {
    switch (n.type) {
      case 'class_declaration': return { kind: hasToken(n, 'interface') ? 'interface' : 'class', name: (F(n, 'name') ?? kid(n, ...KID))?.text };
      case 'object_declaration': return { kind: 'class', name: (F(n, 'name') ?? kid(n, ...KID))?.text };
      case 'companion_object': return { kind: 'container', name: null };
      case 'secondary_constructor': return { kind: 'function', name: 'constructor', ctor: true };
      case 'function_declaration': {
        const nm = F(n, 'name') ?? kid(n, ...KID);
        const recv = kids(n).find((c) => ['user_type', 'nullable_type', 'receiver_type'].includes(c.type) && nm && c.startIndex < nm.startIndex);
        const params = kid(n, 'function_value_parameters');
        const ret = params ? kids(n).find((c) => ['user_type', 'nullable_type'].includes(c.type) && c.startIndex > params.startIndex) : null;
        return { kind: 'function', name: nm?.text, owner: recv ? typeName(recv.text) : null, ret };
      }
    }
    return null;
  },
  call(n) {
    if (n.type !== 'call_expression') return null;
    const f = kids(n)[0];
    if (f && KID.includes(f.type)) return { name: f.text, recv: null };
    if (f?.type === 'navigation_expression') {
      const parts = kids(f), last = parts[parts.length - 1];
      const nm = last?.type === 'navigation_suffix' ? kid(last, ...KID) : last;
      if (nm && KID.includes(nm.type) && parts.length > 1) return { name: nm.text, recv: parts[0] };
    }
    return null;
  },
  binds(n) {
    switch (n.type) {
      case 'class_parameter': case 'parameter': {
        const nm = kid(n, ...KID);
        const field = n.type === 'class_parameter' && (hasToken(n, 'val') || hasToken(n, 'var') || !!kid(n, 'binding_pattern_kind'));
        return nm ? [{ name: nm.text, type: kid(n, 'user_type', 'nullable_type'), field }] : null;
      }
      case 'property_declaration': {
        const v = kid(n, 'variable_declaration'), nm = kid(v, ...KID);
        return nm ? [{ name: nm.text, type: kid(v, 'user_type', 'nullable_type'), value: kids(n).find((c) => c.startIndex > v!.endIndex) ?? null, field: n.parent?.type === 'class_body' }] : null;
      }
    }
    return null;
  },
  member(n) {
    if (n.type !== 'navigation_expression') return null;
    const parts = kids(n), last = parts[parts.length - 1];
    const nm = last?.type === 'navigation_suffix' ? kid(last, ...KID) : last;
    return nm && KID.includes(nm.type) && parts.length > 1 ? { obj: parts[0], name: nm.text } : null;
  },
  bases(n) {
    const specs = kids(kid(n, 'delegation_specifiers')).concat(kids(n).filter((c) => c.type === 'delegation_specifier'));
    return specs.map((d) => typeName(kid(d, 'user_type') ?? kid(kid(d, 'constructor_invocation'), 'user_type') ?? kid(kid(d, 'explicit_delegation'), 'user_type'))).filter((x): x is string => !!x);
  },
  imports(root) {
    const heads = kids(root).flatMap((c) => (c.type === 'import_list' ? kids(c) : [c])).filter((c) => c.type === 'import' || c.type === 'import_header');
    return heads.map((h) => {
      const q = kid(h, 'qualified_identifier', 'identifier');
      const alias = kids(h).filter((c) => c !== q && KID.includes(c.type)).pop() ?? kid(kid(h, 'import_alias'), ...KID);
      return { kind: 'use' as const, spec: q?.text ?? '', wildcard: /\*\s*$/.test(h.text) || !!kid(h, 'wildcard_import'), alias: alias?.text ?? null, line: h.startPosition.row + 1 };
    }).filter((i) => i.spec);
  },
  pkg: (root) => kid(kid(root, 'package_header'), 'qualified_identifier', 'identifier')?.text ?? null,
  isSelf: (n) => n.type === 'this_expression', isSuper: (n) => n.type === 'super_expression',
};

const SCALA: Adapter = {
  ...javaLike, ctorNames: () => [],
  def(n) {
    switch (n.type) {
      case 'class_definition': case 'object_definition': case 'enum_definition': return { kind: 'class', name: F(n, 'name')?.text };
      case 'trait_definition': return { kind: 'interface', name: F(n, 'name')?.text };
      case 'function_definition': case 'function_declaration': return { kind: 'function', name: F(n, 'name')?.text, ret: F(n, 'return_type') };
    }
    return null;
  },
  call(n) {
    if (n.type === 'call_expression') {
      let fn = F(n, 'function');
      if (fn?.type === 'generic_function') fn = F(fn, 'function');
      if (fn?.type === 'identifier') return { name: fn.text, recv: null };
      if (fn?.type === 'field_expression') return { name: F(fn, 'field')?.text ?? '', recv: F(fn, 'value') };
    } else if (n.type === 'instance_expression') {
      const t = typeName(kid(n, 'type_identifier', 'generic_type', 'stable_type_identifier'));
      if (t) return { name: t, recv: null, ctor: true };
    }
    return null;
  },
  binds(n) {
    switch (n.type) {
      case 'class_parameter': case 'parameter': return F(n, 'name') ? [{ name: F(n, 'name')!.text, type: F(n, 'type'), field: n.type === 'class_parameter' }] : null;
      case 'val_definition': case 'var_definition': case 'val_declaration': case 'var_declaration': {
        const p = F(n, 'pattern') ?? F(n, 'name');
        return p?.type === 'identifier' ? [{ name: p.text, type: F(n, 'type'), value: F(n, 'value'), field: n.parent?.type === 'template_body' }] : null;
      }
    }
    return null;
  },
  member(n) { return n.type === 'field_expression' && F(n, 'value') ? { obj: F(n, 'value')!, name: F(n, 'field')?.text ?? '' } : null; },
  bases(n) {
    const ext = F(n, 'extend') ?? kid(n, 'extends_clause');
    if (!ext) return [];
    const ts = fieldAll(ext, 'type');
    return ts.flatMap((t) => (t.type === 'compound_type' ? kids(t) : [t])).map(typeName).filter((x): x is string => !!x);
  },
  imports(root) {
    const out: Imp[] = [];
    const visit = (n: TSNode) => {
      for (const c of kids(n)) {
        if (c.type === 'import_declaration') {
          const p = F(c, 'path')?.text ?? '';
          const sel = kid(c, 'import_selectors');
          if (sel) for (const s of kids(sel)) out.push({ kind: 'use', spec: `${p}.${(s.type === 'import_selector' ? kids(s)[0]?.text : s.text) ?? ''}`, line: c.startPosition.row + 1 });
          else out.push({ kind: 'use', spec: p, wildcard: !!kid(c, 'wildcard'), line: c.startPosition.row + 1 });
        } else if (c.type === 'package_clause' || c.type === 'template_body') visit(c);
      }
    };
    visit(root);
    return out.filter((i) => i.spec);
  },
  pkg: (root) => F(kid(root, 'package_clause'), 'name')?.text ?? null,
  isSelf: (n) => n.text === 'this', isSuper: (n) => n.text === 'super',
};

const CSHARP: Adapter = {
  implicitThis: true, ownerScope: 'repo', ctorNames: (c) => [c],
  def(n) {
    switch (n.type) {
      case 'class_declaration': case 'struct_declaration': case 'record_declaration': case 'record_struct_declaration': case 'enum_declaration': return { kind: 'class', name: F(n, 'name')?.text };
      case 'interface_declaration': return { kind: 'interface', name: F(n, 'name')?.text };
      case 'method_declaration': case 'local_function_statement': return { kind: 'function', name: F(n, 'name')?.text, ret: F(n, 'returns') ?? F(n, 'type') };
      case 'constructor_declaration': return { kind: 'function', name: F(n, 'name')?.text, ctor: true };
    }
    return null;
  },
  call(n) {
    if (n.type === 'invocation_expression') {
      const fn = F(n, 'function');
      const simple = (x: TSNode | null) => (x?.type === 'generic_name' ? kid(x, 'identifier')?.text : x?.text) ?? '';
      if (fn?.type === 'identifier' || fn?.type === 'generic_name') return { name: simple(fn), recv: null };
      if (fn?.type === 'member_access_expression') return { name: simple(F(fn, 'name')), recv: F(fn, 'expression') };
    } else if (n.type === 'object_creation_expression') { const t = typeName(F(n, 'type')); if (t) return { name: t, recv: null, ctor: true }; }
    return null;
  },
  binds(n) {
    switch (n.type) {
      case 'parameter': return F(n, 'name') ? [{ name: F(n, 'name')!.text, type: F(n, 'type') }] : null;
      case 'property_declaration': return F(n, 'name') ? [{ name: F(n, 'name')!.text, type: F(n, 'type'), field: true }] : null;
      case 'foreach_statement': { const l = F(n, 'left'); return l?.type === 'identifier' ? [{ name: l.text, type: F(n, 'type') }] : null; }
      case 'variable_declaration': {
        const field = n.parent?.type === 'field_declaration';
        return kids(n).filter((d) => d.type === 'variable_declarator').map((d): Bind | null => {
          const nm = F(d, 'name') ?? kid(d, 'identifier');
          const eq = kid(d, 'equals_value_clause');
          return nm ? { name: nm.text, type: F(n, 'type'), value: eq ? kids(eq)[0] ?? null : kids(d).find((c) => c !== nm) ?? null, field } : null;
        }).filter((x): x is Bind => !!x);
      }
    }
    return null;
  },
  member(n) {
    if (n.type !== 'member_access_expression' || !F(n, 'expression')) return null;
    const nm = F(n, 'name');
    return { obj: F(n, 'expression')!, name: (nm?.type === 'generic_name' ? kid(nm, 'identifier')?.text : nm?.text) ?? '' };
  },
  bases: (n) => kids(kid(n, 'base_list')).map(typeName).filter((x): x is string => !!x),
  imports(root) {
    const out: Imp[] = [];
    const visit = (n: TSNode) => {
      for (const c of kids(n)) {
        if (c.type === 'using_directive') { const id = kid(c, 'qualified_name', 'identifier'); if (id && !F(c, 'name')) out.push({ kind: 'module', spec: id.text, line: c.startPosition.row + 1 }); }
        else if (['namespace_declaration', 'file_scoped_namespace_declaration', 'declaration_list'].includes(c.type)) visit(c);
      }
    };
    visit(root);
    return out;
  },
  pkg(root) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop()!;
      for (const c of kids(n)) {
        if (c.type === 'namespace_declaration' || c.type === 'file_scoped_namespace_declaration') return F(c, 'name')?.text ?? null;
      }
    }
    return null;
  },
  isSelf: (n) => n.type === 'this_expression' || n.text === 'this', isSuper: (n) => n.type === 'base_expression' || n.text === 'base',
};

const RUST: Adapter = {
  implicitThis: false, ownerScope: 'repo', ctorNames: () => [],
  def(n) {
    switch (n.type) {
      case 'struct_item': case 'enum_item': case 'union_item': return { kind: 'class', name: F(n, 'name')?.text };
      case 'trait_item': return { kind: 'interface', name: F(n, 'name')?.text };
      case 'impl_item': return { kind: 'container', name: typeName(F(n, 'type')), trait: typeName(F(n, 'trait')) };
      case 'function_item': case 'function_signature_item': return { kind: 'function', name: F(n, 'name')?.text, ret: F(n, 'return_type') };
    }
    return null;
  },
  call(n) {
    if (n.type === 'call_expression') {
      let fn = F(n, 'function');
      if (fn?.type === 'generic_function') fn = F(fn, 'function');
      if (fn?.type === 'identifier') return { name: fn.text, recv: null };
      if (fn?.type === 'field_expression') return { name: F(fn, 'field')?.text ?? '', recv: F(fn, 'value') };
      if (fn?.type === 'scoped_identifier') return { name: F(fn, 'name')?.text ?? '', recv: null, path: F(fn, 'path')?.text.replace(/::<.*$/s, '') ?? null };
    } else if (n.type === 'struct_expression') { const t = typeName(F(n, 'name')); if (t) return { name: t, recv: null, ctor: true }; }
    return null;
  },
  binds(n) {
    switch (n.type) {
      case 'parameter': case 'let_declaration': {
        let p = F(n, 'pattern');
        if (p?.type === 'mut_pattern') p = kids(p)[0] ?? null;
        return p?.type === 'identifier' ? [{ name: p.text, type: F(n, 'type'), value: F(n, 'value') }] : null;
      }
      case 'field_declaration': return F(n, 'name') ? [{ name: F(n, 'name')!.text, type: F(n, 'type'), field: true }] : null;
    }
    return null;
  },
  member(n) { return n.type === 'field_expression' && F(n, 'value') ? { obj: F(n, 'value')!, name: F(n, 'field')?.text ?? '' } : null; },
  bases: () => [],
  imports(root) {
    const out: Imp[] = [];
    const use = (n: TSNode | null, prefix: string, line: number) => {
      if (!n) return;
      const join = (a: string, b: string) => (a ? `${a}::${b}` : b);
      switch (n.type) {
        case 'scoped_identifier': case 'identifier': case 'crate': case 'super': case 'self': {
          const full = join(prefix, n.text);
          out.push({ kind: 'use', spec: full, alias: full.split('::').pop() === 'self' ? prefix.split('::').pop() : full.split('::').pop(), line });
          break;
        }
        case 'use_as_clause': out.push({ kind: 'use', spec: join(prefix, F(n, 'path')?.text ?? ''), alias: F(n, 'alias')?.text, line }); break;
        case 'scoped_use_list': { const p = F(n, 'path')?.text; use(F(n, 'list'), p ? join(prefix, p) : prefix, line); break; }
        case 'use_list': for (const k of kids(n)) use(k, prefix, line); break;
        case 'use_wildcard': out.push({ kind: 'use', spec: join(prefix, n.text.replace(/::\*$/, '')), wildcard: true, line }); break;
      }
    };
    const visit = (n: TSNode) => {
      for (const c of kids(n)) {
        if (c.type === 'use_declaration') use(F(c, 'argument'), '', c.startPosition.row + 1);
        else if (c.type === 'mod_item' && !F(c, 'body')) out.push({ kind: 'path', spec: F(c, 'name')?.text ?? '', line: c.startPosition.row + 1 });
        else if (c.type === 'mod_item' || c.type === 'declaration_list') visit(c);
      }
    };
    visit(root);
    return out.filter((i) => i.spec);
  },
  pkg: () => null,
  isSelf: (n) => n.type === 'self', isSuper: () => false,
};

function cFamily(cpp: boolean): Adapter {
  return {
    implicitThis: cpp, ownerScope: 'repo', ctorNames: (c) => [c],
    def(n) {
      switch (n.type) {
        case 'function_definition': {
          const d = declName(F(n, 'declarator'));
          if (!d) return null;
          const { name, scope } = cQualified(d);
          const owner = scope ? typeName(scope) : null;
          return { kind: 'function', name, owner: owner && /^[A-Z]/.test(owner) ? owner : null, ctor: !!owner && name === owner, ret: F(n, 'type') };
        }
        case 'struct_specifier': case 'union_specifier': case 'class_specifier': case 'enum_specifier':
          return F(n, 'body') && F(n, 'name') ? { kind: 'class', name: typeName(F(n, 'name')) } : null;
        case 'type_definition': {
          const t = F(n, 'type');
          return t && ['struct_specifier', 'union_specifier', 'class_specifier'].includes(t.type) && F(t, 'body') && !F(t, 'name') ? { kind: 'class', name: declName(F(n, 'declarator'))?.text } : null;
        }
      }
      return null;
    },
    call(n) {
      if (n.type === 'call_expression') {
        let fn = F(n, 'function');
        if (fn?.type === 'template_function') fn = F(fn, 'name');
        if (fn?.type === 'identifier') return { name: fn.text, recv: null };
        if (fn?.type === 'field_expression') return { name: F(fn, 'field')?.text ?? '', recv: F(fn, 'argument') };
        if (fn?.type === 'qualified_identifier') { const q = cQualified(fn); return { name: q.name, recv: null, path: q.scope }; }
      } else if (n.type === 'new_expression') { const t = typeName(F(n, 'type')); if (t) return { name: t, recv: null, ctor: true }; }
      return null;
    },
    binds(n) {
      if (n.type === 'parameter_declaration' || n.type === 'optional_parameter_declaration') { const d = declName(F(n, 'declarator')); return d ? [{ name: d.text, type: F(n, 'type') }] : null; }
      if (n.type === 'declaration' || n.type === 'field_declaration') {
        return fieldAll(n, 'declarator').map((d): Bind | null => {
          const nm = declName(d);
          return nm && !kid(d, 'parameter_list') && d.type !== 'function_declarator' ? { name: nm.text, type: F(n, 'type'), value: d.type === 'init_declarator' ? F(d, 'value') : null, field: n.type === 'field_declaration' } : null;
        }).filter((x): x is Bind => !!x);
      }
      return null;
    },
    member(n) { return n.type === 'field_expression' && F(n, 'argument') ? { obj: F(n, 'argument')!, name: F(n, 'field')?.text ?? '' } : null; },
    bases: (n) => kids(kid(n, 'base_class_clause')).filter((c) => c.type !== 'access_specifier').map(typeName).filter((x): x is string => !!x),
    imports(root) {
      const out: Imp[] = [];
      const visit = (n: TSNode) => {
        for (const c of kids(n)) {
          if (c.type === 'preproc_include') { const p = F(c, 'path'); if (p) out.push({ kind: 'path', spec: unquote(p.text.replace(/^<|>$/g, '')), relative: p.type === 'string_literal', line: c.startPosition.row + 1 }); }
          else if (c.type.startsWith('preproc_') || c.type === 'namespace_definition' || c.type === 'declaration_list' || c.type === 'linkage_specification') visit(c);
        }
      };
      visit(root);
      return out;
    },
    pkg: () => null,
    isSelf: (n) => n.type === 'this', isSuper: () => false,
  };
}

const RUBY_REQ = new Set(['require', 'require_relative', 'load', 'autoload']);
const RUBY: Adapter = {
  implicitThis: true, ownerScope: 'repo', ctorNames: () => ['initialize'],
  def(n) {
    switch (n.type) {
      case 'class': case 'module': return { kind: 'class', name: typeName(F(n, 'name')) };
      case 'singleton_class': return { kind: 'container', name: null };
      case 'method': case 'singleton_method': return { kind: 'function', name: F(n, 'name')?.text };
    }
    return null;
  },
  call(n) {
    if (n.type !== 'call') return null;
    const m = F(n, 'method')?.text ?? '', r = F(n, 'receiver');
    if (m === 'new' && r && (r.type === 'constant' || r.type === 'scope_resolution')) return { name: typeName(r) ?? '', recv: null, ctor: true };
    return RUBY_REQ.has(m) && !r ? null : { name: m, recv: r };
  },
  binds(n) {
    if (n.type !== 'assignment') return null;
    const l = F(n, 'left');
    if (l?.type === 'identifier') return [{ name: l.text, value: F(n, 'right') }];
    if (l?.type === 'instance_variable') return [{ name: l.text, value: F(n, 'right'), field: true }];
    return null;
  },
  member: () => null,
  bases(n) {
    const out = [typeName(kid(F(n, 'superclass'), 'constant', 'scope_resolution'))];
    for (const c of kids(F(n, 'body'))) {
      if (c.type === 'call' && !F(c, 'receiver') && ['include', 'extend', 'prepend'].includes(F(c, 'method')?.text ?? '')) out.push(...kids(F(c, 'arguments')).map(typeName));
    }
    return out.filter((x): x is string => !!x);
  },
  imports(root) {
    const out: Imp[] = [];
    const stack = [root];
    while (stack.length) {
      const n = stack.pop()!;
      for (const c of kids(n)) {
        if (c.type === 'call' && !F(c, 'receiver') && RUBY_REQ.has(F(c, 'method')?.text ?? '')) {
          const s = kids(F(c, 'arguments')).find((a) => a.type === 'string');
          if (s) out.push({ kind: 'path', spec: unquote(s.text), relative: F(c, 'method')!.text === 'require_relative', line: c.startPosition.row + 1 });
        } else if (!['method', 'singleton_method'].includes(c.type)) stack.push(c);
      }
    }
    return out;
  },
  pkg: () => null,
  isSelf: (n) => n.type === 'self', isSuper: (n) => n.type === 'super',
};

const PHP_REQ = new Set(['require_expression', 'require_once_expression', 'include_expression', 'include_once_expression']);
const PHP: Adapter = {
  implicitThis: false, ownerScope: 'file', ctorNames: () => ['__construct'],
  def(n) {
    switch (n.type) {
      case 'class_declaration': case 'trait_declaration': case 'enum_declaration': return { kind: 'class', name: F(n, 'name')?.text };
      case 'interface_declaration': return { kind: 'interface', name: F(n, 'name')?.text };
      case 'method_declaration': return { kind: 'function', name: F(n, 'name')?.text, ctor: F(n, 'name')?.text === '__construct', ret: F(n, 'return_type') };
      case 'function_definition': return { kind: 'function', name: F(n, 'name')?.text, ret: F(n, 'return_type') };
    }
    return null;
  },
  call(n) {
    switch (n.type) {
      case 'function_call_expression': { const fn = F(n, 'function'); return fn && (fn.type === 'name' || fn.type === 'qualified_name') ? { name: fn.text.split('\\').pop()!, recv: null } : null; }
      case 'member_call_expression': case 'nullsafe_member_call_expression': return { name: F(n, 'name')?.text ?? '', recv: F(n, 'object') };
      case 'scoped_call_expression': return { name: F(n, 'name')?.text ?? '', recv: F(n, 'scope') };
      case 'object_creation_expression': { const t = typeName(kid(n, 'name', 'qualified_name')); return t ? { name: t, recv: null, ctor: true } : null; }
    }
    return null;
  },
  binds(n) {
    switch (n.type) {
      case 'simple_parameter': case 'variadic_parameter': return F(n, 'name') ? [{ name: F(n, 'name')!.text, type: F(n, 'type') }] : null;
      case 'property_promotion_parameter': { const nm = F(n, 'name')?.text; return nm ? [{ name: nm, type: F(n, 'type') }, { name: nm.slice(1), type: F(n, 'type'), field: true }] : null; }
      case 'property_declaration': return kids(n).filter((c) => c.type === 'property_element').map((p) => ({ name: (kid(p, 'variable_name')?.text ?? '').slice(1), type: F(n, 'type'), field: true }));
      case 'assignment_expression': {
        const l = F(n, 'left');
        if (l?.type === 'variable_name') return [{ name: l.text, value: F(n, 'right') }];
        if (l?.type === 'member_access_expression' && F(l, 'object')?.text === '$this' && F(l, 'name')) return [{ name: F(l, 'name')!.text, value: F(n, 'right'), field: true }];
      }
    }
    return null;
  },
  member(n) { return (n.type === 'member_access_expression' || n.type === 'nullsafe_member_access_expression') && F(n, 'object') ? { obj: F(n, 'object')!, name: F(n, 'name')?.text ?? '' } : null; },
  bases(n) {
    const out = [...kids(kid(n, 'base_clause')), ...kids(kid(n, 'class_interface_clause'))];
    for (const c of kids(F(n, 'body'))) if (c.type === 'use_declaration') out.push(...kids(c));
    return out.map(typeName).filter((x): x is string => !!x);
  },
  imports(root) {
    const out: Imp[] = [];
    const stack = [root];
    while (stack.length) {
      const n = stack.pop()!;
      for (const c of kids(n)) {
        if (c.type === 'namespace_use_declaration') {
          for (const cl of kids(c).flatMap((x) => (x.type === 'namespace_use_group' ? kids(x) : [x]))) {
            if (cl.type !== 'namespace_use_clause' && cl.type !== 'namespace_use_group_clause') continue;
            const q = kid(cl, 'qualified_name', 'name', 'namespace_name');
            const prefix = kid(c, 'namespace_name')?.text;
            if (q) out.push({ kind: 'use', spec: (prefix ? `${prefix}\\` : '') + q.text.replace(/^\\/, ''), alias: kid(kid(cl, 'namespace_aliasing_clause'), 'name')?.text ?? null, line: c.startPosition.row + 1 });
          }
        } else if (PHP_REQ.has(c.type)) {
          const strs: string[] = [];
          const s2 = [c];
          while (s2.length) { const x = s2.pop()!; if (x.type === 'string_content' || x.type === 'string_value') strs.push(x.text); else s2.push(...kids(x)); }
          if (strs.length) out.push({ kind: 'path', spec: strs[0].replace(/^\//, ''), relative: true, line: c.startPosition.row + 1 });
        } else if (!['method_declaration', 'function_definition'].includes(c.type)) stack.push(c);
      }
    }
    return out;
  },
  pkg: (root) => F(kid(root, 'namespace_definition'), 'name')?.text ?? null,
  isSelf: (n) => n.text === '$this' || (n.type === 'relative_scope' && (n.text === 'self' || n.text === 'static')) || n.text === 'self' || n.text === 'static',
  isSuper: (n) => n.text === 'parent',
};

const SWIFT: Adapter = {
  implicitThis: true, ownerScope: 'repo', ctorNames: () => ['init'],
  def(n) {
    switch (n.type) {
      case 'class_declaration': return hasToken(n, 'extension') ? { kind: 'container', name: typeName(F(n, 'name')) } : { kind: 'class', name: typeName(F(n, 'name')) };
      case 'protocol_declaration': return { kind: 'interface', name: typeName(F(n, 'name')) };
      case 'function_declaration': case 'protocol_function_declaration': return { kind: 'function', name: F(n, 'name')?.text, ret: fieldAll(n, 'name').find((x) => x.type !== 'simple_identifier') ?? F(n, 'return_type') };
      case 'init_declaration': return { kind: 'function', name: 'init', ctor: true };
    }
    return null;
  },
  call(n) {
    if (n.type !== 'call_expression') return null;
    const f = kids(n)[0];
    if (f?.type === 'simple_identifier') return { name: f.text, recv: null };
    if (f?.type === 'navigation_expression') { const s = F(F(f, 'suffix'), 'suffix'); if (s) return { name: s.text, recv: F(f, 'target') }; }
    return null;
  },
  binds(n) {
    if (n.type === 'parameter') {
      const names = fieldAll(n, 'name');
      const id = names.filter((x) => x.type === 'simple_identifier').pop();
      return id ? [{ name: id.text, type: names.find((x) => x.type !== 'simple_identifier') ?? null }] : null;
    }
    if (n.type === 'property_declaration') {
      const p = F(n, 'name'), id = F(p, 'bound_identifier') ?? (p?.type === 'simple_identifier' ? p : null);
      const ta = kid(n, 'type_annotation');
      return id ? [{ name: id.text, type: F(ta, 'name') ?? kids(ta)[0] ?? null, value: F(n, 'value'), field: n.parent?.type === 'class_body' }] : null;
    }
    return null;
  },
  member(n) { if (n.type !== 'navigation_expression') return null; const s = F(F(n, 'suffix'), 'suffix'); return s && F(n, 'target') ? { obj: F(n, 'target')!, name: s.text } : null; },
  bases: (n) => kids(n).filter((c) => c.type === 'inheritance_specifier').map((c) => typeName(F(c, 'inherits_from'))).filter((x): x is string => !!x),
  imports: () => [],
  // a Swift module sees every file of its target: Sources/<Target>/..., else the repository is one module
  pkg: (_r, file) => /^(?:.*\/)?(?:Sources|Tests)\/[^/]+(?=\/)/.exec(file)?.[0] ?? '',
  isSelf: (n) => n.type === 'self_expression', isSuper: (n) => n.type === 'super_expression',
};

/** Languages that share types and calls: the JVM languages, and C with C++. */
const FAMILY: Partial<Record<LangId, string>> = { java: 'jvm', kotlin: 'jvm', scala: 'jvm', c: 'c', cpp: 'c' };
const sameFamily = (a: LangId, b: LangId) => a === b || (!!FAMILY[a] && FAMILY[a] === FAMILY[b]);

const ADAPTERS: Partial<Record<LangId, Adapter>> = { go: GO, java: JAVA, kotlin: KOTLIN, scala: SCALA, csharp: CSHARP, rust: RUST, c: cFamily(false), cpp: cFamily(true), ruby: RUBY, php: PHP, swift: SWIFT };
export const SYNTACTIC_LANGS = Object.keys(ADAPTERS) as LangId[];
export const isSyntactic = (l: LangId | undefined | null): boolean => !!l && l in ADAPTERS;

/** Type named by a constructor-like initialiser (`new X()`, `X()`, `X{}`, `X.new`, `X::new()`, Go `NewX()`), else null. */
function valueType(a: Adapter, lang: LangId, v: TSNode | null | undefined): string | null {
  for (let i = 0; v && i < 6 && ['unary_expression', 'reference_expression', 'parenthesized_expression', 'await_expression', 'try_expression', 'pointer_expression', 'expression_list', 'equals_value_clause'].includes(v.type) && kids(v).length; i++) v = kids(v)[kids(v).length - 1];
  const c = v ? a.call(v) : null;
  if (!c) return null;
  if (c.ctor) return c.name || null;
  if (!c.recv && !c.path && lang === 'go') return /^New[A-Z]/.test(c.name) ? c.name.slice(3) : null; // Go convention: NewX() returns X
  if (!c.recv && !c.path && /^[A-Z]/.test(c.name) && lang !== 'java' && lang !== 'csharp') return c.name; // Kotlin/Swift/Scala/Rust/C++ `X()`
  if (c.path && ['new', 'create', 'default', 'builder'].includes(c.name)) return typeName(c.path);
  return null;
}

/* ------------------------------------------ declarations ------------------------------------------ */

export interface SynDecl { key: string; file: string; name: string; kind: Kind | 'module'; start_line: number; end_line: number; parent: string | null }
interface Def extends SynDecl { kind: Kind; id: string; simple: string; owner: string | null; ctor: boolean; node: TSNode; signature: string; lang: LangId; start_col: number; end_col: number; parentId: string; /** declared return type (simple name) */ ret: string | null }
interface Container { node: TSNode; owner: string; trait: string | null; file: string }

/** Walk a file's tree and list its declarations (deterministic order). */
function extractDefs(lang: LangId, a: Adapter, file: string, root: TSNode): { defs: Def[]; containers: Container[] } {
  const defs: Def[] = [], containers: Container[] = [];
  const byKey = new Map<string, Def>();
  const dup = new Map<string, number>();
  interface Frame { qualified: string; owner: string | null; classId: string | null; isFn: boolean }
  const fileId = `file:${file}`;
  const walk = (n: TSNode, frames: Frame[]) => {
    for (const c of kids(n)) {
      const r = a.def(c);
      if (r?.name && /^`.+`$/.test(r.name)) r.name = r.name.slice(1, -1); // Kotlin/Scala/Swift backtick identifiers
      if (!r || (r.kind !== 'container' && (!r.name || (!IDENT.test(r.name.replace(/^~/, '')) && !/^[^\s(){}<>,;]+$/.test(r.name))))) { walk(c, frames); continue; }
      const top = frames[frames.length - 1];
      if (r.kind === 'container') {
        const owner = r.name ?? top?.owner ?? null;
        if (!owner) { walk(c, frames); continue; }
        containers.push({ node: c, owner, trait: r.trait ?? null, file });
        const q = r.name ? [...frames.filter((f) => !f.isFn).map((f) => f.qualified).slice(-1), owner].filter(Boolean).join('.') : top?.qualified ?? owner;
        const existing = byKey.get(`${file}::${q}`);
        walk(c, [...frames, { qualified: q, owner, classId: existing?.id ?? null, isFn: false }]);
        continue;
      }
      const name = r.name!;
      let kind: Kind = r.kind, owner: string | null = null, qualified: string, parentId = top?.classId ?? fileId, parentKey: string | null = null;
      const inType = top && !top.isFn && top.owner;
      if (kind === 'class' || kind === 'interface') qualified = top ? `${top.qualified}.${name}` : name;
      else if (inType) { kind = 'method'; owner = top.owner; qualified = `${top.qualified}.${name}`; }
      else if (r.owner) { kind = 'method'; owner = r.owner; qualified = `${r.owner}.${name}`; const o = byKey.get(`${file}::${r.owner}`); if (o) parentId = o.id; }
      else qualified = top ? `${top.qualified}.${name}` : name;
      if (kind === 'method' && parentId !== fileId) parentKey = defs.find((d) => d.id === parentId)?.key ?? null;
      let key = `${file}::${qualified}`;
      const prev = byKey.get(key);
      if (prev && (kind === 'class' || kind === 'interface') && (prev.kind === 'class' || prev.kind === 'interface')) {
        // partial / reopened / companion type in the same file: one node, members attach to it
        walk(c, [...frames, { qualified, owner: name, classId: prev.id, isFn: false }]);
        continue;
      }
      if (prev) { const k = (dup.get(key) ?? 1) + 1; dup.set(key, k); qualified = `${qualified}#${k}`; key = `${file}::${qualified}`; }
      const id = `${kind}:${key}`;
      const body = F(c, 'body');
      const head = body && body.startIndex > c.startIndex ? c.text.slice(0, body.startIndex - c.startIndex) : c.text.split('\n')[0];
      const sig = head.replace(/\s+/g, ' ').trim();
      const d: Def = {
        key, file, name: qualified, kind, start_line: c.startPosition.row + 1, end_line: c.endPosition.row + 1, parent: parentKey,
        id, simple: name, owner, ctor: !!r.ctor, node: c, signature: sig.length > 160 ? sig.slice(0, 157) + '...' : sig, lang,
        start_col: c.startPosition.column + 1, end_col: c.endPosition.column + 1, parentId, ret: retTypeName(r.ret),
      };
      defs.push(d);
      byKey.set(key, d);
      walk(c, [...frames, kind === 'class' || kind === 'interface' ? { qualified, owner: name, classId: id, isFn: false } : { qualified, owner: null, classId: null, isFn: true }]);
    }
  };
  walk(root, []);
  return { defs, containers };
}

/** Declaration spans for the symbol index / chunker (same extraction as the graph). */
export function syntacticDeclarations(lang: LangId, file: string, text: string): SynDecl[] {
  const a = ADAPTERS[lang];
  if (!a) throw new Error(`no syntactic adapter for ${lang}`);
  const tree = parse(lang, text);
  try {
    const { defs } = extractDefs(lang, a, file, tree.rootNode);
    const lines = text.split('\n').length;
    return [{ key: `${file}::<module>`, file, name: '<module>', kind: 'module', start_line: 1, end_line: lines, parent: null },
      ...defs.map((d) => ({ key: d.key, file: d.file, name: d.name, kind: d.kind, start_line: d.start_line, end_line: d.end_line, parent: d.parent }))];
  } finally { tree.delete(); }
}

/* ---------------------------------------------- graph ---------------------------------------------- */

interface FileInfo {
  rel: string; lang: LangId; a: Adapter; pkg: string | null; imports: Imp[]; defs: Def[]; containers: Container[];
  topNames: Map<string, Def[]>;
  /** resolved imports: files visible through imports, names bound to declarations, aliases bound to module files */
  visible: Set<string>; names: Map<string, Def[]>; modules: Map<string, string[]>;
  rustModule?: string; crate?: string;
}

const TEST_RE = /(^|\/)(tests?|spec|specs|__tests__|testing|testdata)\/|(_test|_spec|\.test|\.spec|Tests?|Spec)\.[A-Za-z]+$/;

export function buildSyntacticGraph(repoRoot: string, files: string[], repoName = path.basename(repoRoot)): { nodes: GraphNode[]; edges: GraphEdge[]; build_ms: number; notes: string[] } {
  const t0 = performance.now();
  const ctx = new GraphCtx();
  const notes: string[] = [];
  const repoId = `repository:${repoName}`;
  const hdr = headerLang(files);
  const S = (extraction: string, conf = 1) => ({ extraction, confidence: conf, verification: 'static_verified' as const });
  const langs = new Set<LangId>();

  // ---- pass 1: per-file declarations, imports, package (trees are freed; pass 3 re-parses) ----
  const infos = new Map<string, FileInfo>();
  const texts = new Map<string, string>();
  const parseErrors = new Map<LangId, number>(), perLang = new Map<LangId, number>();
  for (const rel of files) {
    const lang = langOf(rel, hdr)?.id;
    const a = lang ? ADAPTERS[lang] : undefined;
    if (!lang || !a) continue;
    langs.add(lang);
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    texts.set(rel, text);
    const tree = parse(lang, text);
    perLang.set(lang, (perLang.get(lang) ?? 0) + 1);
    if (tree.rootNode.hasError) parseErrors.set(lang, (parseErrors.get(lang) ?? 0) + 1);
    const { defs, containers } = extractDefs(lang, a, rel, tree.rootNode);
    const info: FileInfo = { rel, lang, a, pkg: a.pkg(tree.rootNode, rel), imports: a.imports(tree.rootNode), defs, containers, topNames: new Map(), visible: new Set(), names: new Map(), modules: new Map() };
    for (const d of defs) if (!d.name.includes('.') || d.parentId === `file:${rel}` && d.kind !== 'method') { const arr = info.topNames.get(d.simple) ?? []; arr.push(d); info.topNames.set(d.simple, arr); }
    infos.set(rel, info);
    tree.delete();
    for (const d of defs) d.node = null as unknown as TSNode; // freed with the tree; pass 3 re-parses
  }
  ctx.node('repository', repoId, repoName, null, null, null, { language: [...langs].sort().join(','), file_count: infos.size });

  // ---- indexes ----
  const all: Def[] = [...infos.values()].flatMap((f) => f.defs);
  const byId = new Map(all.map((d) => [d.id, d]));
  const group = <K>(xs: Def[], key: (d: Def) => K | null) => { const m = new Map<K, Def[]>(); for (const d of xs) { const k = key(d); if (k === null) continue; const a = m.get(k) ?? []; a.push(d); m.set(k, a); } return m; };
  const types = group(all, (d) => (d.kind === 'class' || d.kind === 'interface' ? d.simple : null));
  const fns = group(all, (d) => (d.kind === 'function' ? d.simple : null));
  const methodsByOwner = group(all, (d) => (d.kind === 'method' && d.owner ? d.owner : null));
  const methodsByOwnerFile = group(all, (d) => (d.kind === 'method' && d.owner ? `${d.file}|${d.owner}` : null));
  const methodsByOwnerDir = group(all, (d) => (d.kind === 'method' && d.owner ? `${path.posix.dirname(d.file)}|${d.owner}` : null));
  const topByName = new Map<string, Def[]>();
  for (const f of infos.values()) for (const [k, ds] of f.topNames) topByName.set(k, [...(topByName.get(k) ?? []), ...ds]);
  const methodsByName = group(all, (d) => (d.kind === 'method' ? d.simple : null));
  const filesByPkg = new Map<string, string[]>();
  const famKey = (l: LangId) => FAMILY[l] ?? l;
  for (const f of infos.values()) if (f.pkg !== null) { const k = `${famKey(f.lang)}|${f.pkg}`; const a = filesByPkg.get(k) ?? []; a.push(f.rel); filesByPkg.set(k, a); }
  const byBase = new Map<string, string[]>();
  for (const f of infos.keys()) { const b = path.posix.basename(f); const a = byBase.get(b) ?? []; a.push(f); byBase.set(b, a); }
  const bySuffix = (suffix: string): string[] => (byBase.get(path.posix.basename(suffix)) ?? []).filter((f) => f === suffix || f.endsWith('/' + suffix));
  const samePkg = (f: FileInfo) => (f.pkg === null ? [] : filesByPkg.get(`${famKey(f.lang)}|${f.pkg}`) ?? []);
  const pkgSets = new Map<string, Set<string>>();
  const pkgSet = (f: FileInfo): Set<string> => {
    const k = `${famKey(f.lang)}|${f.pkg}`;
    let s = pkgSets.get(k);
    if (!s) pkgSets.set(k, (s = new Set(samePkg(f))));
    return s;
  };

  // ---- files and declarations ----
  for (const f of infos.values()) {
    const lines = texts.get(f.rel)!.split('\n').length;
    ctx.node('file', `file:${f.rel}`, f.rel.split('/').pop()!, '<module>', f.rel, { start_line: 1, end_line: lines, start_col: 1, end_col: 1 },
      { symbol_key: `${f.rel}::<module>`, path: f.rel, language: f.lang, lines, is_test: TEST_RE.test(f.rel) });
    ctx.edge({ type: 'CONTAINS', src: repoId, dst: `file:${f.rel}`, file: f.rel, line: 1, col: 1, ...S('ts-syntax'), key: 'contains' });
  }
  for (const d of all) {
    ctx.node(d.kind, d.id, d.simple, d.name, d.file, { start_line: d.start_line, end_line: d.end_line, start_col: d.start_col, end_col: d.end_col },
      { symbol_key: d.key, signature: d.signature, language: d.lang });
    ctx.edge({ type: 'CONTAINS', src: d.parentId, dst: d.id, file: d.file, line: d.start_line, col: 1, ...S('ts-syntax'), key: 'contains' });
  }

  // ---- pass 2: imports ----
  const goMods = new Map<string, string>(); // module path -> dir (relative)
  const cargo = new Map<string, string>(); // crate name -> crate dir; crate dir -> itself
  const exists = (rel: string) => fs.existsSync(path.join(repoRoot, rel));
  const anc = new Map<string, string | null>();
  const ancestor = (rel: string, marker: string): string | null => {
    const start = path.posix.dirname(rel);
    const memo = anc.get(`${marker}|${start}`);
    if (memo !== undefined) return memo;
    let found: string | null = null;
    for (let d = start; ; d = path.posix.dirname(d)) {
      const dir = d === '.' ? '' : d;
      if (exists(path.posix.join(dir, marker))) { found = dir; break; }
      if (!dir) break;
    }
    anc.set(`${marker}|${start}`, found);
    return found;
  };
  const rustMods = new Map<string, string>(); // `${crateDir}::${a::b}` -> file
  for (const f of infos.values()) {
    if (f.lang === 'go') {
      const dir = ancestor(f.rel, 'go.mod');
      if (dir !== null && ![...goMods.values()].includes(dir)) {
        const m = /^module\s+(\S+)/m.exec(fs.readFileSync(path.join(repoRoot, dir, 'go.mod'), 'utf8'));
        if (m) goMods.set(m[1], dir);
      }
    } else if (f.lang === 'rust') {
      const crate = ancestor(f.rel, 'Cargo.toml');
      if (crate === null) continue;
      f.crate = crate;
      if (!cargo.has(crate)) {
        cargo.set(crate, crate);
        const m = /\[package\][^[]*?\bname\s*=\s*"([^"]+)"/s.exec(fs.readFileSync(path.join(repoRoot, crate, 'Cargo.toml'), 'utf8'));
        if (m) cargo.set(m[1].replace(/-/g, '_'), crate);
      }
      const src = crate ? `${crate}/src/` : 'src/';
      if (!f.rel.startsWith(src)) { f.rustModule = ''; rustMods.set(`${crate}::${f.rel}`, f.rel); continue; }
      const parts = f.rel.slice(src.length).replace(/\.rs$/, '').split('/');
      if (['mod', 'lib', 'main'].includes(parts[parts.length - 1]) && (parts.length > 1 || parts[0] !== 'mod')) parts.pop();
      f.rustModule = parts.join('::');
      if (!rustMods.has(`${crate}::${f.rustModule}`) || /\/(mod|lib)\.rs$/.test(f.rel)) rustMods.set(`${crate}::${f.rustModule}`, f.rel);
    }
  }
  const addName = (f: FileInfo, alias: string, ds: Def[]) => { if (ds.length) f.names.set(alias, [...(f.names.get(alias) ?? []), ...ds]); };
  const declaredIn = (fs_: string[], name: string) => fs_.flatMap((x) => infos.get(x)?.topNames.get(name) ?? []);
  /** Top-level declarations named `name` in a (possibly large) set of files. */
  const declaredInSet = (set: Set<string>, name: string) => (topByName.get(name) ?? []).filter((d) => set.has(d.file));
  const importEdge = (f: FileInfo, dst: string, imp: Imp) => {
    if (dst === f.rel) return;
    f.visible.add(dst);
    ctx.edge({ type: 'IMPORTS', src: `file:${f.rel}`, dst: `file:${dst}`, file: f.rel, line: imp.line, col: 1, ...S(`${f.lang}-import`), evidence: imp.spec.slice(0, 120) });
  };
  const rustResolve = (f: FileInfo, segs: string[]): { file: string; rest: string[] } | null => {
    const crate = f.crate ?? '';
    let base: string[] | null = null, crateDir = crate;
    const cur = f.rustModule ? f.rustModule.split('::').filter(Boolean) : [];
    if (segs[0] === 'crate') { base = []; segs = segs.slice(1); }
    else if (segs[0] === 'self') { base = cur; segs = segs.slice(1); }
    else if (segs[0] === 'super') { base = cur; while (segs[0] === 'super') { base = base.slice(0, -1); segs = segs.slice(1); } }
    else if (cargo.has(segs[0]) && segs[0] !== crate) { crateDir = cargo.get(segs[0])!; base = []; segs = segs.slice(1); }
    const tries = base ? [base] : [cur, []];
    for (const b of tries) {
      for (let k = segs.length; k >= 0; k--) {
        const file = rustMods.get(`${crateDir}::${[...b, ...segs.slice(0, k)].join('::')}`);
        if (file && (k > 0 || base)) return { file, rest: segs.slice(k) };
      }
    }
    return null;
  };
  for (const f of infos.values()) {
    for (const imp of f.imports) {
      switch (f.lang) {
        case 'go': {
          for (const [mod, dir] of goMods) {
            if (imp.spec !== mod && !imp.spec.startsWith(mod + '/')) continue;
            const pkgDir = path.posix.join(dir, imp.spec.slice(mod.length + 1));
            const pf = (filesByPkg.get(`go|${pkgDir === '.' ? '' : pkgDir}`) ?? filesByPkg.get(`go|${pkgDir}`) ?? []).filter((x) => !x.endsWith('_test.go'));
            if (pf.length) { f.modules.set(imp.alias ?? '', pf); for (const x of pf.slice(0, 50)) importEdge(f, x, imp); }
          }
          break;
        }
        case 'java': case 'kotlin': case 'scala': {
          const parts = imp.spec.split('.');
          if (imp.wildcard) { const pf = filesByPkg.get(`${famKey(f.lang)}|${imp.spec}`) ?? []; for (const x of pf) f.visible.add(x); break; }
          const name = parts[parts.length - 1], pkg = parts.slice(0, -1).join('.');
          let ds = declaredIn(filesByPkg.get(`${famKey(f.lang)}|${pkg}`) ?? [], name);
          if (!ds.length && parts.length > 2) { // static import / nested type: a.b.Type.member
            const owner = parts[parts.length - 2], opkg = parts.slice(0, -2).join('.');
            const od = declaredIn(filesByPkg.get(`${famKey(f.lang)}|${opkg}`) ?? [], owner);
            ds = od.flatMap((o) => (methodsByOwner.get(o.simple) ?? []).filter((m) => m.file === o.file && m.simple === name));
            if (!ds.length) ds = od.flatMap((o) => (types.get(name) ?? []).filter((t) => t.file === o.file));
          }
          const ext = f.lang === 'java' ? '.java' : f.lang === 'kotlin' ? '.kt' : '.scala';
          if (!ds.length) for (const x of bySuffix(parts.join('/') + ext)) ds.push(...(infos.get(x)?.topNames.get(name) ?? []));
          addName(f, imp.alias ?? name, ds);
          for (const x of new Set(ds.map((d) => d.file))) importEdge(f, x, imp);
          break;
        }
        case 'csharp': { for (const x of filesByPkg.get(`csharp|${imp.spec}`) ?? []) f.visible.add(x); break; }
        case 'php': {
          if (imp.kind === 'path') { for (const x of bySuffix(imp.spec).slice(0, 1)) importEdge(f, x, imp); break; }
          const parts = imp.spec.split('\\'), name = parts[parts.length - 1], ns = parts.slice(0, -1).join('\\');
          let ds = declaredIn(filesByPkg.get(`php|${ns}`) ?? [], name);
          if (!ds.length) for (const x of bySuffix(`${name}.php`)) if (infos.get(x)?.pkg === ns || parts.length < 2) ds.push(...(infos.get(x)?.topNames.get(name) ?? []));
          addName(f, imp.alias ?? name, ds);
          for (const x of new Set(ds.map((d) => d.file))) importEdge(f, x, imp);
          break;
        }
        case 'ruby': {
          const spec = imp.spec.endsWith('.rb') ? imp.spec : `${imp.spec}.rb`;
          const cand = imp.relative ? [path.posix.normalize(path.posix.join(path.posix.dirname(f.rel), spec))].filter((x) => infos.has(x))
            : bySuffix(spec).filter((x) => x === spec || x.endsWith(`lib/${spec}`) || x.endsWith(`app/${spec}`));
          for (const x of cand.slice(0, 1)) importEdge(f, x, imp);
          break;
        }
        case 'c': case 'cpp': {
          const local = path.posix.normalize(path.posix.join(path.posix.dirname(f.rel), imp.spec));
          const cand = infos.has(local) ? [local] : bySuffix(imp.spec);
          for (const x of cand.slice(0, 1)) {
            importEdge(f, x, imp);
            // the header's implementation: same stem next to it, else the only file with that stem in the repository
            const stem = x.replace(/\.[^.]+$/, ''), base = path.posix.basename(stem);
            const impls = ['.c', '.cc', '.cpp', '.cxx'].map((e) => stem + e).filter((y) => infos.has(y));
            if (!impls.length) { const all = ['.c', '.cc', '.cpp', '.cxx'].flatMap((e) => byBase.get(base + e) ?? []); if (all.length === 1) impls.push(all[0]); }
            for (const y of impls) f.visible.add(y);
          }
          break;
        }
        case 'rust': {
          if (imp.kind === 'path') { // `mod name;`
            const cur = f.rustModule ? `${f.rustModule}::` : '';
            const file = rustMods.get(`${f.crate ?? ''}::${cur}${imp.spec}`);
            if (file) { importEdge(f, file, imp); f.modules.set(imp.spec, [file]); }
            break;
          }
          const segs = imp.spec.split('::');
          const r = rustResolve(f, segs);
          if (!r) break;
          importEdge(f, r.file, imp);
          if (imp.wildcard) { f.visible.add(r.file); break; }
          const alias = imp.alias ?? segs[segs.length - 1];
          if (!r.rest.length) f.modules.set(alias, [r.file]);
          else addName(f, alias, infos.get(r.file)?.topNames.get(r.rest[r.rest.length - 1]) ?? []);
          break;
        }
      }
    }
  }

  // ---- types: resolution, bases, fields ----
  function resolveType(name: string | null, f: FileInfo): Def | null {
    if (!name) return null;
    const cands = (types.get(name) ?? []).filter((d) => sameFamily(d.lang, f.lang));
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0];
    const pick = (xs: Def[]) => (xs.length ? xs[0] : null);
    const imported = (f.names.get(name) ?? []).filter((d) => d.kind === 'class' || d.kind === 'interface');
    const pkg = pkgSet(f);
    return pick(cands.filter((d) => d.file === f.rel)) ?? pick(imported) ?? pick(cands.filter((d) => pkg.has(d.file))) ?? pick(cands.filter((d) => f.visible.has(d.file)))
      ?? pick(cands.filter((d) => path.posix.dirname(d.file) === path.posix.dirname(f.rel))) ?? null;
  }
  const bases = new Map<string, Def[]>();
  type Field = { type: string | null; f: FileInfo };
  const fields = new Map<string, Map<string, Field>>();
  const fieldOf = (cls: Def, name: string, seen = new Set<string>()): Field | null => {
    if (seen.has(cls.id)) return null;
    seen.add(cls.id);
    const own = fields.get(cls.id)?.get(name) ?? fields.get(`owner:${cls.simple}`)?.get(name);
    if (own) return own;
    for (const b of bases.get(cls.id) ?? []) { const r = fieldOf(b, name, seen); if (r) return r; }
    return null;
  };
  function methodsOf(cls: Def, name: string, seen = new Set<string>()): Def[] {
    if (seen.has(cls.id)) return [];
    seen.add(cls.id);
    const a = ADAPTERS[cls.lang]!;
    const pool = a.ownerScope === 'file' ? methodsByOwnerFile.get(`${cls.file}|${cls.simple}`) : a.ownerScope === 'dir' ? methodsByOwnerDir.get(`${path.posix.dirname(cls.file)}|${cls.simple}`) : methodsByOwner.get(cls.simple);
    const own = (pool ?? []).filter((m) => m.simple === name && (m.file !== cls.file || m.name.startsWith(cls.name + '.') || m.parentId === `file:${m.file}`));
    if (own.length) {
      // nearest declarations first: same file, same directory, elsewhere (Rust impls / Swift extensions / C++ out-of-line)
      const rank = (m: Def) => (m.file === cls.file ? 0 : path.posix.dirname(m.file) === path.posix.dirname(cls.file) ? 1 : 2);
      const best = Math.min(...own.map(rank));
      return own.filter((m) => rank(m) === best).slice(0, 4);
    }
    for (const b of bases.get(cls.id) ?? []) { const r = methodsOf(b, name, seen); if (r.length) return r; }
    return [];
  }
  function ctorOf(cls: Def): Def | null {
    const a = ADAPTERS[cls.lang]!;
    for (const nm of [...a.ctorNames(cls.simple)]) { const m = methodsOf(cls, nm).find((x) => x.ctor || a.ctorNames(cls.simple).includes(x.simple)); if (m) return m; }
    return null;
  }

  // ---- pass 3: re-parse; fields and bases, then calls ----
  let resolved = 0, inferred = 0, unresolved = 0;
  let fileEnv = new Map<string, { type: string | TSNode | null; value: TSNode | null }>(); // top-level bindings of the file being walked
  const parsed: { f: FileInfo; tree: ReturnType<typeof parse>; defs: Def[]; containers: Container[] }[] = [];
  const reparse = (f: FileInfo) => {
    const tree = parse(f.lang, texts.get(f.rel)!);
    const { defs, containers } = extractDefs(f.lang, f.a, f.rel, tree.rootNode);
    return { f, tree, defs: defs.map((d, i) => ({ ...f.defs[i], node: d.node })), containers };
  };
  // fields + bases need every file's declarations first; files are processed in bounded batches to cap memory
  const BATCH = 400;
  const fileList = [...infos.values()];
  for (let i = 0; i < fileList.length; i += BATCH) {
    for (const f of fileList.slice(i, i + BATCH)) {
      const p = reparse(f);
      for (const d of p.defs) {
        if (d.kind !== 'class' && d.kind !== 'interface') continue;
        const bs = f.a.bases(d.node).map((b) => resolveType(b, f)).filter((x): x is Def => !!x && x.id !== d.id);
        bases.set(d.id, bs);
        for (const b of bs) ctx.edge({ type: b.kind === 'interface' && d.kind !== 'interface' ? 'IMPLEMENTS' : 'EXTENDS', src: d.id, dst: b.id, file: f.rel, line: d.start_line, col: 1, ...S(`${f.lang}-scope`, 0.9), evidence: d.signature.slice(0, 100) });
        const fm = new Map<string, Field>();
        collect(f, d.node, (b) => { if (b.field) fm.set(b.name, { type: (typeof b.type === 'string' ? b.type : typeName(b.type ?? null)) ?? valueType(f.a, f.lang, b.value), f }); }, true);
        fields.set(d.id, fm);
      }
      for (const c of p.containers) {
        const owner = resolveType(c.owner, f);
        if (c.trait && owner) { const t = resolveType(c.trait, f); if (t) ctx.edge({ type: 'IMPLEMENTS', src: owner.id, dst: t.id, file: f.rel, line: c.node.startPosition.row + 1, col: 1, ...S(`${f.lang}-scope`, 0.9), evidence: c.node.text.split('\n')[0].slice(0, 100) }); }
      }
      // fields assigned in methods (`@x = Foo.new`, `$this->x = new Foo()`)
      for (const d of p.defs) {
        if (d.kind !== 'method' || !d.owner) continue;
        const key = (d.parentId.startsWith('class:') || d.parentId.startsWith('interface:')) ? d.parentId : `owner:${d.owner}`;
        collect(f, d.node, (b) => {
          if (!b.field || (!b.value && !b.type)) return;
          let m = fields.get(key);
          if (!m) fields.set(key, (m = new Map()));
          const t = (typeof b.type === 'string' ? b.type : typeName(b.type ?? null)) ?? valueType(f.a, f.lang, b.value);
          if (t && !m.has(b.name)) m.set(b.name, { type: t, f });
        }, false);
      }
      p.tree.delete();
    }
  }
  function collect(f: FileInfo, root: TSNode, on: (b: Bind) => void, classLevel: boolean) {
    const stack: TSNode[] = [root];
    let first = true;
    while (stack.length) {
      const n = stack.pop()!;
      if (!first && f.a.def(n)) { if (!classLevel || f.a.def(n)?.kind !== 'container') continue; }
      first = false;
      const bs = f.a.binds(n);
      if (bs) for (const b of bs) on(b);
      for (const c of kids(n)) stack.push(c);
    }
  }

  for (let i = 0; i < fileList.length; i += BATCH) {
    for (const f of fileList.slice(i, i + BATCH)) {
      const p = reparse(f);
      const owners: { id: string; node: TSNode; cls: Def | null; def: Def | null }[] = [{ id: `file:${f.rel}`, node: p.tree.rootNode, cls: null, def: null }];
      fileEnv = new Map();
      collect(f, p.tree.rootNode, (b) => { if (!b.field && !fileEnv.has(b.name)) fileEnv.set(b.name, { type: b.type ?? null, value: b.value ?? null }); }, false);
      for (const d of p.defs) {
        const cls = d.kind === 'class' || d.kind === 'interface' ? d : d.kind === 'method' ? (byId.get(d.parentId) ?? (d.owner ? resolveType(d.owner, f) : null)) : null;
        owners.push({ id: d.id, node: d.node, cls: cls && (cls.kind === 'class' || cls.kind === 'interface') ? cls : null, def: d });
      }
      for (const o of owners) walkCalls(f, o);
      p.tree.delete();
    }
  }

  function walkCalls(f: FileInfo, o: { id: string; node: TSNode; cls: Def | null; def: Def | null }) {
    const a = f.a;
    const env = new Map<string, { type: string | TSNode | null; value: TSNode | null }>();
    const calls: TSNode[] = [];
    const stack: TSNode[] = [o.node];
    let first = true;
    while (stack.length) {
      const n = stack.pop()!;
      if (!first && a.def(n)) continue;
      first = false;
      const bs = a.binds(n);
      if (bs) for (const b of bs) if (!env.has(b.name)) env.set(b.name, { type: b.type ?? null, value: b.value ?? null });
      if (a.call(n)) calls.push(n);
      for (const c of kids(n)) stack.push(c);
    }
    const emit = (dst: Def, n: TSNode, conf: number, how: string, verification: 'static_verified' | 'semantic_inferred' = 'static_verified') =>
      ctx.edge({ type: 'CALLS', src: o.id, dst: dst.id, file: f.rel, line: n.startPosition.row + 1, col: n.startPosition.column + 1, extraction: `${f.lang}-${how}`, confidence: conf, verification, evidence: n.text.slice(0, 100) });
    const external = { external: true } as const;
    type T = { cls?: Def; files?: string[]; isStatic?: boolean; external?: boolean } | null;
    /** Type of a binding: its declared type, else the type of its initialiser; a declared type naming no repository type is external. */
    const fromDeclared = (b: { type: string | TSNode | null; value?: TSNode | null }, bf: FileInfo, depth: number): T => {
      const t = typeof b.type === 'string' ? b.type : typeName(b.type);
      const r = resolveType(t, bf);
      if (r) return { cls: r };
      if (t && !PRIMITIVE.has(t) && /^[A-Za-z_]/.test(t)) return external;
      if (b.value && bf === f) { const v = exprType(b.value, depth + 1); return v; }
      return null;
    };
    const ownerOf = (m: Def): Def | null => (byId.get(m.parentId)?.kind === 'class' || byId.get(m.parentId)?.kind === 'interface' ? byId.get(m.parentId)! : m.owner ? resolveType(m.owner, infos.get(m.file)!) : null);
    /** Type of the value a call returns: a constructed type, or the declared return type of a statically resolved callee. */
    function exprType(e: TSNode, depth: number): T {
      if (depth > 8) return null;
      for (let i = 0; i < 6 && ['unary_expression', 'reference_expression', 'parenthesized_expression', 'await_expression', 'try_expression', 'pointer_expression', 'expression_list', 'equals_value_clause', 'non_null_assertion_expression', 'postfix_expression', 'force_unwrap_expression'].includes(e.type) && kids(e).length; i++) e = kids(e)[kids(e).length - 1];
      const c = a.call(e);
      if (!c) return null;
      const r = resolve(c, depth + 1);
      if (r?.kind === 'inst') return { cls: r.cls };
      if (r?.kind === 'calls' && r.ver === 'static_verified') {
        const m = r.targets[0];
        if (m.ctor) { const ow = ownerOf(m); return ow ? { cls: ow } : null; }
        if (!m.ret) return null;
        if (['Self', 'self', 'static', 'this', '$this'].includes(m.ret)) { const ow = ownerOf(m); return ow ? { cls: ow } : null; }
        const rt = resolveType(m.ret, infos.get(m.file)!);
        return rt ? { cls: rt } : PRIMITIVE.has(m.ret) ? null : external;
      }
      if (!r && c.recv && PASSTHROUGH.has(c.name)) return typeOf(c.recv, depth + 1); // unwrap(), clone(), get() on a known type
      if (r?.kind === 'external') return external;
      const vt = resolveType(valueType(a, f.lang, e), f);
      return vt ? { cls: vt } : null;
    }
    const memo = new Map<number, T>(); // per owner; a pending entry (null) also breaks cycles such as `x = x.next()`
    function typeOf(e: TSNode, depth = 0): T {
      if (depth > 8) return null;
      if (memo.has(e.id)) return memo.get(e.id)!;
      memo.set(e.id, null);
      const r = typeOfUncached(e, depth);
      memo.set(e.id, r);
      return r;
    }
    function typeOfUncached(e: TSNode, depth: number): T {
      if (a.isSelf(e)) return o.cls ? { cls: o.cls } : null;
      const m = a.member(e);
      if (m) {
        const t = typeOf(m.obj, depth + 1);
        if (t?.external) return external;
        if (t?.cls) { const fld = fieldOf(t.cls, m.name); if (fld) return fromDeclared(fld, fld.f, depth); }
        if (t?.files) { const ds = declaredIn(t.files, m.name).filter((d) => d.kind === 'class' || d.kind === 'interface'); if (ds[0]) return { cls: ds[0], isStatic: true }; }
        return null;
      }
      if (['identifier', 'simple_identifier', 'variable_name', 'constant', 'type_identifier', 'name', 'scope_resolution', 'qualified_name', 'instance_variable'].includes(e.type)) {
        const txt = e.text;
        const b = env.get(txt);
        if (b) return fromDeclared(b, f, depth);
        if (e.type === 'instance_variable' && o.cls) { const fld = fieldOf(o.cls, txt); return fld ? fromDeclared(fld, fld.f, depth) : null; }
        if (a.implicitThis && o.cls) { const fld = fieldOf(o.cls, txt); if (fld) return fromDeclared(fld, fld.f, depth); }
        const g = fileEnv.get(txt);
        if (g) return fromDeclared(g, f, depth);
        const mod = f.modules.get(txt);
        if (mod) return { files: mod };
        const named = (f.names.get(txt) ?? []).find((d) => d.kind === 'class' || d.kind === 'interface');
        const t = named ?? resolveType(typeName(txt), f);
        const classLike = /^[A-Z\\]/.test(txt.replace(/^.*(::|\\)/, '')) && !/^[A-Z0-9_]+$/.test(txt);
        if (t && classLike) return { cls: t, isStatic: true };
        if (classLike && !types.has(typeName(txt) ?? '')) return external; // `Integer.parseInt`, `Task.Run`, `Arrays.asList`
        return null;
      }
      return exprType(e, depth + 1);
    }
    const fnCands = (name: string): Def[] => {
      const local = (f.topNames.get(name) ?? []).filter((d) => d.kind === 'function');
      if (local.length) return local;
      const imp = (f.names.get(name) ?? []).filter((d) => d.kind === 'function' || d.kind === 'method');
      if (imp.length) return imp;
      const pkg = declaredInSet(pkgSet(f), name).filter((d) => d.kind === 'function' && d.file !== f.rel);
      if (pkg.length) return pkg;
      return declaredInSet(f.visible, name).filter((d) => d.kind === 'function');
    };
    type Res = { kind: 'calls'; targets: Def[]; conf: number; how: string; ver: 'static_verified' | 'semantic_inferred' } | { kind: 'inst'; cls: Def; conf: number } | { kind: 'external' } | null;
    const calls_ = (targets: Def[], conf: number, how: string, ver: 'static_verified' | 'semantic_inferred' = 'static_verified'): Res => ({ kind: 'calls', targets, conf, how, ver });
    const guess = (cands: Def[], how: 'name-heuristic' | 'unique-name', single: number): Res =>
      cands.length && cands.length <= 3 && (how === 'unique-name' ? GUESS_BARE : GUESS_RECEIVER).has(f.lang) ? calls_(cands, cands.length === 1 ? single : 0.3 / cands.length, how, 'semantic_inferred') : null;
    /** Resolve one call site (no edges are written here: the call loop and the return-type chaining share it). */
    function resolve(c: CallInfo, depth = 0): Res {
      if (!c.name || depth > 8) return null;
      if (c.ctor) { const t = resolveType(c.name, f); return t ? { kind: 'inst', cls: t, conf: 0.9 } : null; }
      // 1. explicit receiver
      if (c.recv) {
        if (a.isSuper(c.recv)) {
          const ms = o.cls ? (bases.get(o.cls.id) ?? []).flatMap((b) => methodsOf(b, c.name)) : [];
          return ms[0] ? calls_([ms[0]], 0.9, 'super') : null;
        }
        const t = typeOf(c.recv, depth + 1);
        if (t?.external) return { kind: 'external' }; // declared type or class name outside the repository
        if (t?.cls) {
          const ms = methodsOf(t.cls, c.name);
          if (ms.length) return calls_(ms, ms.length > 1 ? 0.8 : 0.9, a.isSelf(c.recv) ? 'self' : t.isStatic ? 'static' : 'declared-type');
        }
        if (t?.files) {
          const ds = declaredIn(t.files, c.name).filter((d) => d.kind === 'function');
          if (ds.length) return calls_(ds.slice(0, 3), 0.9, 'module');
          const ty = declaredIn(t.files, c.name).find((d) => d.kind === 'class');
          if (ty) return { kind: 'inst', cls: ty, conf: 0.85 };
        }
        if (NOISE.has(c.name)) return null;
        return guess((methodsByName.get(c.name) ?? []).filter((m) => sameFamily(m.lang, f.lang)), 'name-heuristic', 0.3);
      }
      // 2. path calls: `Type::f()`, `module::f()`, `Self::f()`
      if (c.path) {
        const segs = c.path.split('::').filter(Boolean);
        const last = segs[segs.length - 1] ?? '';
        if (last === 'Self' && o.cls) { const ms = methodsOf(o.cls, c.name); return ms.length ? calls_(ms.slice(0, 3), 0.9, 'path') : null; }
        const mod = segs.length === 1 ? f.modules.get(last) : undefined;
        const r = !mod && f.lang === 'rust' && segs.length ? rustResolve(f, segs) : null;
        const files = mod ?? (r && !r.rest.length ? [r.file] : null);
        if (files) { const ds = declaredIn(files, c.name).filter((d) => d.kind === 'function'); if (ds.length) return calls_(ds.slice(0, 3), 0.9, 'path'); }
        const t = (f.names.get(last) ?? []).find((d) => d.kind === 'class' || d.kind === 'interface') ?? (r?.rest.length ? declaredIn([r.file], r.rest[r.rest.length - 1]).find((d) => d.kind === 'class') : null) ?? resolveType(typeName(last), f);
        if (t) {
          const ms = methodsOf(t, c.name);
          if (ms.length) return calls_(ms.slice(0, 3), 0.9, 'path');
          if (c.name === 'new' || c.name === last) return { kind: 'inst', cls: t, conf: 0.85 };
        }
        return null;
      }
      // 3. bare name: implicit this, same file, imports, package, visible files, type constructor, unique in repo
      if (a.implicitThis && o.cls) { const ms = methodsOf(o.cls, c.name); if (ms.length) return calls_(ms, 0.9, 'implicit-this'); }
      const fc = fnCands(c.name);
      if (fc.length) return calls_(fc.slice(0, 3), fc.length > 1 ? 0.8 : 0.9, 'scope');
      const ty = resolveType(c.name, f);
      if (ty && /^[A-Z]/.test(c.name)) return { kind: 'inst', cls: ty, conf: 0.85 };
      if (NOISE.has(c.name)) return null;
      return guess((fns.get(c.name) ?? []).filter((d) => sameFamily(d.lang, f.lang)), 'unique-name', 0.5);
    }
    for (const n of calls) {
      const r = resolve(a.call(n)!);
      if (!r || r.kind === 'external') { unresolved++; continue; }
      if (r.kind === 'inst') {
        ctx.edge({ type: 'INSTANTIATES', src: o.id, dst: r.cls.id, file: f.rel, line: n.startPosition.row + 1, col: n.startPosition.column + 1, ...S(`${f.lang}-scope`, r.conf), evidence: n.text.slice(0, 100) });
        const ct = ctorOf(r.cls);
        if (ct) emit(ct, n, r.conf, 'ctor');
        resolved++;
        continue;
      }
      for (const d of r.targets) emit(d, n, r.conf, r.how, r.ver);
      if (r.ver === 'static_verified') resolved++; else inferred++;
    }
  }

  for (const [l, n] of [...perLang].sort()) notes.push(`${l}: ${parseErrors.get(l) ?? 0} of ${n} files have syntax the grammar did not fully parse (declarations after the error may be mis-nested)`);
  notes.push(`${[...langs].sort().join(', ')} calls: ${resolved} resolved syntactically, ${inferred} name-inferred (<=3 candidates), ${unresolved} unresolved (standard library, external packages, dynamic receivers)`);
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return { nodes: [...ctx.nodes.values()].sort((x, y) => cmp(x.id, y.id)), edges: [...ctx.edges.values()].sort((x, y) => cmp(x.id, y.id)), build_ms: Math.round(performance.now() - t0), notes };
}
