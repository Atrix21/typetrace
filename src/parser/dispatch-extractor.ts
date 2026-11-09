/**
 * Experiment 3, milestone M2.2: generic extraction rules for indirect execution boundaries.
 *
 *  1. Keyed dispatch (job queues, event buses, message handlers): a handler is REGISTERED by a method decorator that
 *     carries a typed key; work is DISPATCHED by a call whose argument carries the same key. Emitted as
 *     PUBLISHES_EVENT (dispatching owner -> key node) and CONSUMES_EVENT (handler method -> key node).
 *  2. GraphQL operations (@Query/@Mutation/@Subscription/@ResolveField from a GraphQL package) as entry points:
 *     a route node + ROUTES_TO, mirroring the REST controller rule.
 *  3. Query-builder database access (Kysely): selectFrom/insertInto/updateTable/deleteFrom/joins with a literal table.
 *
 * No repository-specific names. What counts as a key is decided by the TYPE CHECKER, not by names:
 *  - an enum member, accepted only where the contextual type at that position is that enum (or a union of its
 *    members), i.e. the registering decorator and the dispatching API are both typed with the key domain;
 *  - a string/number literal, accepted only where the contextual type is a NAMED union of literals (type alias);
 *  - `SomeClass.name` (the class's own name used as the key), matched by class identity.
 * A method only counts as a handler if it is not an HTTP/GraphQL route handler and is not called directly from
 * non-test project code (handlers are invoked by the framework). Each handler links through its primary key: the
 * key DOMAIN with the highest specificity (distinct key values / registrations: a job name, not the queue it runs on or a
 * worker filter); domains below MIN_SPECIFICITY are broadcast/filter keys and never link (R2). Producer sites in test
 * files (R1) and inside a handler of the same key (forwarding, R3) are ignored. R1–R3 were added after the independent
 * edge-precision audit (E3-D21). Producer sites are collected during the body walk and emitted in finish(), once the
 * handler set is known. All edges are framework_inferred and carry the evidence location; the underlying calls remain
 * static_verified CALLS edges.
 */
import ts from 'typescript';
import type { Env, WalkState, Owner } from './graph-context.js';
import { effectEdges, emitEffect, type EdgeInput } from './graph-context.js';
import { externalPackageOf, stripParens, type CallResolution } from './call-extractor.js';
import { aliasTarget, declInfo } from './symbol-extractor.js';
import { shortText, startOf } from './typescript-parser.js';

const GRAPHQL_PACKAGES = new Set(['@nestjs/graphql', 'type-graphql']);
const GRAPHQL_OPS: Record<string, string> = { Query: 'query', Mutation: 'mutation', Subscription: 'subscription', ResolveField: 'field' };
const QUERY_BUILDER_PACKAGES = new Set(['kysely']);
const QB_TABLE_METHODS: Record<string, string> = {
  selectFrom: 'select', insertInto: 'insert', replaceInto: 'insert', updateTable: 'update', deleteFrom: 'delete', mergeInto: 'merge',
  innerJoin: 'join', leftJoin: 'join', rightJoin: 'join', fullJoin: 'join', crossJoin: 'join',
};
const TEST_FILE_RE = /(^|\/)(test|tests|__tests__)\/|\.(e2e-)?spec\.tsx?$|\.test\.tsx?$/;

export interface DispatchKey { domain: string; value: string; kind: 'enum' | 'literal' | 'class-name'; text: string }
interface Registration { owner: Owner; keys: DispatchKey[]; decorator: string; line: number; col: number }
interface ProducerSite { key: DispatchKey; edges: EdgeInput[] }

export interface DecoratorInfo { name: string; args: readonly ts.Expression[]; node: ts.Decorator; pkg: string | null }

export class DispatchExtractor {
  private registrations: Registration[] = [];
  private producers: ProducerSite[] = [];
  private seenProducer = new Set<string>();
  /** Key domains registered by at least one handler decorator (filled at the end of prepare()). */
  private domains = new Set<string>();
  private literalDomains = new Set<string>();
  readonly stats = { handlers: 0, handler_candidates: 0, excluded_route: 0, excluded_called: 0, handlers_broadcast_only: 0, producer_sites: 0, producers_forwarding: 0, dispatch_edges_out: 0, graphql_ops: 0, query_builder_edges: 0 };
  /** R2 threshold (E3-D21): set after the independent edge-precision audit, before any M/L retrieval result was read. */
  static MIN_SPECIFICITY = 0.25;

