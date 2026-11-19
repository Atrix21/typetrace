#!/usr/bin/env tsx
/**
 * Experiment 10: Claude Code agents on SWE-bench Lite + Multilingual issues. Protocol:
 * experiments/10-swebench-agents/protocol.md.
 *
 *   npx tsx scripts/swebench/agent.ts --run <id> --set pilot|main [--n N] --arms A0,A1,A2,A5,A6 --repeats 2 \
 *       --model claude-haiku-5-5 --accounts <login1>,<login2> [--workers 4] [--min-free-gb 4] [--run-usd 1] [--max-usd X]
 *       [--mock] [--only id,id] [--timeout-s 900]
 *
 * Same arms, isolation profile, answer schema and scoring as experiment 3 (scripts/exp3/agent.ts):
 *   A0 Read/Grep/Glob only;
 *   A1/A2 our find_relevant_code tool without/with graph propagation (one retrieval daemon per issue);
 *   A5 graphify's own MCP server;
 *   A6 code-review-graph's own MCP server with its local embeddings.
 *
 * What is new:
 * - Issues come from SWE-bench Lite (300) and Multilingual (300). The ground truth is the frozen one of experiments 5
 *   and 8, and the corpus is each experiment's own file selection, so the warm embedding caches are reused.
 * - Workers run issues in parallel. A worker starts an issue only while at least --min-free-gb is available, and
 *   index builds are serialised (one at a time). Within an issue, (arm, repeat) runs in a seeded order, so every
 *   worker mixes arms. One shared query-embedding model serves every daemon (TYPETRACE_EMBED_URL). Document
 *   embedding is serialised machine-wide (TYPETRACE_EMBED_LOCK).
 * - Account failover. --accounts lists Claude Code logins in order. When one hits its usage limit, the runs move
 *   to the next. When all are exhausted, the runner waits and probes again. Each run records its account (name,
 *   plan, e-mail hash). A usage-limit stop is retried and is never counted as an attempt.
 *
 * Output under experiments/10-swebench-agents/results/<run>/: plan.json, runs.jsonl, excluded.jsonl, accounts.jsonl,
 * meta.json, transcripts/ and tool-logs/ (the last two git-ignored). Resumable.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { abs, listCorpusFiles } from '../../src/config.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import { initLanguages, grammarLanguages } from '../../src/languages/registry.js';
import { sourceFiles } from '../../src/product/source-files.js';
import type { GroundTruthTask } from '../../src/types.js';
import {
  BillableGuard, BillableRefused, EXPECTED_MCP_TOOLS, buildClaudeCommand, checkInit, installSignalHandlers, isUsageLimitExclusion,
  onHarnessAbort, parseStreamJson, runClaude, type McpServerSpec,
} from '../../src/agent-eval/backends/claude-code.js';
import { bindAccount, claudeVersion, DENY_TOOLS } from '../../src/agent-eval/agentic.js';
import { accountRecord, type AccountInfo } from '../../src/agent-eval/account.js';
import { startMockServer, type MockStep } from '../../src/agent-eval/mock-anthropic/server.js';
import { opaqueId, WORK_ROOT } from '../../src/agent-eval/workspace.js';
import { ANSWER_SCHEMA, parseAnswer, scoreAnswer } from '../../src/agent-eval/exp3/score.js';
import { EXP3_SERVER_NAME, EXP3_TOOL_NAME } from '../../src/agent-eval/exp3/tool-def.js';
import { competitorServerSpec } from '../../src/agent-eval/mcp/competitor-servers.js';
import { startSharedEmbedServer } from '../../src/agent-eval/shared-embedder.js';
import { SWE_SYSTEM_PROMPT, sweTaskPrompt } from '../../src/agent-eval/swebench/prompt.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (n: string) => process.argv.includes(`--${n}`);
const RUN = arg('run')!;
const SET = arg('set', 'pilot')!;
const N = arg('n') ? Number(arg('n')) : null;
const ARMS = arg('arms', 'A0,A1,A2,A5,A6')!.split(',');
const MODEL = arg('model', 'claude-haiku-5-5')!;
const EFFORT = arg('effort', 'high')!;
const REPEATS = Number(arg('repeats', '2'));
const ACCOUNTS = arg('accounts', process.argv.includes('--mock') ? 'mock' : '')!.split(',').filter(Boolean);
/** Recorded label of a login: its position in --accounts (login1, login2, ...). The login names stay on the command line. */
const label = (n: string) => `login${ACCOUNTS.indexOf(n) + 1}`;
const WORKERS = Number(arg('workers', '4'));
const MIN_FREE_GB = Number(arg('min-free-gb', '4'));
const MOCK = flag('mock');
const ONLY = arg('only')?.split(',');
const TIMEOUT_S = Number(arg('timeout-s', '900'));
const MAX_TURNS = 40;
const ARM_BACKEND: Record<string, string | null> = { A0: null, A1: 'compact_nograph', A2: 'compact_graph', A5: 'graphify', A6: 'crg' };
const COMPETITOR: Record<string, 'graphify' | 'crg'> = { A5: 'graphify', A6: 'crg' };
const OURS = (arm: string) => arm === 'A1' || arm === 'A2';
const EXP = abs('experiments/10-swebench-agents');
const OUT = path.join(EXP, 'results', RUN);
const SCRATCH = abs('.cache/swebench-agent');
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
EXPECTED_MCP_TOOLS[EXP3_SERVER_NAME] = [EXP3_TOOL_NAME];

