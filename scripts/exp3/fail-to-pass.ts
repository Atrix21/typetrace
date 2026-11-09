#!/usr/bin/env tsx
/**
 * Experiment 3: executable evidence for category-A tasks (FAIL_TO_PASS), run in a COPY of the pinned snapshot so the
 * snapshot used for retrieval and audit is never modified.
 *
 *   npx tsx scripts/exp3/fail-to-pass.ts --repo immich --copy targets/exp3/immich-ftp [--only id,id]
 *
 * For each draft task with unit-test files changed by its fix: run those spec files on the fixed tree (pinned), revert
 * the fix's non-test change (bug tree), run them again. FAIL_TO_PASS = tests that pass on the fixed tree and fail on the
 * bug tree. Medium/e2e tests that need external services are recorded as not runnable.
 * Output: experiments/03-graph-scale/dataset/evidence/<repo>-fail-to-pass.jsonl
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { abs } from '../../src/config.js';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const repo = arg('repo')!;
const copy = abs(arg('copy')!);
const only = arg('only')?.split(',');
const CFG = {
  immich: { pkg: 'server', srcPrefix: 'server/', runner: (files: string[], out: string) => ['npx', ['vitest', 'run', '--config', 'test/vitest.config.mjs', '--reporter=json', `--outputFile=${out}`, ...files]] as const, unit: (f: string) => /^server\/src\/.*\.spec\.ts$/.test(f) },
  twenty: { pkg: 'packages/twenty-server', srcPrefix: 'packages/twenty-server/', runner: (files: string[], out: string) => ['npx', ['jest', '--json', `--outputFile=${out}`, '--runTestsByPath', ...files]] as const, unit: (f: string) => /^packages\/twenty-server\/src\/.*\.spec\.ts$/.test(f) },
}[repo]!;
const outFile = abs(`experiments/03-graph-scale/dataset/evidence/${repo}-fail-to-pass.jsonl`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).task_id) : []);

function git(args: string[]) { const r = spawnSync('git', args, { cwd: copy, encoding: 'utf8' }); return { ok: r.status === 0, out: r.stdout, err: r.stderr }; }

function runTests(files: string[]): { ok: boolean; tests: Record<string, string>; error?: string } {
  const out = path.join(copy, '.ftp-result.json');
  fs.rmSync(out, { force: true });
  const [cmd, args] = CFG.runner(files.map((f) => f.slice(CFG.srcPrefix.length)), out);
  const r = spawnSync(cmd, args as string[], { cwd: path.join(copy, CFG.pkg), encoding: 'utf8', timeout: 600_000, env: { ...process.env, CI: '1' } });
  if (!fs.existsSync(out)) return { ok: false, tests: {}, error: `${r.status}: ${(r.stderr || r.stdout || '').slice(-400)}` };
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  const tests: Record<string, string> = {};
  for (const tr of j.testResults ?? []) for (const a of tr.assertionResults ?? []) tests[`${path.basename(tr.name)}: ${a.fullName ?? a.title}`] = a.status;
  return { ok: true, tests };
}

const drafts = abs(`experiments/03-graph-scale/dataset/drafts/${repo}`);
for (const f of fs.readdirSync(drafts).filter((x) => x.endsWith('.json')).sort()) {
  const t = JSON.parse(fs.readFileSync(path.join(drafts, f), 'utf8'));
  if (t.task_type !== 'bug_localisation' || done.has(t.task_id) || (only && !only.includes(t.task_id))) continue;
  const changed: string[] = t.source?.test_files_changed ?? [];
  const unit = changed.filter((x) => CFG.unit(x) && fs.existsSync(path.join(copy, x)));
  const rec: Record<string, unknown> = { task_id: t.task_id, test_files_changed: changed, unit_test_files: unit };
  if (!unit.length) {
    rec.status = 'not_runnable';
    rec.reason = changed.length ? 'only medium/e2e/integration tests (need external services) or test file absent at the pinned snapshot' : 'no test in fix';
  } else {
    if (git(['status', '--porcelain', '--', CFG.srcPrefix + 'src']).out.trim()) throw new Error('copy not clean');
    const fixed = runTests(unit);
    const fuzz = t.snapshot.apply === 'fuzz-C1' ? ['-C1'] : [];
    const a = git(['apply', '-R', ...fuzz, abs(t.snapshot.patch)]);
    let bug: ReturnType<typeof runTests> = { ok: false, tests: {}, error: 'patch failed' };
    try { if (a.ok) bug = runTests(unit); } finally {
      const files = git(['diff', '--name-only']).out.split('\n').filter(Boolean);
      if (files.length) git(['checkout', '--', ...files]);
      for (const n of git(['ls-files', '--others', '--exclude-standard', '--', CFG.srcPrefix + 'src']).out.split('\n').filter(Boolean)) fs.rmSync(path.join(copy, n), { force: true });
    }
    const f2p = Object.keys(fixed.tests).filter((k) => fixed.tests[k] === 'passed' && bug.tests[k] && bug.tests[k] !== 'passed');
    const bugCompileFail = fixed.ok && !bug.ok;
    Object.assign(rec, {
      fixed_run_ok: fixed.ok, bug_run_ok: bug.ok, fixed_passed: Object.values(fixed.tests).filter((s) => s === 'passed').length, fixed_failed: Object.values(fixed.tests).filter((s) => s === 'failed').length,
      fail_to_pass: f2p, error: fixed.error ?? bug.error,
      status: f2p.length ? 'verified' : bugCompileFail ? 'verified_suite_fails_on_bug' : fixed.ok && bug.ok ? 'no_failing_test' : 'run_error',
    });
  }
  fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
  console.error(`${t.task_id}: ${rec.status} ${(rec.fail_to_pass as string[] | undefined)?.length ?? ''}`);
}
