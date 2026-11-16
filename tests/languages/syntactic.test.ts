/**
 * Tree-sitter front-end (src/languages/syntactic.ts): one small multi-file project per language. Each asserts the
 * edges a reader of the code would draw (this/self calls, declared-type receivers, constructors, static calls,
 * imports across files, inherited methods) and that calls into external libraries produce no edge.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { listCorpusFiles } from '../../src/config.js';
import { buildGraph } from '../../src/graph/graph-builder.js';
import type { GraphEdge } from '../../src/graph/graph-schema.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import { ALL_EXTS, grammarLanguages, initLanguages } from '../../src/languages/registry.js';

type Files = Record<string, string>;
function project(files: Files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-lang-'));
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
  const list = listCorpusFiles(dir, [''], ALL_EXTS);
  return { dir, list };
}
async function graph(files: Files) {
  const { dir, list } = project(files);
  await initLanguages(grammarLanguages(list));
  const g = buildGraph({ repoRoot: dir, files: list });
  const has = (type: string, src: string, dst: string, verification?: string) =>
    g.edges.some((e: GraphEdge) => e.type === type && e.src.endsWith(src) && e.dst.endsWith(dst) && (!verification || e.verification === verification));
  const out = (src: string, type = 'CALLS') => g.edges.filter((e) => e.type === type && e.src.endsWith(src)).map((e) => `${e.dst} [${e.verification}]`).sort();
  return { g, has, out, dir, list };
}
const expectEdges = (h: (t: string, s: string, d: string, v?: string) => boolean, out: (s: string, t?: string) => string[], cases: [string, string, string, string?][]) => {
  for (const [t, s, d, v] of cases) expect(h(t, s, d, v), `${t} ${s} -> ${d}${v ? ` (${v})` : ''}; ${s} has: ${out(s, t).join(', ')}`).toBe(true);
};

describe('syntactic front-end', () => {
  beforeAll(async () => { await initLanguages(['go', 'java', 'kotlin', 'scala', 'csharp', 'rust', 'c', 'cpp', 'ruby', 'php', 'swift']); }, 60_000);

  it('Go: receivers, embedded structs, package imports via go.mod, same-package calls, New* constructors', async () => {
    const { has, out } = await graph({
      'go.mod': 'module example.com/app\n\ngo 1.22\n',
      'store/store.go': 'package store\n\ntype DB struct{ name string }\n\nfunc (d *DB) Query(q string) string { return q }\n\nfunc Open(name string) *DB { return &DB{name: name} }\n',
      'server/server.go': 'package server\n\nimport (\n\t"fmt"\n\t"example.com/app/store"\n)\n\ntype Base struct{}\n\nfunc (b *Base) Log(msg string) { fmt.Println(msg) }\n\ntype Server struct {\n\tBase\n\tdb *store.DB\n}\n\nfunc NewServer() *Server { return &Server{db: store.Open("x")} }\n\nfunc (s *Server) Handle(id string) string {\n\ts.Log(id)\n\tr := s.db.Query(id)\n\treturn helper(r)\n}\n',
      'server/util.go': 'package server\n\nfunc helper(x string) string {\n\ts := NewServer()\n\ts.Handle(x)\n\treturn x\n}\n',
    });
    expectEdges(has, out, [
      ['CALLS', 'server/server.go::Server.Handle', 'store/store.go::DB.Query', 'static_verified'],
      ['CALLS', 'server/server.go::Server.Handle', 'server/server.go::Base.Log', 'static_verified'],
      ['CALLS', 'server/server.go::Server.Handle', 'server/util.go::helper', 'static_verified'],
      ['CALLS', 'server/server.go::NewServer', 'store/store.go::Open', 'static_verified'],
      ['INSTANTIATES', 'server/server.go::NewServer', 'server/server.go::Server'],
      ['CALLS', 'server/util.go::helper', 'server/server.go::Server.Handle', 'static_verified'],
      ['EXTENDS', 'server/server.go::Server', 'server/server.go::Base'],
      ['IMPORTS', 'file:server/server.go', 'file:store/store.go'],
    ]);
    expect(out('server/server.go::Base.Log')).toEqual([]); // fmt.Println is the standard library
  });

  it('Java: fields, static imports of classes, implicit this, inherited methods, typed locals, constructors', async () => {
    const J = 'src/main/java/com/acme/';
    const { has, out } = await graph({
      [`${J}util/Strings.java`]: 'package com.acme.util;\npublic class Strings { public static String trim(String s) { return s.trim(); } }\n',
      [`${J}app/Repo.java`]: 'package com.acme.app;\npublic class Repo { public User findById(String id) { return new User(); } }\n',
      [`${J}app/User.java`]: 'package com.acme.app;\npublic class User { public User() {} public void touch() {} }\n',
      [`${J}app/BaseService.java`]: 'package com.acme.app;\npublic abstract class BaseService { protected void audit(String m) {} }\n',
      [`${J}app/Service.java`]: 'package com.acme.app;\npublic interface Service { User find(String id); }\n',
      [`${J}app/UserService.java`]: 'package com.acme.app;\nimport com.acme.util.Strings;\nimport java.util.List;\npublic class UserService extends BaseService implements Service {\n  private final Repo repo;\n  public UserService(Repo r) { this.repo = r; }\n  public User find(String id) {\n    validate(id);\n    audit(id);\n    User u = repo.findById(Strings.trim(id));\n    u.touch();\n    Repo other = new Repo();\n    other.findById(id);\n    List.of(id).size();\n    return u;\n  }\n  private void validate(String id) {}\n}\n',
    });
    const S = 'app/UserService.java::UserService';
    expectEdges(has, out, [
      ['CALLS', `${S}.find`, `${S}.validate`, 'static_verified'],
      ['CALLS', `${S}.find`, 'app/BaseService.java::BaseService.audit', 'static_verified'],
      ['CALLS', `${S}.find`, 'app/Repo.java::Repo.findById', 'static_verified'],
      ['CALLS', `${S}.find`, 'util/Strings.java::Strings.trim', 'static_verified'],
      ['CALLS', `${S}.find`, 'app/User.java::User.touch', 'static_verified'],
      ['INSTANTIATES', `${S}.find`, 'app/Repo.java::Repo'],
      ['INSTANTIATES', 'app/Repo.java::Repo.findById', 'app/User.java::User'],
      ['CALLS', 'app/Repo.java::Repo.findById', 'app/User.java::User.User', 'static_verified'],
      ['EXTENDS', S, 'app/BaseService.java::BaseService'],
      ['IMPLEMENTS', S, 'app/Service.java::Service'],
      ['IMPORTS', `file:${J}app/UserService.java`, `file:${J}util/Strings.java`],
    ]);
    expect(out(`${S}.find`).some((e) => e.includes('size'))).toBe(false);
  });

  it('Kotlin: constructor properties, objects, imported functions, X() constructors', async () => {
    const { has, out } = await graph({
      'src/main/kotlin/app/Repo.kt': 'package app\n\nclass Repo {\n  fun findById(id: String): User = User(id)\n}\n\nclass User(val id: String) {\n  fun touch() {}\n}\n',
      'src/main/kotlin/app/util/Util.kt': 'package app.util\n\nobject Strings {\n  fun trim(s: String) = s\n}\n\nfun normalize(s: String) = s\n',
      'src/main/kotlin/app/Service.kt': 'package app\n\nimport app.util.Strings\nimport app.util.normalize\n\nopen class Base {\n  fun audit(m: String) {}\n}\n\nclass UserService(private val repo: Repo) : Base() {\n  private val cache = Repo()\n\n  fun find(id: String): User {\n    audit(id)\n    val u = repo.findById(Strings.trim(normalize(id)))\n    val r = Repo()\n    r.findById(id)\n    cache.findById(id)\n    println(u)\n    return u\n  }\n\n  companion object {\n    fun create(): UserService {\n      return UserService(Repo())\n    }\n  }\n}\n',
    });
    const S = 'app/Service.kt::UserService';
    expectEdges(has, out, [
      ['CALLS', `${S}.find`, 'app/Service.kt::Base.audit', 'static_verified'],
      ['CALLS', `${S}.find`, 'app/Repo.kt::Repo.findById', 'static_verified'],
      ['CALLS', `${S}.find`, 'util/Util.kt::Strings.trim', 'static_verified'],
      ['CALLS', `${S}.find`, 'util/Util.kt::normalize', 'static_verified'],
      ['INSTANTIATES', `${S}.find`, 'app/Repo.kt::Repo'],
      ['INSTANTIATES', 'app/Repo.kt::Repo.findById', 'app/Repo.kt::User'],
      ['EXTENDS', S, 'app/Service.kt::Base'],
      ['INSTANTIATES', `${S}.create`, S],
    ]);
    expect(out(`${S}.find`).filter((e) => e.includes('Repo.findById [static_verified]')).length, 'repo, r and cache: three call sites, all Repo.findById').toBe(3);
    expect(out(`${S}.find`).some((e) => e.includes('println'))).toBe(false);
  });

  it('Scala: class parameters, traits, objects, new', async () => {
    const { has, out } = await graph({
      'src/main/scala/app/util/Strings.scala': 'package app.util\n\nobject Strings {\n  def trim(s: String): String = s\n}\n',
      'src/main/scala/app/Model.scala': 'package app\n\nclass Base {\n  def audit(m: String): Unit = {}\n}\n\nclass Repo {\n  def findById(id: String): User = new User(id)\n}\n\nclass User(id: String) {\n  def touch(): Unit = {}\n}\n\ntrait Service {\n  def find(id: String): User\n}\n',
      'src/main/scala/app/UserService.scala': 'package app\n\nimport app.util.Strings\n\nclass UserService(repo: Repo) extends Base with Service {\n  def find(id: String): User = {\n    audit(id)\n    val u = repo.findById(Strings.trim(id))\n    val r = new Repo()\n    r.findById(id)\n    u\n  }\n}\n',
    });
    const S = 'app/UserService.scala::UserService';
    expectEdges(has, out, [
      ['CALLS', `${S}.find`, 'app/Model.scala::Base.audit', 'static_verified'],
      ['CALLS', `${S}.find`, 'app/Model.scala::Repo.findById', 'static_verified'],
      ['CALLS', `${S}.find`, 'util/Strings.scala::Strings.trim', 'static_verified'],
      ['INSTANTIATES', `${S}.find`, 'app/Model.scala::Repo'],
      ['EXTENDS', S, 'app/Model.scala::Base'],
      ['IMPLEMENTS', S, 'app/Model.scala::Service'],
    ]);
  });

  it('C#: namespaces via using, fields without this, var + new, static classes, base classes and interfaces', async () => {
    const { has, out } = await graph({
      'Data/Repo.cs': 'namespace Acme.Data\n{\n  public class Repo { public User Find(int id) { return new User(); } }\n  public class User { public void Touch() {} }\n}\n',
      'App/OrderService.cs': 'using System;\nusing Acme.Data;\n\nnamespace Acme.App\n{\n  public interface IService { void Run(int id); }\n  public class BaseService { protected void Audit(string m) {} }\n  public class OrderService : BaseService, IService\n  {\n    private readonly Repo _repo;\n    public OrderService(Repo repo) { _repo = repo; }\n    public void Run(int id)\n    {\n      Validate(id);\n      Audit("x");\n      User u2 = _repo.Find(id);\n      u2.Touch();\n      var r = new Repo();\n      r.Find(id);\n      Helpers.Log("x");\n      Console.WriteLine("x");\n    }\n    void Validate(int id) {}\n  }\n  public static class Helpers { public static void Log(string m) {} }\n}\n',
    });
    const S = 'App/OrderService.cs::OrderService';
    expectEdges(has, out, [
      ['CALLS', `${S}.Run`, `${S}.Validate`, 'static_verified'],
      ['CALLS', `${S}.Run`, 'App/OrderService.cs::BaseService.Audit', 'static_verified'],
      ['CALLS', `${S}.Run`, 'Data/Repo.cs::Repo.Find', 'static_verified'],
      ['CALLS', `${S}.Run`, 'Data/Repo.cs::User.Touch', 'static_verified'],
      ['CALLS', `${S}.Run`, 'App/OrderService.cs::Helpers.Log', 'static_verified'],
      ['INSTANTIATES', `${S}.Run`, 'Data/Repo.cs::Repo'],
      ['EXTENDS', S, 'App/OrderService.cs::BaseService'],
      ['IMPLEMENTS', S, 'App/OrderService.cs::IService'],
    ]);
    expect(out(`${S}.Run`).some((e) => e.includes('WriteLine'))).toBe(false);
  });

  it('Rust: impl blocks, traits, use paths, mod declarations, Type::new, self fields', async () => {
    const { has, out } = await graph({
      'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\n',
      'src/lib.rs': 'pub mod db;\nmod util;\npub mod server;\n',
      'src/db.rs': 'pub struct Pool { size: usize }\n\nimpl Pool {\n    pub fn get(&self) -> usize { self.size }\n    pub fn new() -> Pool { Pool { size: 1 } }\n}\n\npub fn connect() -> Pool { Pool::new() }\n',
      'src/util.rs': 'pub fn log(m: &str) { println!("{}", m); }\n',
      'src/server.rs': 'use crate::db::{Pool, connect};\nuse crate::util;\n\npub trait Handler { fn handle(&self); }\n\npub struct Server { pool: Pool }\n\nimpl Server {\n    pub fn new() -> Self { Server { pool: connect() } }\n    fn run(&self) {\n        self.serve();\n        util::log("x");\n        self.pool.get();\n        let p = Pool::new();\n        p.get();\n        helper();\n        let v: Vec<u8> = Vec::new();\n    }\n    fn serve(&self) {}\n}\n\nimpl Handler for Server {\n    fn handle(&self) { self.run() }\n}\n\nfn helper() {\n    let s = Server::new();\n    s.run();\n}\n',
    });
    const S = 'src/server.rs::Server';
    expectEdges(has, out, [
      ['CALLS', `${S}.run`, `${S}.serve`, 'static_verified'],
      ['CALLS', `${S}.run`, 'src/util.rs::log', 'static_verified'],
      ['CALLS', `${S}.run`, 'src/db.rs::Pool.get', 'static_verified'],
      ['CALLS', `${S}.run`, 'src/db.rs::Pool.new', 'static_verified'],
      ['CALLS', `${S}.run`, 'src/server.rs::helper', 'static_verified'],
      ['CALLS', `${S}.new`, 'src/db.rs::connect', 'static_verified'],
      ['INSTANTIATES', `${S}.new`, S],
      ['CALLS', 'src/server.rs::helper', `${S}.new`, 'static_verified'],
      ['CALLS', 'src/server.rs::helper', `${S}.run`, 'static_verified'],
      ['CALLS', `${S}.handle`, `${S}.run`, 'static_verified'],
      ['IMPLEMENTS', S, 'src/server.rs::Handler'],
      ['IMPORTS', 'file:src/server.rs', 'file:src/db.rs'],
      ['IMPORTS', 'file:src/lib.rs', 'file:src/util.rs'],
    ]);
  });

  it('C: includes, header implementations, static functions; unknown externals get no edge', async () => {
    const { has, out } = await graph({
      'include/log.h': 'void log_msg(const char *m);\n',
      'src/log.c': '#include "../include/log.h"\n#include <stdio.h>\nvoid log_msg(const char *m) { printf("%s", m); }\n',
      'src/server.c': '#include "../include/log.h"\nstruct server { int fd; };\nstatic int helper(int x) { return x + 1; }\nint server_run(struct server *s) { log_msg("x"); s->fd = helper(2); unknown_fn(); return 0; }\n',
    });
    expectEdges(has, out, [
      ['CALLS', 'src/server.c::server_run', 'src/server.c::helper', 'static_verified'],
      ['CALLS', 'src/server.c::server_run', 'src/log.c::log_msg', 'static_verified'],
      ['IMPORTS', 'file:src/server.c', 'file:include/log.h'],
    ]);
    expect(out('src/server.c::server_run').length).toBe(2);
  });

  it('C++: out-of-line methods, this->, inherited methods, member fields, auto + new', async () => {
    const { has, out } = await graph({
      'src/conn.hpp': '#pragma once\nstruct Conn { void open() {} };\n',
      'src/server.hpp': '#pragma once\n#include "conn.hpp"\nnamespace app {\nclass Base { public: void stop() {} };\nclass Server : public Base {\n public:\n  void run();\n  void serve() {}\n private:\n  Conn* conn_;\n};\n}\n',
      'src/server.cpp': '#include "server.hpp"\n#include <vector>\nnamespace app {\nstatic int helper(int x) { return x; }\nvoid Server::run() {\n  serve();\n  this->stop();\n  helper(1);\n  conn_->open();\n  auto* p = new Conn();\n  p->open();\n  std::vector<int> v; v.push_back(1);\n}\n}\n',
    });
    expectEdges(has, out, [
      ['CALLS', 'src/server.cpp::Server.run', 'src/server.hpp::Server.serve', 'static_verified'],
      ['CALLS', 'src/server.cpp::Server.run', 'src/server.hpp::Base.stop', 'static_verified'],
      ['CALLS', 'src/server.cpp::Server.run', 'src/server.cpp::helper', 'static_verified'],
      ['CALLS', 'src/server.cpp::Server.run', 'src/conn.hpp::Conn.open', 'static_verified'],
      ['INSTANTIATES', 'src/server.cpp::Server.run', 'src/conn.hpp::Conn'],
      ['EXTENDS', 'src/server.hpp::Server', 'src/server.hpp::Base'],
      ['IMPORTS', 'file:src/server.cpp', 'file:src/server.hpp'],
    ]);
  });

  it('Ruby: modules, require_relative, implicit self, instance variables from X.new, singleton methods', async () => {
    const { has, out } = await graph({
      'lib/billing/helper.rb': 'module Billing\n  module Helper\n    def self.add(a, b)\n      a + b\n    end\n  end\nend\n',
      'lib/billing/invoice.rb': "require 'json'\nrequire_relative 'helper'\n\nmodule Billing\n  class Base\n    def audit(m)\n      m\n    end\n  end\n\n  class Invoice < Base\n    include Comparable\n\n    def initialize(items)\n      @items = items\n      @calc = Calculator.new\n    end\n\n    def total\n      validate!\n      sum = Helper.add(1, 2)\n      audit(sum)\n      self.tax(sum)\n      @calc.compute(sum)\n      JSON.dump(sum)\n    end\n\n    def tax(x)\n      x\n    end\n\n    def validate!\n      true\n    end\n  end\n\n  class Calculator\n    def compute(x)\n      x\n    end\n  end\nend\n",
    });
    const I = 'lib/billing/invoice.rb::Billing.Invoice';
    expectEdges(has, out, [
      ['CALLS', `${I}.total`, `${I}.validate!`, 'static_verified'],
      ['CALLS', `${I}.total`, 'lib/billing/helper.rb::Billing.Helper.add', 'static_verified'],
      ['CALLS', `${I}.total`, 'lib/billing/invoice.rb::Billing.Base.audit', 'static_verified'],
      ['CALLS', `${I}.total`, `${I}.tax`, 'static_verified'],
      ['CALLS', `${I}.total`, 'lib/billing/invoice.rb::Billing.Calculator.compute', 'static_verified'],
      ['INSTANTIATES', `${I}.initialize`, 'lib/billing/invoice.rb::Billing.Calculator'],
      ['EXTENDS', I, 'lib/billing/invoice.rb::Billing.Base'],
      ['IMPORTS', 'file:lib/billing/invoice.rb', 'file:lib/billing/helper.rb'],
    ]);
  });

  it('PHP: namespaces and use, static calls, $this, promoted constructor properties, self::', async () => {
    const { has, out } = await graph({
      'src/Models/User.php': '<?php\nnamespace App\\Models;\n\nclass User\n{\n    public static function find($id) { return new User(); }\n    public function touch() {}\n}\n',
      'src/Http/UserController.php': '<?php\nnamespace App\\Http;\n\nuse App\\Models\\User;\n\nclass Controller { protected function authorize($x) {} }\n\nclass UserController extends Controller\n{\n    public function __construct(private Repo $repo) {}\n\n    public function show(int $id)\n    {\n        $this->authorize($id);\n        $u = User::find($id);\n        $v = new User();\n        $v->touch();\n        $this->repo->load($id);\n        helper($u);\n        return self::fmt($u);\n    }\n\n    private static function fmt($u) { return $u; }\n}\n\nclass Repo { public function load($id) {} }\n\nfunction helper($u) { return $u; }\n',
    });
    const C = 'src/Http/UserController.php::UserController';
    expectEdges(has, out, [
      ['CALLS', `${C}.show`, 'src/Http/UserController.php::Controller.authorize', 'static_verified'],
      ['CALLS', `${C}.show`, 'src/Models/User.php::User.find', 'static_verified'],
      ['CALLS', `${C}.show`, 'src/Models/User.php::User.touch', 'static_verified'],
      ['CALLS', `${C}.show`, 'src/Http/UserController.php::Repo.load', 'static_verified'],
      ['CALLS', `${C}.show`, 'src/Http/UserController.php::helper', 'static_verified'],
      ['CALLS', `${C}.show`, `${C}.fmt`, 'static_verified'],
      ['INSTANTIATES', `${C}.show`, 'src/Models/User.php::User'],
      ['EXTENDS', C, 'src/Http/UserController.php::Controller'],
      ['IMPORTS', 'file:src/Http/UserController.php', 'file:src/Models/User.php'],
    ]);
  });

  it('Swift: protocols, extensions, typed properties, X() constructors, implicit self', async () => {
    const { has, out } = await graph({
      'Sources/App/Item.swift': 'struct Item {\n  func run() {}\n}\n\nclass BaseCache {\n  func evict() {}\n}\n',
      'Sources/App/Cache.swift': 'import Foundation\n\nprotocol Store {\n  func get(_ id: String) -> Item?\n}\n\nclass Cache: BaseCache, Store {\n  var current: Item\n  init(size: Int) { current = Item() }\n  func get(_ id: String) -> Item? {\n    validate(id)\n    self.evict()\n    current.run()\n    let x = Item()\n    x.run()\n    return nil\n  }\n  private func validate(_ id: String) {}\n}\n\nextension Cache {\n  func clear() { evict() }\n}\n\nfunc topLevel() {\n  let c = Cache(size: 1)\n  _ = c.get("a")\n  c.clear()\n}\n',
    });
    const C = 'Sources/App/Cache.swift::Cache';
    expectEdges(has, out, [
      ['CALLS', `${C}.get`, `${C}.validate`, 'static_verified'],
      ['CALLS', `${C}.get`, 'Sources/App/Item.swift::BaseCache.evict', 'static_verified'],
      ['CALLS', `${C}.get`, 'Sources/App/Item.swift::Item.run', 'static_verified'],
      ['INSTANTIATES', `${C}.get`, 'Sources/App/Item.swift::Item'],
      ['CALLS', `${C}.clear`, 'Sources/App/Item.swift::BaseCache.evict', 'static_verified'],
      ['INSTANTIATES', 'Sources/App/Cache.swift::topLevel', C],
      ['CALLS', 'Sources/App/Cache.swift::topLevel', `${C}.init`, 'static_verified'],
      ['CALLS', 'Sources/App/Cache.swift::topLevel', `${C}.get`, 'static_verified'],
      ['CALLS', 'Sources/App/Cache.swift::topLevel', `${C}.clear`, 'static_verified'],
      ['EXTENDS', C, 'Sources/App/Item.swift::BaseCache'],
      ['IMPLEMENTS', C, 'Sources/App/Cache.swift::Store'],
    ]);
  });

  it('symbol index and graph agree on declaration keys; overloads get distinct keys', async () => {
    const files = {
      'A.java': 'class A {\n  void f(int x) {}\n  void f(String s) {}\n  class Inner { void g() {} }\n}\n',
      'b.go': 'package b\n\ntype T struct{}\n\nfunc (t T) M() {}\n\nfunc F() {}\n',
    };
    const { g, dir, list } = await graph(files);
    const idx = new SymbolIndex(dir, list);
    const keys = [...idx.byKey.keys()].sort();
    expect(keys).toEqual(['A.java::<module>', 'A.java::A', 'A.java::A.Inner', 'A.java::A.Inner.g', 'A.java::A.f', 'A.java::A.f#2', 'b.go::<module>', 'b.go::F', 'b.go::T', 'b.go::T.M']);
    const graphKeys = g.nodes.map((n) => (n.meta as { symbol_key?: string }).symbol_key).filter((k): k is string => !!k).sort();
    expect(graphKeys).toEqual(keys);
  });
});

describe('JavaScript through the TypeScript compiler', () => {
  it('resolves ES module and CommonJS imports, classes and methods', async () => {
    const { has, out, g } = await graph({
      'lib/math.js': 'export function add(a, b) { return a + b; }\nexport class Calc {\n  mul(a, b) { return a * b; }\n}\n',
      'app.js': "import { add, Calc } from './lib/math.js';\n\nexport function main() {\n  const c = new Calc();\n  return c.mul(add(1, 2), 3);\n}\n",
      'cjs.js': "const util = require('./util');\n\nfunction run() {\n  return util.twice(2);\n}\n\nmodule.exports = { run };\n",
      'util.js': 'function twice(x) { return 2 * x; }\n\nmodule.exports = { twice };\n',
    });
    const callsFromMain = out('app.js#main');
    expect(g.nodes.some((n) => n.file === 'lib/math.js'), 'JS files are in the graph').toBe(true);
    expect(has('CALLS', 'app.js#main', 'lib/math.js#add', 'static_verified'), callsFromMain.join(', ')).toBe(true);
    expect(has('CALLS', 'app.js#main', 'lib/math.js#Calc.mul', 'static_verified'), callsFromMain.join(', ')).toBe(true);
    expect(has('INSTANTIATES', 'app.js#main', 'lib/math.js#Calc'), callsFromMain.join(', ')).toBe(true);
    expect(has('CALLS', 'cjs.js#run', 'util.js#twice', 'static_verified'), out('cjs.js#run').join(', ')).toBe(true);
  });
});