const readJsonl = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const append = (f: string, o: unknown) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n');
const log = (s: string) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const memFreeGb = () => { const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); return m ? Number(m[1]) / 1048576 : 0; };

// ---------------------------------------------------------------- issues and frozen ground truth
interface Issue { id: string; bench: 'lite' | 'ml'; repo: string; base_commit: string; problem: string; gt: string[] }
function loadIssues(): Map<string, Issue> {
  const out = new Map<string, Issue>();
  const firstById = (f: string) => { const m = new Map<string, any>(); for (const r of readJsonl(abs(f))) if (!m.has(r.task_id)) m.set(r.task_id, r); return m; };
  const liteGt = firstById('experiments/05-swebench-python/results/tasks.jsonl');
  // Experiment 8's scored ground truth where it exists, else its frozen dry run (same rule, derived before any method ran).
  const mlGt = firstById('.cache/swebench-ml/gt-dryrun/tasks.jsonl');
  for (const [k, v] of firstById('experiments/08-swebench-multilingual/results/tasks.jsonl')) mlGt.set(k, v);
  for (const [bench, file, gt] of [['lite', '.cache/swebench/lite-test.json', liteGt], ['ml', '.cache/swebench-ml/ml-test.json', mlGt]] as const) {
    for (const x of JSON.parse(fs.readFileSync(abs(file), 'utf8'))) {
      const g = gt.get(x.instance_id);
      if (!g?.ground_truth?.length) continue; // excluded by experiments 5/8 (no declaration changed)
      out.set(x.instance_id, { id: x.instance_id, bench, repo: x.repo, base_commit: x.base_commit, problem: x.problem_statement, gt: g.ground_truth });
    }
  }
  return out;
}

