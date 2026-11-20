#!/usr/bin/env tsx
/**
 * Experiment 11, T3: key facts (once, before any run) and judging of the agents' answers (after the runs).
 *
 *   npx tsx scripts/exp11/judge.ts keyfacts --set pilot|main [--n N] --account <login> [--mock]
 *       -> experiments/11-vendor-setups/data/t3-keyfacts.jsonl (frozen; a random 10% is checked by hand)
 *   npx tsx scripts/exp11/judge.ts score --run <id> --account <login> [--mock]
 *       -> results/<id>/judged.jsonl: key-fact coverage (primary) and SWE-QA's rubric (secondary) per run;
 *          a seeded 10% of runs is judged a second time for the agreement report.
 *
 * Judge: Claude Sonnet 5.5, single-shot, no tools, never told the arm. Resumable (finished calls are kept).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { abs } from '../../src/config.js';
import os from 'node:os';
import { BillableGuard, BillableRefused, buildClaudeCommand, checkInit, parseStreamJson, runClaude } from '../../src/agent-eval/backends/claude-code.js';
import { bindAccount, claudeVersion } from '../../src/agent-eval/agentic.js';
import { startMockServer } from '../../src/agent-eval/mock-anthropic/server.js';
import { COVERAGE, COVERAGE_SCHEMA, JUDGE_SYSTEM, KEY_FACTS, KEY_FACTS_SCHEMA, SWEQA_RUBRIC, SWEQA_RUBRIC_SCHEMA } from './judge-prompts.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const MODE = process.argv[2];
const MOCK = process.argv.includes('--mock');
const JUDGE_MODEL = 'claude-sonnet-5-5';
const CLAUDE_BIN = process.env.AGENT_EVAL_CLAUDE_BIN ?? path.join(os.homedir(), 'dev/backups/claude-code-pinned/bin/claude');
const EXP = abs('experiments/11-vendor-setups');
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const readJsonl = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function question(qid: string): { question: string; answer: string } {
  const [name, idx] = qid.split('#');
  return fs.readFileSync(abs(`.cache/exp11/sweqa/${name}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))[Number(idx)];
}

/**
 * One single-shot call per item (no tools, structured output), as experiment 2's single-shot runs but with any schema.
 * Finished calls are kept in <workDir>/calls.jsonl, so a rerun resumes. Returns id -> structured output (or null).
 */
async function runAll(items: { id: string; prompt: string }[], schema: object, workDir: string, mockReply: unknown): Promise<Map<string, unknown>> {
  fs.mkdirSync(workDir, { recursive: true });
  const cacheFile = path.join(workDir, 'calls.jsonl');
  const out = new Map<string, unknown>(readJsonl(cacheFile).filter((r) => r.raw != null).map((r) => [r.id, r.raw]));
  const todo = items.filter((i) => !out.has(i.id));
  if (!todo.length) return out;
  const account = arg('account');
  if (!MOCK && !account) throw new Error('--account <login> is required');
  const acct = MOCK ? null : bindAccount({ account, billing: 'subscription', mock: false });
  const mock = MOCK ? await startMockServer({ logFile: path.join(workDir, 'mock.jsonl'), policy: { kind: 'echo-structured', diagnosis: mockReply } }) : null;
  const guard = new BillableGuard({ protocol: 'single_shot', conditions: ['judge'], model: JUDGE_MODEL, split: 't3-judge', max_total_usd: Number(arg('max-usd', '0.01')), billing: 'subscription', account },
    { runUsd: 0.5, approvalPath: path.join(EXP, 'APPROVAL.json'), ledgerPath: path.join(EXP, 'spend-ledger.jsonl') });
  if (!MOCK) guard.assertAllowed({}, false);
  const version = claudeVersion(CLAUDE_BIN);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'exp11-judge-'));
  let next = 0, failures = 0, halted: string | null = null;
  const worker = async () => {
    while (next < todo.length && !halted) {
      const it = todo[next++];
      const spec = buildClaudeCommand({ protocol: 'single_shot', profile: 'restricted-oauth', model: JUDGE_MODEL, cwd: scratch, systemPrompt: JUDGE_SYSTEM, jsonSchema: schema, mockUrl: mock?.url,
        mcpConfigPath: path.join(scratch, 'empty-mcp.json'), maxTurns: 3, effort: 'high', billing: 'subscription', baseEnv: acct?.env, maxBudgetUsd: 0.5, claudeBin: CLAUDE_BIN });
      try {
        const r = await runClaude(spec, it.prompt, { run_id: it.id, task_id: it.id, condition: 'exp11:judge', repeat: 0, model: JUDGE_MODEL, workspace_hash: '' }, {
          guard, timeoutMs: 300_000,
          onInit: (init) => { const m = checkInit(init, { mcp: null, model: JUDGE_MODEL, version, mock: MOCK, billing: 'subscription', protocol: 'single_shot' }); return m.categories.length ? m.categories.join(',') : null; },
        });
        const ps = parseStreamJson(r.raw);
        const raw = ps.result?.structured_output ?? ps.lastStructured ?? null;
        if (r.outcome.status === 'infra_error' && r.outcome.infra_kind === 'limit') { halted = `usage limit: ${r.outcome.text ?? ''}`.slice(0, 200); break; }
        if (r.outcome.status === 'init_mismatch' || r.outcome.infra_kind === 'auth') { halted = `${r.outcome.status}: ${r.outcome.reason ?? ''}`; break; }
        fs.appendFileSync(cacheFile, JSON.stringify({ id: it.id, raw, status: raw != null ? 'answered' : r.outcome.status, cost_list_usd: r.cost.list, mock: MOCK }) + '\n');
        if (raw != null) { out.set(it.id, raw); failures = 0; } else if (++failures >= 5) halted = 'five calls in a row without an answer';
      } catch (e) { if (e instanceof BillableRefused) { halted = e.message; break; } if (++failures >= 5) halted = String((e as Error).message).slice(0, 200); }
    }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', '3')) }, worker));
  await mock?.close();
  fs.rmSync(scratch, { recursive: true, force: true });
  if (halted) console.error(`judge halted: ${halted}`);
  return out;
}

