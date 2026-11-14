#!/usr/bin/env tsx
/**
 * Experiment 3 agent stage (milestone 3). Claude Code headless on frozen dataset-v2 tasks, with experiment 2's backend:
 * restricted-oauth isolation, account binding, approval + spend ledger, usage-limit halts, init fingerprint, mock API.
 *
 *   npx tsx scripts/exp3/agent.ts --repo M|L --split dev|test --arms A0,A1,A2 --model claude-haiku-5-5 --repeats 3 \
 *       --run <id> [--account personal --run-usd 1 --max-usd 150] [--mock] [--only id,id] [--timeout-s 900]
 *
 * Arms (identical system and task prompts):
 *   A0 baseline         Read, Grep, Glob
 *   A1 compact_nograph  + find_relevant_code backed by hybrid WITHOUT graph propagation, pointer output, 800-token cap
 *   A2 compact_graph    + find_relevant_code backed by hybrid WITH graph propagation + relationship lines, same cap
 *   A5 graphify         + graphify's own MCP server (latest release, AST graph, its default tools minus write tools)
 *   A6 crg              + code-review-graph's own MCP server (latest release) WITH its local embeddings (its strongest
 *                         documented setup: semantic search = FTS5 + vectors), write tools denied
 * Competitor arms get one git-initialised copy of the snapshot per task (CRG indexes `git ls-files`); their graph is built
 * once per task and reused across repeats; the copy is checked unchanged after every run.
 * A1/A2 tool name, description and schema are byte-identical. Runs are executed task by task (the task's snapshot is
 * materialised once and one retrieval daemon serves both arms); the order of (arm, repeat) within a task is seeded.
 * Output under experiments/03-graph-scale/results/agent/<run>/: plan.json, runs.jsonl, excluded.jsonl, ledger.jsonl,
 * transcripts/, tool-logs/, meta.json. Resumable.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { abs, listCorpusFiles } from '../../src/config.js';
import { loadTasks } from '../../src/evaluation/ground-truth.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import type { GroundTruthTask } from '../../src/types.js';
import {
  BillableGuard, BillableRefused, EXPECTED_MCP_TOOLS, buildClaudeCommand, checkInit, installSignalHandlers, isUsageLimitExclusion,
  onHarnessAbort, parseStreamJson, runClaude, usageCost, type McpServerSpec,
} from '../../src/agent-eval/backends/claude-code.js';
import { bindAccount, claudeVersion } from '../../src/agent-eval/agentic.js';
import { accountRecord } from '../../src/agent-eval/account.js';
import { startMockServer, type MockStep } from '../../src/agent-eval/mock-anthropic/server.js';
import { opaqueId, WORK_ROOT } from '../../src/agent-eval/workspace.js';
import { ANSWER_SCHEMA, EXP3_SYSTEM_PROMPT, exp3TaskPrompt, parseAnswer, scoreAnswer } from '../../src/agent-eval/exp3/score.js';
import { EXP3_SERVER_NAME, EXP3_TOOL_NAME } from '../../src/agent-eval/exp3/mcp-tool.js';
import { materialise, REPOS, type RepoName } from './tasks.js';
import { competitorServerSpec } from '../../src/agent-eval/mcp/competitor-servers.js';
import { DENY_TOOLS } from '../../src/agent-eval/agentic.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (n: string) => process.argv.includes(`--${n}`);
const REPO = arg('repo') as 'M' | 'L';
const repoName: RepoName = REPO === 'M' ? 'immich' : 'twenty';
const SPLIT = arg('split', 'test')!;
const ARMS = arg('arms', 'A0,A1,A2')!.split(',');
const MODEL = arg('model', 'claude-haiku-5-5')!;
const EFFORT = arg('effort', 'high')!;
const REPEATS = Number(arg('repeats', '1'));
const RUN = arg('run')!;
const MOCK = flag('mock');
const ONLY = arg('only')?.split(',');
const TIMEOUT_S = Number(arg('timeout-s', '900'));
const MAX_TURNS = 40;
const ARM_BACKEND: Record<string, string | null> = { A0: null, A1: 'compact_nograph', A2: 'compact_graph', A5: 'graphify', A6: 'crg' };
const COMPETITOR: Record<string, 'graphify' | 'crg'> = { A5: 'graphify', A6: 'crg' };
const OURS = (arm: string) => arm === 'A1' || arm === 'A2';
const EXP = abs('experiments/03-graph-scale');
const OUT = path.join(EXP, 'results', 'agent', RUN);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const R = REPOS[repoName];
EXPECTED_MCP_TOOLS[EXP3_SERVER_NAME] = [EXP3_TOOL_NAME]; // init-fingerprint expectation for the experiment-3 tool

const readJsonl = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const append = (f: string, o: unknown) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n');
const log = (s: string) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

function assertClean() {
  const r = spawnSync('git', ['status', '--porcelain', '--', R.src], { cwd: abs(R.root), encoding: 'utf8' });
  if (r.status !== 0 || r.stdout.trim()) throw new Error(`snapshot ${R.root} is not clean — refusing to run`);
}

/** Seeded order of (arm, repeat) within each task; tasks in id order. */
function makePlan(tasks: GroundTruthTask[]) {
  const items: { run_id: string; task_id: string; arm: string; repeat: number }[] = [];
  for (const t of tasks) {
    const xs = ARMS.flatMap((a) => Array.from({ length: REPEATS }, (_, r) => ({ run_id: `${t.task_id}|${a}|r${r + 1}`, task_id: t.task_id, arm: a, repeat: r + 1 })));
    xs.sort((a, b) => (sha(`20261114|${a.run_id}`) < sha(`20261114|${b.run_id}`) ? -1 : 1));
    items.push(...xs);
  }
  return items;
}