/** Snapshot of the repository at base_commit (git archive: read-only on the clone, safe in parallel). */
function snapshot(is: Issue): { root: string; files: string[]; embCache: string } {
  const clone = abs(`${is.bench === 'lite' ? 'targets/swebench' : 'targets/swebench-ml'}/${is.repo.replace('/', '__')}`);
  if (!fs.existsSync(path.join(clone, '.git'))) throw new Error(`no clone at ${clone} (run experiment ${is.bench === 'lite' ? 5 : 8} setup first)`);
  const root = path.join(SCRATCH, 'snap', is.id);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const a = spawnSync('bash', ['-c', `git -C '${clone}' archive --format=tar '${is.base_commit}' | tar -x -C '${root}'`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (a.status !== 0) throw new Error(`git archive ${is.id}: ${a.stderr.slice(-400)}`);
  // Each experiment's own corpus definition (experiment 5: every .py file; experiment 8: the product's selection).
  const files = is.bench === 'lite' ? listCorpusFiles(root, [''], ['.py']) : sourceFiles(root, ['']);
  return { root, files, embCache: abs(`${is.bench === 'lite' ? '.cache/swebench/emb' : '.cache/swebench-ml/emb'}/${is.repo.replace('/', '__')}`) };
}

const MANIFESTS = ['README.md', 'README.rst', 'README', 'setup.py', 'setup.cfg', 'pyproject.toml', 'package.json', 'tsconfig.json', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile', 'CMakeLists.txt', 'Makefile'];
/** Isolated workspace: the corpus files plus top-level manifests (no .git, no ground truth). */
function makeWorkspace(root: string, files: string[], key: string): string {
  const parent = path.join(WORK_ROOT, opaqueId(key, RUN));
  const dir = path.join(parent, 'app');
  fs.rmSync(parent, { recursive: true, force: true });
  for (const f of [...files, ...MANIFESTS]) {
    const src = path.join(root, f);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(src, path.join(dir, f));
  }
  return dir;
}

// ---------------------------------------------------------------- serialised index builds
let buildChain: Promise<unknown> = Promise.resolve();
function serialBuild<T>(fn: () => Promise<T>): Promise<T> { const p = buildChain.then(fn, fn); buildChain = p.catch(() => undefined); return p; }

function buildGraph(root: string, filesJson: string, key: string): string {
  const dir = path.join(SCRATCH, 'graphs', key);
  const f = path.join(dir, 'graph.sqlite');
  if (fs.existsSync(f)) return f;
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync(abs('node_modules/.bin/tsx'), [abs('src/graph/build-cli.ts'), '--repo', root, '--out', dir, '--files-from', filesJson, '--max-package-decl-mb', '0', '--no-json'], { cwd: abs('.'), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=7000' }, maxBuffer: 64 << 20 });
  if (r.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true }); // never leave a partial graph for a later run to reuse
    throw new Error(`graph build failed: ${(r.stderr ?? '').split('\n').filter((l) => !/^\s+at /.test(l)).join('\n').slice(-800)}`);
  }
  return f;
}

async function startDaemon(root: string, graph: string, filesJson: string, embCache: string, key: string, embedUrl: string | null): Promise<{ port: number; child: ChildProcess; info: any }> {
  const child = spawn(abs('node_modules/.bin/tsx'), [abs('src/agent-eval/exp3/daemon.ts'), '--root', root, '--graph', graph, '--files', filesJson, '--emb-cache', embCache, '--cache', path.join(SCRATCH, 'daemon', key)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=6000', HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false', TYPETRACE_EMBED_LOCK: '1', ...(embedUrl ? { TYPETRACE_EMBED_URL: embedUrl } : {}) },
  });
  let errTail = '';
  child.stderr!.on('data', (d) => { errTail = (errTail + d).slice(-2000); });
  const info = await new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`daemon start timeout: ${errTail}`)), 30 * 60_000);
    readline.createInterface({ input: child.stdout! }).on('line', (l) => { try { const j = JSON.parse(l); if (j.ready) { clearTimeout(t); resolve(j); } } catch { /* */ } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error(`daemon exited (${c}): ${errTail}`)); });
  });
  return { port: info.port, child, info };
}

// ---------------------------------------------------------------- accounts with failover
class AccountPool {
  private exhaustedAt = new Map<string, number>();
  private infos = new Map<string, AccountInfo | null>();
  private guards = new Map<string, BillableGuard>();
  constructor(private names: string[], private runUsd: number, private maxUsd: number) {
    for (const n of names) {
      const a = MOCK ? null : bindAccount({ account: n, billing: 'subscription', mock: MOCK });
      this.infos.set(n, a);
      const g = new BillableGuard({ protocol: 'agentic', conditions: ARMS, model: MODEL, split: SET, max_total_usd: maxUsd, billing: 'subscription', account: n },
        { runUsd, approvalPath: path.join(EXP, 'APPROVAL.json'), ledgerPath: path.join(EXP, 'spend-ledger.jsonl') });
      if (!MOCK) g.assertAllowed({}, false);
      this.guards.set(n, g);
    }
  }
  /** The first account not marked exhausted in the last 30 minutes, or null if all are. */
  current(): string | null {
    const now = Date.now();
    return this.names.find((n) => now - (this.exhaustedAt.get(n) ?? 0) > 30 * 60_000) ?? null;
  }
  exhausted(n: string, why: string) {
    if (now() - (this.exhaustedAt.get(n) ?? 0) > 60_000) { log(`ACCOUNT ${n} hit its limit: ${why.slice(0, 160)}`); append('accounts.jsonl', { at: new Date().toISOString(), account: label(n), event: 'limit', detail: why.slice(0, 300) }); }
    this.exhaustedAt.set(n, now());
  }
  info(n: string) { return this.infos.get(n) ?? null; }
  guard(n: string) { return this.guards.get(n)!; }
  record(n: string) { const a = this.infos.get(n); return a ? { ...accountRecord(a), name: label(n) } : { name: label(n), mock: true }; }
}
const now = () => Date.now();