  constructor(private env: Env, private decos: (n: ts.Node) => DecoratorInfo[]) {}

  // ------------------------------------------------------------ key resolution (type-checker based)
  private domainIdOf(sym: ts.Symbol): string {
    const decl = sym.declarations?.[0];
    if (!decl) return `?::${sym.name}`;
    const rel = this.env.project.relOf(decl.getSourceFile());
    return rel ? `${rel}::${sym.name}` : `${externalPackageOf(decl)}::${sym.name}`;
  }

  /** The type at this expression's position as the surrounding API declares it (type parameters -> constraint). */
  private contextualType(e: ts.Expression): ts.Type | undefined {
    const c = this.env.project.checker;
    let t: ts.Type | undefined;
    try { t = c.getContextualType(e); } catch { return undefined; }
    for (let i = 0; t && i < 3 && t.flags & ts.TypeFlags.TypeParameter; i++) t = c.getBaseConstraintOfType(t) ?? undefined;
    return t;
  }

  private constituents(t: ts.Type): ts.Type[] {
    const xs = t.isUnion() ? t.types : [t];
    return xs.filter((x) => !(x.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)));
  }

  /** Enum declaration symbol of an enum or enum-literal type, else null. */
  private enumOfType(t: ts.Type): ts.Symbol | null {
    if (!(t.flags & (ts.TypeFlags.EnumLike))) return null;
    const d = t.symbol?.valueDeclaration ?? t.symbol?.declarations?.[0];
    if (!d) return null;
    if (ts.isEnumMember(d)) return this.env.project.checker.getSymbolAtLocation(d.parent.name) ?? null;
    if (ts.isEnumDeclaration(d)) return t.symbol;
    return null;
  }

  private contextAdmitsEnum(e: ts.Expression, enumSym: ts.Symbol): boolean {
    const target = this.domainIdOf(enumSym);
    const admits = (ct: ts.Type | undefined) => {
      if (!ct) return false;
      const parts = this.constituents(ct);
      return parts.length > 0 && parts.every((p) => { const s = this.enumOfType(p); return !!s && this.domainIdOf(s) === target; });
    };
    return admits(this.contextualType(e)) || admits(this.declaredParamType(e));
  }

  /**
   * For a direct call argument: the parameter type as DECLARED by the callee (a type parameter is replaced by its
   * declared constraint). Needed because the contextual type of a literal argument of a generic call is the
   * already-inferred literal type (`emit<T extends EventName>('x')` gives 'x', not EventName).
   */
  private declaredParamType(e: ts.Expression): ts.Type | undefined {
    const call = e.parent;
    if (!call || !(ts.isCallExpression(call) || ts.isNewExpression(call)) || !call.arguments) return undefined;
    const idx = call.arguments.indexOf(e);
    if (idx < 0) return undefined;
    const c = this.env.project.checker;
    try {
      const decl = c.getResolvedSignature(call)?.getDeclaration();
      const prm = decl && 'parameters' in decl ? decl.parameters[Math.min(idx, decl.parameters.length - 1)] : undefined;
      let tn = prm?.type;
      if (!tn) return undefined;
      if (ts.isTypeReferenceNode(tn)) {
        const sym = c.getSymbolAtLocation(tn.typeName);
        const tp = sym?.declarations?.find(ts.isTypeParameterDeclaration);
        if (tp?.constraint) tn = tp.constraint;
      }
      return c.getTypeFromTypeNode(tn);
    } catch { return undefined; }
  }

  /**
   * The type alias NAMED by the declaration that types this position: the property signature's type annotation for a
   * literal inside an object literal, or the parameter's annotation (type parameter -> its constraint) for a direct call
   * argument. Needed because unions are interned: `type E = keyof Map` often reaches the checker without aliasSymbol.
   */
  private declaredAlias(e: ts.Expression): { alias: ts.Symbol; type: ts.Type } | null {
    const c = this.env.project.checker;
    let tn: ts.TypeNode | undefined;
    try {
      const p = e.parent;
      if (p && ts.isPropertyAssignment(p) && p.initializer === e && ts.isObjectLiteralExpression(p.parent)) {
        const ot = c.getContextualType(p.parent);
        const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
        const prop = ot && name ? (ot.isUnion() ? ot.types.map((t) => t.getProperty(name)).find(Boolean) : ot.getProperty(name)) : undefined;
        const d = prop?.valueDeclaration ?? prop?.declarations?.[0];
        if (d && (ts.isPropertySignature(d) || ts.isPropertyDeclaration(d))) tn = d.type;
      } else if (p && (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments) {
        const idx = p.arguments.indexOf(e);
        const decl = idx >= 0 ? c.getResolvedSignature(p)?.getDeclaration() : undefined;
        const prm = decl && 'parameters' in decl ? decl.parameters[Math.min(idx, decl.parameters.length - 1)] : undefined;
        tn = prm?.type;
      }
      if (tn && ts.isTypeReferenceNode(tn)) {
        const tp = c.getSymbolAtLocation(tn.typeName)?.declarations?.find(ts.isTypeParameterDeclaration);
        if (tp?.constraint) tn = tp.constraint;
      }
      if (!tn || !ts.isTypeReferenceNode(tn)) return null;
      const sym = aliasTarget(c, c.getSymbolAtLocation(tn.typeName));
      if (!sym || !(sym.flags & ts.SymbolFlags.TypeAlias)) return null;
      return { alias: sym, type: c.getTypeFromTypeNode(tn) };
    } catch { return null; }
  }

  /** Named literal domain: the position is typed by a type alias whose members are literals including this value. */
  private literalDomain(e: ts.Expression, value: string): string | null {
    const named = this.declaredAlias(e);
    if (named) {
      const parts = this.constituents(named.type);
      if (parts.length && parts.every((p) => p.isStringLiteral() || p.isNumberLiteral()) && parts.some((p) => String((p as ts.LiteralType).value) === value)) return this.domainIdOf(named.alias);
    }
    let ct = this.contextualType(e);
    if (!ct?.aliasSymbol) ct = this.declaredParamType(e) ?? ct;
    if (!ct) return null;
    const alias = ct.aliasSymbol;
    if (!alias) return null;
    const parts = this.constituents(ct);
    if (!parts.length || !parts.every((p) => p.isStringLiteral() || p.isNumberLiteral())) return null;
    if (!parts.some((p) => String((p as ts.LiteralType).value) === value)) return null;
    return this.domainIdOf(alias);
  }

  /** `only`: restrict to these key domains (producer side: domains some handler registered). */
  keyOf(expr: ts.Expression, only?: Set<string>): DispatchKey | null {
    const { checker } = this.env.project;
    const x = stripParens(expr);
    const allowed = (d: string) => !only || only.has(d);
    // SomeClass.name
    if (ts.isPropertyAccessExpression(x) && x.name.text === 'name') {
      let sym: ts.Symbol | undefined;
      try { sym = aliasTarget(checker, checker.getSymbolAtLocation(x.expression)); } catch { sym = undefined; }
      const cls = sym?.declarations?.find((d) => ts.isClassDeclaration(d));
      if (cls && allowed('class-name')) {
        const info = declInfo(this.env.project, cls);
        if (info) return { domain: 'class-name', value: info.id, kind: 'class-name', text: `${info.qualified}.name` };
      }
    }
    // enum member
    if (ts.isPropertyAccessExpression(x) || ts.isIdentifier(x)) {
      let sym: ts.Symbol | undefined;
      try { sym = aliasTarget(checker, checker.getSymbolAtLocation(ts.isPropertyAccessExpression(x) ? x.name : x)); } catch { sym = undefined; }
      const md = sym?.valueDeclaration;
      if (sym && md && ts.isEnumMember(md)) {
        const enumSym = checker.getSymbolAtLocation(md.parent.name);
        if (enumSym && allowed(this.domainIdOf(enumSym)) && this.contextAdmitsEnum(x, enumSym)) {
          const domain = this.domainIdOf(enumSym);
          return { domain, value: `${domain}.${sym.name}`, kind: 'enum', text: `${enumSym.name}.${sym.name}` };
        }
      }
      return null;
    }
    if ((ts.isStringLiteralLike(x) || ts.isNumericLiteral(x)) && (!only || this.literalDomains.size)) {
      const domain = this.literalDomain(x, x.text);
      if (domain && allowed(domain)) return { domain, value: `${domain}:${x.text}`, kind: 'literal', text: JSON.stringify(x.text) };
    }
    return null;
  }

  /** Candidate key expressions inside an argument: the argument, object-literal values, array elements, arrow bodies. */
  private keyExprs(e: ts.Expression, depth: number, out: ts.Expression[]) {
    const x = stripParens(e);
    out.push(x);
    if (depth <= 0) return;
    if (ts.isObjectLiteralExpression(x)) {
      for (const p of x.properties) if (ts.isPropertyAssignment(p)) this.keyExprs(p.initializer, depth - 1, out);
    } else if (ts.isArrayLiteralExpression(x)) {
      for (const el of x.elements) if (!ts.isSpreadElement(el) && !ts.isOmittedExpression(el)) this.keyExprs(el, depth - 1, out);
    } else if ((ts.isArrowFunction(x) || ts.isFunctionExpression(x)) && x.body) {
      if (ts.isArrowFunction(x) && !ts.isBlock(x.body)) this.keyExprs(x.body, depth - 1, out);
      else {
        const visit = (n: ts.Node) => {
          if (ts.isReturnStatement(n) && n.expression) this.keyExprs(n.expression, depth - 1, out);
          if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
        };
        ts.forEachChild(x.body, visit);
      }
    } else if (ts.isCallExpression(x)) {
      for (const a of x.arguments) this.keyExprs(a, depth - 1, out);
    }
  }

  // ------------------------------------------------------------ pre-pass: handler registrations, GraphQL entry points
  prepare(): void {
    const { env } = this;
    for (const o of env.owners) {
      if (o.type !== 'method' || !ts.isMethodDeclaration(o.decl)) continue;
      for (const d of this.decos(o.decl)) {
        if (GRAPHQL_OPS[d.name] && GRAPHQL_PACKAGES.has(d.pkg ?? this.importPackageOf(d) ?? '')) { this.graphqlRoute(o, { ...d, pkg: d.pkg ?? this.importPackageOf(d) }); continue; }
        const exprs: ts.Expression[] = [];
        for (const a of d.args) this.keyExprs(a, 2, exprs);
        const keys: DispatchKey[] = [];
        for (const e of exprs) { const k = this.keyOf(e); if (k && !keys.some((y) => y.value === k.value)) keys.push(k); }
        if (!keys.length) continue;
        const p = startOf(o.sf, d.node);
        this.registrations.push({ owner: o, keys, decorator: shortText(d.node.getText(o.sf), 120), line: p.line, col: p.col });
      }
    }
    for (const r of this.registrations) for (const k of r.keys) { this.domains.add(k.domain); if (k.kind === 'literal') this.literalDomains.add(k.domain); }
  }

  /**
   * Package named by the import declaration that binds a decorator, for decorators whose declaration does not resolve
   * (e.g. the package is loaded as an untyped stub). Used only by the GraphQL rule.
   */
  private importPackageOf(d: DecoratorInfo): string | null {
    const e = d.node.expression;
    const callee = ts.isCallExpression(e) ? stripParens(e.expression) : e;
    const id = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression : null;
    if (!id) return null;
    let sym: ts.Symbol | undefined;
    try { sym = this.env.project.checker.getSymbolAtLocation(id); } catch { return null; }
    for (let n: ts.Node | undefined = sym?.declarations?.[0]; n; n = n.parent) {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
        const parts = n.moduleSpecifier.text.split('/');
        return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      }
    }
    return null;
  }

  private graphqlRoute(o: Owner, d: DecoratorInfo) {
    const { ctx, project } = this.env;
    const info = declInfo(project, o.decl);
    if (!info || !ctx.hasNode(info.id)) return;
    const op = GRAPHQL_OPS[d.name];
    let field: string | null = null;
    for (const a of d.args) {
      const x = stripParens(a);
      if (ts.isObjectLiteralExpression(x)) for (const pr of x.properties) {
        if (ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.name) && pr.name.text === 'name' && ts.isStringLiteralLike(pr.initializer)) field = pr.initializer.text;
      }
      if (ts.isStringLiteralLike(x)) field = x.text;
    }
    field ??= ts.isMethodDeclaration(o.decl) && ts.isIdentifier(o.decl.name) ? o.decl.name.text : info.qualified.split('.').pop()!;
    const name = `GRAPHQL ${op} ${field}`;
    const rid = `route:${name}#${o.file}::${info.qualified}`;
    const sp = { start_line: startOf(o.sf, o.decl).line, end_line: o.sf.getLineAndCharacterOfPosition(o.decl.getEnd()).line + 1, start_col: 0, end_col: 0 };
    ctx.node('route', rid, name, name, o.file, sp, { symbol_key: info.key, framework: d.pkg, protocol: 'graphql', operation: op, field, handler: info.id, decorator: shortText(d.node.getText(o.sf), 120) });
    const p = startOf(o.sf, d.node);
    const ev = shortText(d.node.getText(o.sf), 100);
    ctx.edge({ type: 'ROUTES_TO', src: rid, dst: info.id, file: o.file, line: p.line, col: p.col, extraction: 'graphql-decorator', confidence: 0.95, verification: 'framework_inferred', evidence: ev, meta: { protocol: 'graphql', operation: op } });
    if (o.className) ctx.edge({ type: 'DEFINES', src: `class:${o.file}#${o.className}`, dst: rid, file: o.file, line: p.line, col: p.col, extraction: 'graphql-decorator', confidence: 0.95, verification: 'framework_inferred', evidence: ev, meta: {} });
    this.stats.graphql_ops++;
  }

  // ------------------------------------------------------------ per call: dispatch producers, query-builder tables
  onCall(res: CallResolution, st: WalkState): void {
    if (res.kind === 'call' && this.registrations.length && !TEST_FILE_RE.test(st.owner.file)) { // R1: tests do not dispatch
      const exprs: ts.Expression[] = [];
      for (const a of res.node.arguments ?? []) this.keyExprs(a, 3, exprs);
      for (const e of exprs) {
        const k = this.keyOf(e, this.domains);
        if (!k) continue;
        const sf = e.getSourceFile();
        const pos = startOf(sf, e);
        const id = `${st.owner.id}|${k.value}|${pos.line}:${pos.col}`;
        if (this.seenProducer.has(id)) continue; // the same key expression seen from an enclosing/inner call
        this.seenProducer.add(id);
        this.producers.push({ key: k, edges: effectEdges(st, { type: 'PUBLISHES_EVENT', dst: '', file: st.owner.file, line: pos.line, col: pos.col, extraction: 'keyed-dispatch', confidence: k.kind === 'literal' ? 0.7 : 0.8, verification: 'framework_inferred', evidence: shortText(res.text, 140), meta: { key: k.text, key_kind: k.kind, domain: k.domain } }, { branch: false }) });
      }
    }
    if (res.status === 'external' && res.pkg && QUERY_BUILDER_PACKAGES.has(res.pkg) && res.kind === 'call') {
      const callee = stripParens(res.node.expression);
      const m = ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      const op = m ? QB_TABLE_METHODS[m] : undefined;
      const a0 = res.node.arguments?.[0] ? stripParens(res.node.arguments[0]) : undefined;
      if (op && a0 && ts.isStringLiteralLike(a0)) {
        const table = a0.text.split(/\s+as\s+/i)[0].trim();
        if (table && /^[\w.]+$/.test(table)) {
          const id = `db_entity:${res.pkg}#${table}`;
          this.env.ctx.node('db_entity', id, table, table, null, null, { orm: res.pkg, table_or_collection: table, synthetic: true });
          emitEffect(this.env, st, { type: 'QUERIES_DATABASE', dst: id, file: st.owner.file, line: res.line, col: res.col, extraction: `${res.pkg}-query-builder`, confidence: 0.9, verification: 'framework_inferred', evidence: shortText(res.text, 140), meta: { op, member: m, orm: res.pkg, table } });
          this.stats.query_builder_edges++;
        }
      }
    }
  }

  // ------------------------------------------------------------ decide handlers, link producers
  finish(): void {
    const { ctx } = this.env;
    this.stats.producer_sites = this.producers.length;
    if (!this.registrations.length) return;
    const routed = new Set<string>();
    const calledByProd = new Set<string>();
    for (const e of ctx.edges.values()) {
      if (e.type === 'ROUTES_TO') routed.add(e.dst);
      if (e.type === 'CALLS' && e.file && !TEST_FILE_RE.test(e.file)) calledByProd.add(e.dst);
    }
    const handlers = new Map<string, Registration[]>(); // owner id -> registrations
    for (const r of this.registrations) {
      this.stats.handler_candidates++;
      if (routed.has(r.owner.id)) { this.stats.excluded_route++; continue; }
      if (calledByProd.has(r.owner.id)) { this.stats.excluded_called++; continue; }
      let l = handlers.get(r.owner.id); if (!l) handlers.set(r.owner.id, (l = [])); l.push(r);
    }
    // R2: domain specificity = distinct key values registered in the domain / registrations in the domain. A handler is
    // linked only through the key(s) of its most specific domain; domains below MIN_SPECIFICITY are broadcast/filter keys
    // (few values shared by many handlers, e.g. a worker filter or a CRUD action) and never link.
    const regsOfDomain = new Map<string, number>(); const valuesOfDomain = new Map<string, Set<string>>();
    for (const regs of handlers.values()) for (const k of new Map(regs.flatMap((r) => r.keys.map((x) => [x.value, x] as const))).values()) {
      regsOfDomain.set(k.domain, (regsOfDomain.get(k.domain) ?? 0) + 1);
      let vs = valuesOfDomain.get(k.domain); if (!vs) valuesOfDomain.set(k.domain, (vs = new Set())); vs.add(k.value);
    }
    const specificity = (d: string) => valuesOfDomain.get(d)!.size / regsOfDomain.get(d)!;
    const consumersOf = new Map<string, number>();
    const keyText = new Map<string, DispatchKey>();
    const handlerKeys = new Map<string, Set<string>>(); // handler owner id -> linked key values (for R3)
    for (const [ownerId, regs] of [...handlers].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const keys = regs.flatMap((r) => r.keys.map((k) => ({ k, r })));
      const best = Math.max(...keys.map(({ k }) => specificity(k.domain)));
      if (best < DispatchExtractor.MIN_SPECIFICITY) { this.stats.handlers_broadcast_only++; continue; }
      for (const { k, r } of keys) {
        if (specificity(k.domain) !== best) continue; // link through the most specific domain only
        let hk = handlerKeys.get(ownerId); if (!hk) handlerKeys.set(ownerId, (hk = new Set())); hk.add(k.value);
        keyText.set(k.value, k);
        const nid = this.keyNode(k);
        ctx.edge({ type: 'CONSUMES_EVENT', src: r.owner.id, dst: nid, file: r.owner.file, line: r.line, col: r.col, extraction: 'keyed-dispatch', confidence: k.kind === 'literal' ? 0.7 : 0.8, verification: 'framework_inferred', evidence: r.decorator, meta: { key: k.text, key_kind: k.kind, domain: k.domain, domain_specificity: +specificity(k.domain).toFixed(3) } });
        consumersOf.set(k.value, (consumersOf.get(k.value) ?? 0) + 1);
      }
    }
    this.stats.handlers = handlers.size - this.stats.handlers_broadcast_only;
    const producersOf = new Map<string, number>();
    for (const p of this.producers) {
      if (!consumersOf.has(p.key.value)) continue;
      const producerOwner = p.edges[0]?.src;
      if (producerOwner && handlerKeys.get(producerOwner)?.has(p.key.value)) { this.stats.producers_forwarding++; continue; } // R3: forwarding inside a handler of the same key
      const nid = this.keyNode(p.key);
      for (const e of p.edges) { ctx.edge({ ...e, dst: nid }); this.stats.dispatch_edges_out++; }
      producersOf.set(p.key.value, (producersOf.get(p.key.value) ?? 0) + 1);
    }
    for (const [v] of consumersOf) {
      const n = ctx.nodes.get(this.keyNodeId(keyText.get(v)!));
      if (n) { n.meta.handlers = consumersOf.get(v); n.meta.producer_sites = producersOf.get(v) ?? 0; }
    }
    this.env.diag.notes.push(`keyed dispatch: ${this.stats.handlers} handlers (${this.stats.excluded_route} route, ${this.stats.excluded_called} directly-called and ${this.stats.handlers_broadcast_only} broadcast-key-only candidates excluded), ${consumersOf.size} keys, ${this.stats.dispatch_edges_out} producer edges from ${this.stats.producer_sites} typed key sites (${this.stats.producers_forwarding} forwarding sites ignored); ${this.stats.graphql_ops} GraphQL operations; ${this.stats.query_builder_edges} query-builder table edges`);
  }

  private keyNodeId(k: DispatchKey): string { return `event:keyed:${k.value}`; }
  private keyNode(k: DispatchKey): string {
    const id = this.keyNodeId(k);
    this.env.ctx.node('event', id, k.text, k.text, null, null, { synthetic: true, key_kind: k.kind, domain: k.domain, extraction: 'keyed-dispatch' });
    return id;
  }
}