async function keyfacts() {
  const set = arg('set', 'pilot')!;
  const sel = JSON.parse(fs.readFileSync(path.join(EXP, 'data', 't3-selection.json'), 'utf8'));
  let ids: string[] = sel[set];
  if (arg('n')) ids = ids.slice(0, Number(arg('n')));
  const out = path.join(EXP, 'data', 't3-keyfacts.jsonl');
  const have = new Set(readJsonl(out).map((r) => r.qid));
  const todo = ids.filter((q) => !have.has(q));
  if (!todo.length) { console.error('all key facts present'); return; }
  const work = abs(`.cache/exp11/judge/keyfacts-${MOCK ? 'mock' : 'real'}`);
  const res = await runAll(todo.map((qid) => { const q = question(qid); return { id: qid, prompt: KEY_FACTS(q.question, q.answer) }; }), KEY_FACTS_SCHEMA, work, { facts: ['mock fact one', 'mock fact two', 'mock fact three'] });
  for (const qid of todo) {
    const facts = (res.get(qid) as any)?.facts;
    if (!Array.isArray(facts) || !facts.length) { console.error(`${qid}: no facts`); continue; }
    if (MOCK) continue; // mock answers are never written to the frozen file
    fs.appendFileSync(out, JSON.stringify({ qid, facts, prompt_sha: sha(KEY_FACTS('', '')).slice(0, 12), model: JUDGE_MODEL }) + '\n');
  }
  console.error(`key facts: ${readJsonl(out).length} questions frozen`);
}

async function score() {
  const run = arg('run')!;
  const dir = path.join(EXP, 'results', run);
  const runs = readJsonl(path.join(dir, 'runs.jsonl')).filter((r) => r.task === 'T3');
  const facts = new Map(readJsonl(path.join(EXP, 'data', 't3-keyfacts.jsonl')).map((r) => [r.qid, r.facts as string[]]));
  const out = path.join(dir, 'judged.jsonl');
  const have = new Set(readJsonl(out).map((r) => `${r.run_id}|${r.pass}`));
  // A seeded 10% of runs is judged twice (pass 2), for the agreement report.
  const second = (id: string) => parseInt(sha(`20261120|${id}`).slice(0, 8), 16) % 10 === 0;
  const jobs = runs.flatMap((r) => [1, ...(second(r.run_id) ? [2] : [])].map((pass) => ({ r, pass }))).filter(({ r, pass }) => !have.has(`${r.run_id}|${pass}`));
  const missing = jobs.filter(({ r }) => !facts.has(r.item));
  if (missing.length) throw new Error(`no frozen key facts for ${[...new Set(missing.map(({ r }) => r.item))].join(', ')}`);
  const work = abs(`.cache/exp11/judge/${run}`);
  const answerOf = (r: any) => r.answer?.answer ?? '';
  // Coverage calls (one schema per fact count) and rubric calls.
  const byN = new Map<number, typeof jobs>();
  for (const j of jobs) { const n = facts.get(j.r.item)!.length; byN.set(n, [...(byN.get(n) ?? []), j]); }
  const cov = new Map<string, unknown>();
  for (const [n, js] of byN) {
    const res = await runAll(js.map(({ r, pass }) => ({ id: `${r.run_id}|coverage|${pass}`, prompt: COVERAGE(question(r.item).question, facts.get(r.item)!, answerOf(r) || '(no answer)') })), COVERAGE_SCHEMA(n), path.join(work, `cov${n}`), { covered: Array.from({ length: n }, (_, i) => i % 2 === 0) });
    for (const [k, v] of res) cov.set(k, (v as any)?.covered ?? null);
  }
  const rubric = await runAll(jobs.map(({ r, pass }) => { const q = question(r.item); return { id: `${r.run_id}|rubric|${pass}`, prompt: SWEQA_RUBRIC(q.question, q.answer, answerOf(r) || '(no answer)') }; }), SWEQA_RUBRIC_SCHEMA, path.join(work, 'rubric'), { correctness: 10, completeness: 10, relevance: 10, clarity: 10, reasoning: 10 });
  for (const { r, pass } of jobs) {
    const c = cov.get(`${r.run_id}|coverage|${pass}`) as boolean[] | null | undefined;
    const rb = rubric.get(`${r.run_id}|rubric|${pass}`) as Record<string, number> | null | undefined;
    if (!c || !rb) continue; // retried on the next invocation
    const answered = !!answerOf(r);
    fs.appendFileSync(out, JSON.stringify({
      run_id: r.run_id, item: r.item, arm: r.arm, repeat: r.repeat, pass, judge: JUDGE_MODEL, mock: MOCK,
      covered: c, coverage: answered ? c.filter(Boolean).length / c.length : 0,
      rubric: rb, rubric_total: answered ? Object.values(rb).reduce((a, v) => a + Number(v), 0) : 0,
    }) + '\n');
  }
  console.error(`judged: ${readJsonl(out).length} rows`);
}

(MODE === 'keyfacts' ? keyfacts() : MODE === 'score' ? score() : Promise.reject(new Error('usage: judge.ts keyfacts|score ...'))).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