// ---------------------------------------------------------------- one runner at a time
/**
 * Snapshots, workspaces, index caches and competitor caches are shared by every run of this experiment, so two
 * runners at once (a second launch by mistake, or a mock test during the real run) would overwrite each other's
 * files. A machine-wide lock file holds the PID; a lock whose process is gone is taken over.
 */
function takeRunnerLock() {
  const lock = path.join(SCRATCH, 'runner.lock');
  fs.mkdirSync(SCRATCH, { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, run: RUN, started: new Date().toISOString() }), { flag: 'wx' });
      const release = () => { try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid) fs.rmSync(lock); } catch { /* */ } };
      process.on('exit', release);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let owner: { pid?: number; run?: string } = {};
      try { owner = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { /* unreadable: treat as stale */ }
      let alive = false;
      try { if (owner.pid) { process.kill(owner.pid, 0); alive = true; } } catch { /* gone */ }
      if (alive) throw new Error(`another experiment-10 runner is active (pid ${owner.pid}, run ${owner.run}); lock ${lock}`);
      fs.rmSync(lock, { force: true }); // stale
    }
  }
  throw new Error(`could not take ${lock}`);
}

// ---------------------------------------------------------------- main
async function main() {
  if (!RUN || !['pilot', 'main'].includes(SET)) throw new Error('usage: agent.ts --run <id> --set pilot|main ...');
  if (!ACCOUNTS.length) throw new Error('--accounts <login>[,<login>...] is required (the Claude Code logins to use, in order)');
  for (const a of ARMS) if (!(a in ARM_BACKEND)) throw new Error(`unknown arm ${a}`);
  takeRunnerLock();
  fs.mkdirSync(path.join(OUT, 'transcripts'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'tool-logs'), { recursive: true });
  const sel = JSON.parse(fs.readFileSync(path.join(EXP, 'selection.json'), 'utf8'));
  const issuesAll = loadIssues();
  let ids: string[] = SET === 'pilot' ? sel.pilot : sel.main;
  // The pool is defined without issues that have no ground truth (protocol, Data), so --n counts eligible issues (E10-D04).
  const ineligible = ids.filter((i) => !issuesAll.has(i));
  if (ineligible.length) log(`note: ${ineligible.length} pool issue(s) have no frozen ground truth and are not part of the pool: ${ineligible.join(', ')}`);
  ids = ids.filter((i) => issuesAll.has(i));
  if (N != null) ids = ids.slice(0, N);
  if (ONLY) ids = ids.filter((i) => ONLY.includes(i));
  const issues = ids.map((i) => issuesAll.get(i)).filter((x): x is Issue => !!x);
  if (issues.length !== ids.length) log(`note: ${ids.length - issues.length} selected issue(s) have no frozen ground truth and are skipped`);
  const runUsd = Number(arg('run-usd', '1'));
  const pool = new AccountPool(ACCOUNTS, runUsd, Number(arg('max-usd', '0.01')));
  const version = claudeVersion();
  const config = { set: SET, n: N, arms: ARMS, model: MODEL, effort: EFFORT, repeats: REPEATS, max_turns: MAX_TURNS, issues: issues.map((i) => i.id), claude_version: version, mock: MOCK, accounts: ACCOUNTS.map(label), system_prompt_sha: sha(SWE_SYSTEM_PROMPT).slice(0, 16), schema_sha: sha(JSON.stringify(ANSWER_SCHEMA)).slice(0, 16) };
  const planFile = path.join(OUT, 'plan.json');
  // Issues in selection order; within an issue, (arm, repeat) in a seeded order.
  const mkPlan = () => issues.flatMap((is) => ARMS.flatMap((a) => Array.from({ length: REPEATS }, (_, r) => ({ run_id: `${is.id}|${a}|r${r + 1}`, issue: is.id, arm: a, repeat: r + 1 })))
    .sort((x, y) => (sha(`20261118|${x.run_id}`) < sha(`20261118|${y.run_id}`) ? -1 : 1)));
  let plan = mkPlan();
  if (fs.existsSync(planFile)) {
    const prev = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    for (const k of ['set', 'arms', 'model', 'effort', 'repeats', 'max_turns', 'issues', 'claude_version', 'system_prompt_sha', 'schema_sha'] as const) if (JSON.stringify(prev.config[k]) !== JSON.stringify((config as any)[k])) throw new Error(`resuming ${RUN} with a different ${k}`);
    plan = prev.items;
  } else fs.writeFileSync(planFile, JSON.stringify({ config, items: plan }, null, 1) + '\n');
  for (const f of ['runs.jsonl', 'excluded.jsonl', 'accounts.jsonl']) if (!fs.existsSync(path.join(OUT, f))) fs.writeFileSync(path.join(OUT, f), '');
  const done = new Set(readJsonl(path.join(OUT, 'runs.jsonl')).map((r) => r.run_id));
  const excl = readJsonl(path.join(OUT, 'excluded.jsonl'));
  // E10-D05: a version-only init mismatch means the installed Claude Code changed under the runner, not that the run
  // failed. A resume runs the plan's version (checked above), so such a run is neither final nor a counted attempt.
  const versionOnly = (e: any) => e.excluded_kind === 'init_mismatch' && /^version \|/.test(String(e.detail ?? ''));
  const counted = (id: string) => excl.filter((e) => e.run_id === id && !isUsageLimitExclusion(e) && e.excluded_kind !== 'aborted' && !versionOnly(e));
  const attempts = (id: string) => counted(id).length;
  // E10-D02: a stalled response (no result event, exit 0) is retried up to 4 attempts in all; any other
  // infrastructure failure is retried once, as pre-registered.
  const canTry = (id: string) => { const c = counted(id); const stalls = c.filter((e) => e.excluded === 'infra_error:no_result').length; return c.length - stalls < 2 && c.length < 4; };
  const finalExcl = new Set(excl.filter((e) => e.retryable === false && !versionOnly(e)).map((e) => e.run_id));
  const pending = (is: Issue) => plan.filter((i) => i.issue === is.id && !done.has(i.run_id) && !finalExcl.has(i.run_id) && canTry(i.run_id));

  installSignalHandlers();
  const children = new Set<ChildProcess>();
  onHarnessAbort(() => { for (const c of children) { try { c.kill('SIGTERM'); } catch { /* */ } } });
  const writeMeta = (status: string, extra: Record<string, unknown> = {}) => fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ run: RUN, status, ...config, run_usd: runUsd, workers: WORKERS, min_free_gb: MIN_FREE_GB, updated: new Date().toISOString(), ...extra }, null, 2) + '\n');
  writeMeta('running');
  let halted: string | null = null, infraStreak = 0;
  const mcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp10-mcp-'));
  const needOurs = ARMS.some(OURS);
  const shared = needOurs ? await startSharedEmbedServer() : null;
  if (shared) log(`shared query embedder ready (${JSON.stringify(shared.info).slice(0, 120)})`);
  fs.mkdirSync(path.join(SCRATCH, 'lists'), { recursive: true });
  await initLanguages();

  const queue = issues.filter((is) => pending(is).length);
  log(`${RUN}: ${queue.length} issue(s) with pending runs, ${plan.length - done.size} run(s) pending, up to ${WORKERS} workers`);

  async function runIssue(is: Issue, w: number) {
    const items = pending(is);
    if (!items.length) return;
    let daemon: Awaited<ReturnType<typeof startDaemon>> | null = null;
    const compDirs: string[] = [];
    let snapRoot: string | null = null;
    try {
      const { root, files, embCache } = snapshot(is);
      snapRoot = root;
      const filesJson = path.join(SCRATCH, 'lists', `${is.id}.json`);
      fs.writeFileSync(filesJson, JSON.stringify(files));
      await initLanguages(grammarLanguages(files)); // grammars before the symbol index
      const index = new SymbolIndex(root, files);
      const task = { task_id: is.id, split: SET, description: is.problem, root_cause_symbols: is.gt, relevant_symbols: is.gt, relevant_files: [...new Set(is.gt.map((k) => k.split('::')[0]))], task_type: 'bug_localisation', repo: is.repo } as GroundTruthTask;
      const key = sha(`${is.repo}|${is.base_commit}|${files.length}`).slice(0, 16);
      const comp: Record<string, { ws: string; spec: McpServerSpec; state: string; build_ms: number }> = {};
      await serialBuild(async () => {
        await initLanguages(grammarLanguages(files));
        if (items.some((i) => OURS(i.arm))) {
          log(`w${w} ${is.id}: graph + daemon (${files.length} files)`);
          const graph = buildGraph(root, filesJson, key);
          daemon = await startDaemon(root, graph, filesJson, embCache, key, shared?.url ?? null);
          children.add(daemon.child);
        }
        for (const arm of [...new Set(items.map((i) => i.arm))].filter((a) => COMPETITOR[a])) {
          const kind = COMPETITOR[arm];
          const ws = makeWorkspace(root, files, `${is.id}|competitor|${kind}`);
          compDirs.push(path.dirname(ws));
          const g = (a: string[]) => { const r = spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@localhost', '-c', 'commit.gpgsign=false', ...a], { cwd: ws, encoding: 'utf8', maxBuffer: 64 << 20 }); if (r.status !== 0) throw new Error(`git ${a[0]}: ${r.stderr}`); return r.stdout; };
          g(['init', '-q']); g(['add', '-A']); g(['commit', '-q', '-m', 'snapshot']);
          const cacheDir = path.join(SCRATCH, 'competitors', key, kind);
          fs.rmSync(cacheDir, { recursive: true, force: true });
          const s = await competitorServerSpec(kind, { taskId: is.id, dir: ws, hash: sha(ws), files, corpus: null as any }, { embeddings: kind === 'crg', cacheDir, graphInWorkspace: true });
          log(`w${w} ${is.id}: ${kind} ready in ${(s.build_ms / 1000).toFixed(0)} s`);
          comp[arm] = { ws, spec: { name: s.name, command: s.command, args: s.args, env: s.env, denyTools: DENY_TOOLS[kind] }, state: g(['status', '--porcelain', '--ignored', '--untracked-files=all']), build_ms: s.build_ms };
        }
      });
      for (const it of items) {
        if (halted) break;
        for (let attempt = attempts(it.run_id) + 1; canTry(it.run_id) && !halted; attempt++) {
          // account: wait while every account is exhausted
          let acctName = pool.current();
          while (!acctName && !halted) { log(`w${w}: all accounts at their limit; waiting 20 min`); await sleep(20 * 60_000); acctName = pool.current(); }
          if (!acctName) break;
          const acct = pool.info(acctName);
          const cp = comp[it.arm];
          const ws = cp ? cp.ws : makeWorkspace(root, files, `${it.run_id}|${attempt}`);
          const safe = it.run_id.replace(/[^A-Za-z0-9_.-]+/g, '_') + (attempt > 1 ? `_try${attempt}` : '');
          const toolLog = path.join(OUT, 'tool-logs', `${safe}.jsonl`);
          const backend = ARM_BACKEND[it.arm];
          const d = daemon as Awaited<ReturnType<typeof startDaemon>> | null;
          const mcp: McpServerSpec | null = cp ? cp.spec : backend ? { name: EXP3_SERVER_NAME, command: abs('node_modules/.bin/tsx'), args: [abs('src/agent-eval/exp3/mcp-tool.ts'), '--port', String(d!.port), '--arm', backend, '--log', toolLog], env: {}, denyTools: [] } : null;
          let mockSrv: Awaited<ReturnType<typeof startMockServer>> | null = null;
          let usageLimited = false;
          try {
            if (MOCK) {
              const [f0, s0] = (is.gt[0] ?? 'x.py::x').split('::');
              const steps: MockStep[] = [...(mcp ? [{ tool: 'mcp:auto', input: { $fill: 'where is this implemented' } } as MockStep] : []), { tool: 'Grep', input: { pattern: s0.split('.').pop()! } }, { structured: { summary: 'mock answer (no model was called)', locations: [{ file: f0, symbol: s0 }] } }];
              // Test hook (mock only): accounts listed in EXP10_MOCK_LIMIT_ACCOUNTS answer with a usage-limit error.
              const limited = (process.env.EXP10_MOCK_LIMIT_ACCOUNTS ?? '').split(',').includes(acctName);
              mockSrv = await startMockServer({ logFile: path.join(OUT, 'transcripts', `${safe}.mock.jsonl`), policy: limited ? { kind: 'fault', status: 429, error_type: 'rate_limit_error', message: 'Claude AI usage limit reached|resets 9pm' } : { kind: 'scripted', steps } });
            }
            const spec = buildClaudeCommand({ protocol: 'agentic', profile: 'restricted-oauth', model: MODEL, cwd: ws, mcp, systemPrompt: SWE_SYSTEM_PROMPT, jsonSchema: ANSWER_SCHEMA, mcpConfigPath: path.join(mcpDir, `${safe}.json`), mockUrl: mockSrv?.url, maxTurns: MAX_TURNS, maxBudgetUsd: runUsd, effort: EFFORT, billing: 'subscription', baseEnv: acct?.env });
            let mismatch: string[] = [];
            const r = await runClaude(spec, sweTaskPrompt(is.problem), { run_id: it.run_id, task_id: is.id, condition: `exp10:${it.arm}`, repeat: it.repeat, model: MODEL, workspace_hash: sha(ws).slice(0, 12) }, {
              guard: pool.guard(acctName), timeoutMs: TIMEOUT_S * 1000, transcriptPath: path.join(OUT, 'transcripts', `${safe}.jsonl`),
              onInit: (init) => { const m = checkInit(init, { mcp, model: MODEL, version, mock: MOCK, billing: 'subscription' }); mismatch = m.details; return m.categories.length ? m.categories.join(',') : null; },
              shouldAbort: () => halted,
            });
            const p = parseStreamJson(r.raw);
            const answer = parseAnswer(p.result?.structured_output ?? p.lastStructured ?? null);
            const oc = r.outcome;
            if (oc.status === 'infra_error' || oc.status === 'init_mismatch' || oc.status === 'aborted') {
              const ex = { run_id: it.run_id, issue: is.id, arm: it.arm, attempt, account: label(acctName), excluded: oc.status === 'infra_error' ? `infra_error:${oc.infra_kind}` : oc.status, excluded_kind: oc.status, retryable: oc.status !== 'init_mismatch', detail: [oc.reason, ...mismatch, oc.text].filter(Boolean).join(' | ').slice(0, 600), cost_ledger_usd: r.cost.ledger };
              append('excluded.jsonl', ex); excl.push(ex);
              if (oc.infra_kind === 'limit') { pool.exhausted(acctName, oc.text ?? oc.reason ?? 'limit'); usageLimited = true; attempt--; continue; } // retry on the next account; not an attempt
              log(`w${w} ${it.run_id} EXCLUDED ${ex.excluded} ${ex.detail.slice(0, 160)}`);
              if (oc.infra_kind === 'auth') { halted = `auth (${label(acctName)}): ${(oc.text ?? oc.reason ?? '').slice(0, 200)}`; break; }
              if (oc.status === 'init_mismatch') { halted = `init mismatch: ${mismatch.join('; ')}`; break; }
              if (oc.status !== 'aborted' && ++infraStreak >= 3 * WORKERS) { halted = 'repeated infrastructure errors'; break; }
              continue;
            }
            infraStreak = 0;
            const score = scoreAnswer(index, task, answer);
            const tl = readJsonl(toolLog);
            const u = r.run.usage;
            const rec = {
              run_id: it.run_id, issue: is.id, bench: is.bench, repo: is.repo, arm: it.arm, backend, repeat: it.repeat, attempt, model: MODEL, effort: EFFORT, set: SET,
              account: pool.record(acctName), worker: w, status: answer ? 'submitted' : oc.status, turns: r.run.turns, tool_calls: r.run.tool_calls, retrieval_calls: r.run.retrieval_calls,
              usage: u, total_tokens: u ? u.input + u.output + u.cache_read + u.cache_write : null,
              cost_reported_usd: r.cost.reported, cost_list_usd: r.cost.list, cost_ledger_usd: r.cost.ledger, wall_ms: r.timing.wall_ms, api_ms: r.detail.duration_api_ms,
              tool_log: { calls: tl.length, result_tokens: tl.reduce((s, x) => s + (x.result_tokens ?? 0), 0), errors: tl.filter((x) => x.error).length, latency_ms: tl.reduce((s, x) => s + (x.latency_ms ?? 0), 0) },
              files_read: new Set(p.toolCalls.filter((c) => c.name === 'Read').map((c) => String(c.input?.file_path ?? ''))).size,
              answer, score, claude_version: version, mock: MOCK, index_build_ms: cp?.build_ms ?? null, corpus_files: files.length, gt_size: is.gt.length,
              mcp_calls: p.toolCalls.filter((c) => c.name.startsWith('mcp__')).map((c) => c.name.split('__').pop()),
              mcp_result_chars: (() => { const ids = new Set(p.toolCalls.filter((c) => c.name.startsWith('mcp__')).map((c) => c.id)); return p.toolResults.filter((x) => ids.has(x.tool_use_id)).reduce((a, x) => a + x.text.length, 0); })(),
            };
            append('runs.jsonl', rec); done.add(it.run_id);
            log(`w${w} ${it.run_id} [${acctName}] ${rec.status} turns=${rec.turns} tok=${rec.total_tokens} score=${score.task_score.toFixed(2)}`);
            break;
          } catch (e) {
            if (e instanceof BillableRefused) { halted = e.message; break; }
            const ex = { run_id: it.run_id, issue: is.id, arm: it.arm, attempt, account: label(acctName), excluded: 'infra_error:harness', excluded_kind: 'infra_error', retryable: true, detail: String((e as Error).stack ?? e).slice(0, 600) };
            append('excluded.jsonl', ex); excl.push(ex);
            log(`w${w} ${it.run_id} harness error: ${(e as Error).message}`);
            if (++infraStreak >= 3 * WORKERS) { halted = 'repeated infrastructure errors'; break; }
          } finally {
            await mockSrv?.close();
            if (cp) {
              const nowState = spawnSync('git', ['status', '--porcelain', '--ignored', '--untracked-files=all'], { cwd: ws, encoding: 'utf8', maxBuffer: 64 << 20 }).stdout;
              if (nowState !== cp.state) { halted = `competitor workspace modified during ${it.run_id}`; log(halted); }
            } else fs.rmSync(path.dirname(ws), { recursive: true, force: true });
          }
          if (usageLimited) continue;
        }
      }
    } catch (e) {
      log(`w${w} ${is.id}: setup failed: ${(e as Error).message.slice(0, 300)}`);
      append('excluded.jsonl', { run_id: `${is.id}|setup`, issue: is.id, excluded: 'infra_error:setup', excluded_kind: 'infra_error', retryable: true, detail: String((e as Error).message).slice(0, 600) });
    } finally {
      const d = daemon as Awaited<ReturnType<typeof startDaemon>> | null;
      if (d) { d.child.kill('SIGTERM'); children.delete(d.child); await sleep(1500); }
      for (const dir of compDirs) fs.rmSync(dir, { recursive: true, force: true });
      if (snapRoot) fs.rmSync(snapRoot, { recursive: true, force: true });
    }
  }

  // worker pool: a worker takes the next issue only while enough memory is free
  let next = 0;
  const worker = async (w: number) => {
    await sleep(w * 15_000); // stagger the first builds
    while (!halted && next < queue.length) {
      while (memFreeGb() < MIN_FREE_GB && !halted) { await sleep(30_000); }
      if (halted || next >= queue.length) break;
      const is = queue[next++];
      await runIssue(is, w);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, WORKERS) }, (_, i) => worker(i + 1)));
  await shared?.close();
  fs.rmSync(mcpDir, { recursive: true, force: true });
  const runs = readJsonl(path.join(OUT, 'runs.jsonl'));
  writeMeta(halted ? 'halted' : runs.length >= plan.length ? 'completed' : 'incomplete', { halted, n_plan: plan.length, n_scored: runs.length, ledger_usd: runs.reduce((s, r) => s + (r.cost_ledger_usd ?? 0), 0) });
  log(`${halted ? `HALTED: ${halted}` : 'finished'}: ${runs.length}/${plan.length} scored`);
  if (halted) process.exitCode = 3;
}
main().catch((e) => { console.error(e); process.exit(1); });