function graphFor(snapCommit: string, root: string): string {
  const stage1 = abs(`.cache/exp3/stage1/${REPO}/graphs/${snapCommit}/graph.sqlite`);
  if (fs.existsSync(stage1)) return stage1;
  const dir = abs(`.cache/exp3/agent/graphs/${snapCommit}`);
  const f = path.join(dir, 'graph.sqlite');
  if (fs.existsSync(f)) return f;
  fs.mkdirSync(dir, { recursive: true });
  log(`building graph for snapshot ${snapCommit}`);
  const r = spawnSync('npx', ['tsx', abs('src/graph/build-cli.ts'), '--repo', root, '--out', dir, '--include', 'src', '--max-package-decl-mb', REPO === 'L' ? '0' : '50', '--no-json'], { cwd: abs('.'), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=7000' }, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`graph build failed: ${(r.stderr ?? '').slice(-500)}`);
  return f;
}

async function startDaemon(root: string, graph: string, snapCommit: string): Promise<{ port: number; child: ChildProcess; info: any }> {
  const child = spawn(abs('node_modules/.bin/tsx'), [abs('src/agent-eval/exp3/daemon.ts'), '--root', root, '--graph', graph, '--emb-cache', abs(`.cache/exp3/embeddings-${REPO}`), '--cache', abs(`.cache/exp3/agent/daemon/${snapCommit}`)], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=9000', HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false' },
  });
  let errTail = '';
  child.stderr!.on('data', (d) => { errTail = (errTail + d).slice(-2000); });
  const info = await new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`daemon start timeout: ${errTail}`)), 20 * 60_000);
    readline.createInterface({ input: child.stdout! }).on('line', (l) => { try { const j = JSON.parse(l); if (j.ready) { clearTimeout(t); resolve(j); } } catch { /* */ } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error(`daemon exited (${c}): ${errTail}`)); });
  });
  return { port: info.port, child, info };
}

/** Isolated workspace: the snapshot's corpus files only (no .git, no node_modules, no ground truth). */
function makeWorkspace(root: string, files: string[], runId: string): string {
  const parent = path.join(WORK_ROOT, opaqueId(runId, RUN));
  const dir = path.join(parent, 'app');
  fs.rmSync(parent, { recursive: true, force: true });
  for (const f of [...files, 'package.json', 'tsconfig.json']) {
    const src = path.join(root, f);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(src, path.join(dir, f));
  }
  return dir;
}

async function main() {
  if (!REPO || !RUN || !['M', 'L'].includes(REPO)) throw new Error('usage: agent.ts --repo M|L --split dev|test --run <id> ...');
  for (const a of ARMS) if (!(a in ARM_BACKEND)) throw new Error(`unknown arm ${a}`);
  fs.mkdirSync(path.join(OUT, 'transcripts'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'tool-logs'), { recursive: true });
  const tasks = loadTasks(abs(`experiments/03-graph-scale/dataset/v2/${repoName}`)).filter((t) => t.split === SPLIT && (!ONLY || ONLY.includes(t.task_id)));
  const acct = bindAccount({ account: arg('account'), billing: 'subscription', mock: MOCK });
  const runUsd = Number(arg('run-usd', '1'));
  const guard = new BillableGuard({ protocol: 'agentic', conditions: ARMS, model: MODEL, split: SPLIT, max_total_usd: Number(arg('max-usd', '0.01')), billing: 'subscription', account: arg('account') },
    { runUsd, approvalPath: path.join(EXP, 'APPROVAL.json'), ledgerPath: path.join(EXP, 'spend-ledger.jsonl') });
  if (!MOCK) guard.assertAllowed({}, false);
  const version = claudeVersion();
  const config = { repo: REPO, split: SPLIT, arms: ARMS, model: MODEL, effort: EFFORT, repeats: REPEATS, max_turns: MAX_TURNS, tasks: tasks.map((t) => t.task_id), claude_version: version, mock: MOCK, account: acct ? accountRecord(acct) : null, system_prompt_sha: sha(EXP3_SYSTEM_PROMPT).slice(0, 16), schema_sha: sha(JSON.stringify(ANSWER_SCHEMA)).slice(0, 16) };
  const planFile = path.join(OUT, 'plan.json');
  let plan = makePlan(tasks);
  if (fs.existsSync(planFile)) {
    const prev = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    for (const k of Object.keys(config)) if (JSON.stringify(prev.config[k]) !== JSON.stringify((config as any)[k])) throw new Error(`resuming ${RUN} with a different ${k}`);
    plan = prev.items;
  } else fs.writeFileSync(planFile, JSON.stringify({ config, items: plan }, null, 1) + '\n');
  for (const f of ['runs.jsonl', 'excluded.jsonl']) if (!fs.existsSync(path.join(OUT, f))) fs.writeFileSync(path.join(OUT, f), '');
  const done = new Set(readJsonl(path.join(OUT, 'runs.jsonl')).map((r) => r.run_id));
  const excl = readJsonl(path.join(OUT, 'excluded.jsonl'));
  const attempts = (id: string) => excl.filter((e) => e.run_id === id && !isUsageLimitExclusion(e) && e.excluded_kind !== 'aborted').length;
  const finalExcl = new Set(excl.filter((e) => e.retryable === false).map((e) => e.run_id));
  installSignalHandlers();
  let restoreCurrent: (() => void) | null = null;
  let daemonChild: ChildProcess | null = null;
  onHarnessAbort(() => { try { daemonChild?.kill('SIGTERM'); } catch { /* */ } try { restoreCurrent?.(); } catch { /* */ } });
  const writeMeta = (status: string, extra: Record<string, unknown> = {}) => fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ run: RUN, status, ...config, run_usd: runUsd, updated: new Date().toISOString(), ...extra }, null, 2) + '\n');
  writeMeta('running');
  let halted: string | null = null, infraStreak = 0;
  const mcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp3-mcp-'));

  for (const t of tasks) {
    const items = plan.filter((i) => i.task_id === t.task_id && !done.has(i.run_id) && !finalExcl.has(i.run_id) && attempts(i.run_id) < 2);
    if (!items.length || halted) continue;
    assertClean();
    const snap = t.snapshot!;
    const restore = snap.kind === 'revert_fix' ? materialise(repoName, snap.patch!, snap.apply ?? 'exact') : () => {};
    restoreCurrent = restore;
    let daemon: Awaited<ReturnType<typeof startDaemon>> | null = null;
    const compDirs: string[] = [];
    try {
      const root = abs(R.corpusRoot);
      const files = listCorpusFiles(root, ['src']);
      const snapCommit = sha(`${R.pinned}|${snap.patch_sha256 ?? 'pinned'}`).slice(0, 16);
      const index = new SymbolIndex(root, files);
      if (items.some((i) => OURS(i.arm))) {
        const graph = graphFor(snapCommit, root);
        log(`${t.task_id}: starting retrieval daemon`);
        daemon = await startDaemon(root, graph, snapCommit);
        daemonChild = daemon.child;
        log(`${t.task_id}: daemon ready in ${(daemon.info.prepare_ms / 1000).toFixed(0)} s (${daemon.info.rss_mb} MB)`);
      }
      const comp: Record<string, { ws: string; spec: McpServerSpec; state: string; build_ms: number }> = {};
      for (const arm of [...new Set(items.map((i) => i.arm))].filter((a) => COMPETITOR[a])) {
        const kind = COMPETITOR[arm];
        const ws = makeWorkspace(root, files, `${t.task_id}|competitor|${kind}`);
        compDirs.push(path.dirname(ws));
        const g = (a: string[]) => { const r = spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@localhost', '-c', 'commit.gpgsign=false', ...a], { cwd: ws, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a[0]}: ${r.stderr}`); return r.stdout; };
        g(['init', '-q']); g(['add', '-A']); g(['commit', '-q', '-m', 'snapshot']);
        const cacheDir = abs(`.cache/exp3/agent/competitors/${REPO}/${snapCommit}/${kind}`);
        fs.rmSync(cacheDir, { recursive: true, force: true });
        log(`${t.task_id}: building ${kind} graph`);
        const s = await competitorServerSpec(kind, { taskId: t.task_id, dir: ws, hash: sha(ws), files, corpus: null as any }, { embeddings: kind === 'crg', cacheDir, graphInWorkspace: true });
        log(`${t.task_id}: ${kind} ready in ${(s.build_ms / 1000).toFixed(0)} s`);
        comp[arm] = { ws, spec: { name: s.name, command: s.command, args: s.args, env: s.env, denyTools: DENY_TOOLS[kind] }, state: g(['status', '--porcelain', '--ignored', '--untracked-files=all']), build_ms: s.build_ms };
      }
      for (const it of items) {
        if (halted) break;
        for (let attempt = attempts(it.run_id) + 1; attempt <= 2; attempt++) {
          const cp = comp[it.arm];
          const ws = cp ? cp.ws : makeWorkspace(root, files, `${it.run_id}|${attempt}`);
          const safe = it.run_id.replace(/[^A-Za-z0-9_.-]+/g, '_') + (attempt > 1 ? `_try${attempt}` : '');
          const toolLog = path.join(OUT, 'tool-logs', `${safe}.jsonl`);
          const backend = ARM_BACKEND[it.arm];
          const mcp: McpServerSpec | null = cp ? cp.spec : backend ? { name: EXP3_SERVER_NAME, command: abs('node_modules/.bin/tsx'), args: [abs('src/agent-eval/exp3/mcp-tool.ts'), '--port', String(daemon!.port), '--arm', backend, '--log', toolLog], env: {}, denyTools: [] } : null;
          let mockSrv: Awaited<ReturnType<typeof startMockServer>> | null = null;
          try {
            if (MOCK) {
              const [f0, s0] = (t.relevant_symbols[0] ?? 'src/x.ts::x').split('::');
              const steps: MockStep[] = [...(mcp ? [{ tool: 'mcp:auto', input: { $fill: 'where is this implemented' } } as MockStep] : []), { tool: 'Grep', input: { pattern: s0.split('.').pop()! } }, { structured: { summary: 'mock answer (no model was called)', locations: [{ file: f0, symbol: s0 }] } }];
              mockSrv = await startMockServer({ logFile: path.join(OUT, 'transcripts', `${safe}.mock.jsonl`), policy: { kind: 'scripted', steps } });
            }
            const spec = buildClaudeCommand({ protocol: 'agentic', profile: 'restricted-oauth', model: MODEL, cwd: ws, mcp, systemPrompt: EXP3_SYSTEM_PROMPT, jsonSchema: ANSWER_SCHEMA, mcpConfigPath: path.join(mcpDir, `${safe}.json`), mockUrl: mockSrv?.url, maxTurns: MAX_TURNS, maxBudgetUsd: runUsd, effort: EFFORT, billing: 'subscription', baseEnv: acct?.env });
            let mismatch: string[] = [];
            const r = await runClaude(spec, exp3TaskPrompt(t), { run_id: it.run_id, task_id: t.task_id, condition: `exp3:${it.arm}`, repeat: it.repeat, model: MODEL, workspace_hash: sha(ws).slice(0, 12) }, {
              guard, timeoutMs: TIMEOUT_S * 1000, transcriptPath: path.join(OUT, 'transcripts', `${safe}.jsonl`),
              onInit: (init) => { const m = checkInit(init, { mcp, model: MODEL, version, mock: MOCK, billing: 'subscription' }); mismatch = m.details; return m.categories.length ? m.categories.join(',') : null; },
              shouldAbort: () => halted,
            });
            const p = parseStreamJson(r.raw);
            const answer = parseAnswer(p.result?.structured_output ?? p.lastStructured ?? null);
            const oc = r.outcome;
            const infra = oc.status === 'infra_error' || oc.status === 'init_mismatch' || oc.status === 'aborted';
            if (infra) {
              const ex = { run_id: it.run_id, task_id: t.task_id, arm: it.arm, attempt, excluded: oc.status === 'infra_error' ? `infra_error:${oc.infra_kind}` : oc.status, excluded_kind: oc.status, retryable: oc.status !== 'init_mismatch', detail: [oc.reason, ...mismatch, oc.text].filter(Boolean).join(' | ').slice(0, 600), cost_ledger_usd: r.cost.ledger };
              append('excluded.jsonl', ex); excl.push(ex);
              log(`${it.run_id} EXCLUDED ${ex.excluded} ${ex.detail.slice(0, 160)}`);
              if (oc.infra_kind === 'limit' || oc.infra_kind === 'auth') { halted = `${oc.infra_kind}: ${(oc.text ?? oc.reason ?? '').slice(0, 200)}`; break; }
              if (oc.status === 'init_mismatch') { halted = `init mismatch: ${mismatch.join('; ')}`; break; }
              if (oc.status !== 'aborted' && ++infraStreak >= 3) { halted = '3 consecutive infrastructure errors'; break; }
              continue;
            }
            infraStreak = 0;
            const score = scoreAnswer(index, t, answer);
            const tl = readJsonl(toolLog);
            const status = answer ? 'submitted' : oc.status;
            const u = r.run.usage;
            const rec = {
              run_id: it.run_id, task_id: t.task_id, arm: it.arm, backend, repeat: it.repeat, attempt, model: MODEL, effort: EFFORT, repo: REPO, split: SPLIT,
              task_type: t.task_type, strata: t.strata, status, turns: r.run.turns, tool_calls: r.run.tool_calls, retrieval_calls: r.run.retrieval_calls,
              usage: u, total_tokens: u ? u.input + u.output + u.cache_read + u.cache_write : null,
              cost_reported_usd: r.cost.reported, cost_list_usd: r.cost.list, cost_ledger_usd: r.cost.ledger, wall_ms: r.timing.wall_ms, api_ms: r.detail.duration_api_ms,
              tool_log: { calls: tl.length, result_tokens: tl.reduce((s, x) => s + (x.result_tokens ?? 0), 0), errors: tl.filter((x) => x.error).length, latency_ms: tl.reduce((s, x) => s + (x.latency_ms ?? 0), 0) },
              files_read: new Set(p.toolCalls.filter((c) => c.name === 'Read').map((c) => String(c.input?.file_path ?? ''))).size,
              answer, score, claude_version: version, mock: MOCK, index_build_ms: cp?.build_ms ?? null,
              mcp_calls: p.toolCalls.filter((c) => c.name.startsWith('mcp__')).map((c) => c.name.split('__').pop()),
              mcp_result_chars: (() => { const ids = new Set(p.toolCalls.filter((c) => c.name.startsWith('mcp__')).map((c) => c.id)); return p.toolResults.filter((x) => ids.has(x.tool_use_id)).reduce((a, x) => a + x.text.length, 0); })(),
            };
            append('runs.jsonl', rec); done.add(it.run_id);
            log(`${it.run_id} ${status} turns=${rec.turns} tok=${rec.total_tokens} $${r.cost.ledger.toFixed(4)} tool_calls=${rec.retrieval_calls} score=${score.task_score.toFixed(2)}`);
            break;
          } catch (e) {
            if (e instanceof BillableRefused) { halted = e.message; break; }
            const ex = { run_id: it.run_id, task_id: t.task_id, arm: it.arm, attempt, excluded: 'infra_error:harness', excluded_kind: 'infra_error', retryable: true, detail: String((e as Error).stack ?? e).slice(0, 600) };
            append('excluded.jsonl', ex); excl.push(ex);
            log(`${it.run_id} harness error: ${(e as Error).message}`);
            if (++infraStreak >= 3) { halted = '3 consecutive infrastructure errors'; break; }
          } finally {
            await mockSrv?.close();
            if (cp) {
              const now = spawnSync('git', ['status', '--porcelain', '--ignored', '--untracked-files=all'], { cwd: ws, encoding: 'utf8' }).stdout;
              if (now !== cp.state) { halted = `competitor workspace modified during ${it.run_id}`; log(halted); }
            } else fs.rmSync(path.dirname(ws), { recursive: true, force: true });
          }
        }
      }
    } finally {
      if (daemon) { daemon.child.kill('SIGTERM'); daemonChild = null; await new Promise((r) => setTimeout(r, 1500)); }
      for (const d of compDirs) fs.rmSync(d, { recursive: true, force: true });
      restore(); restoreCurrent = null;
    }
  }
  fs.rmSync(mcpDir, { recursive: true, force: true });
  const runs = readJsonl(path.join(OUT, 'runs.jsonl'));
  writeMeta(halted ? 'halted' : runs.length >= plan.length ? 'completed' : 'incomplete', { halted, n_plan: plan.length, n_scored: runs.length, ledger_usd: runs.reduce((s, r) => s + (r.cost_ledger_usd ?? 0), 0) });
  log(`${halted ? `HALTED: ${halted}` : 'finished'} — ${runs.length}/${plan.length} scored`);
  if (halted) process.exitCode = 3;
}
main().catch((e) => { console.error(e); process.exit(1); });
