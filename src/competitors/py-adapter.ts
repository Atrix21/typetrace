/**
 * Shared plumbing for out-of-process competitor adapters (Python, run in their own pinned venvs).
 * The Python adapters (src/competitors/py/*.py) run the REAL upstream implementations and
 * emit results in our common schema; this wrapper only shells out and parses JSON.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Corpus, RetrievalOutput, RetrievalQuery } from '../types.js';

export function runPython(python: string, script: string, args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string } {
  // Optional wall-clock limit per call (TYPETRACE_PY_TIMEOUT_MS; unset = none, as in experiments 1-5). Set by the
  // experiment 8 queue step so that one hung competitor run cannot stall an unattended multi-day run.
  const timeout = Number(process.env.TYPETRACE_PY_TIMEOUT_MS || 0) || undefined;
  const r = spawnSync(python, ['-I', script, ...args], {
    encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout, killSignal: 'SIGKILL', env: { ...process.env, PYTHONHASHSEED: '0', HF_HUB_OFFLINE: '1', ...env },
  });
  if (r.status !== 0) throw new Error(`${path.basename(script)} ${args[0]} failed (exit ${r.status}${r.error ? `, ${r.error.message}` : ''}${r.signal ? `, ${r.signal}` : ''}):\n${r.stderr?.slice(-4000)}`);
  return { stdout: r.stdout, stderr: r.stderr };
}

export function lastJsonLine(s: string): any {
  const lines = s.trim().split('\n').filter((l) => l.trim().startsWith('{'));
  return JSON.parse(lines[lines.length - 1]);
}

export function writeQueries(dir: string, qs: RetrievalQuery[]): string {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `queries-${process.pid}.jsonl`);
  fs.writeFileSync(p, qs.map((q) => JSON.stringify({ task_id: q.task_id, query: q.query })).join('\n') + '\n');
  return p;
}

export function readOutputs(p: string, method: string): RetrievalOutput[] {
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
    const o = JSON.parse(l);
    return {
      task_id: o.task_id, method, results: (o.results ?? []).filter((r: any) => r.file), context: o.context ?? '',
      latency_ms: o.latency_ms, llm_tokens: o.llm_tokens ?? null, metadata: o.metadata ?? {},
    } as RetrievalOutput;
  });
}

/**
 * A fresh git repository at a neutral path holding EXACTLY the corpus files as they are on disk (the task snapshot,
 * including an uncommitted reverted fix), plus package.json/tsconfig.json. Competitors index the same files our methods
 * index, at a path whose words cannot match query vocabulary (CRG indexes absolute paths). Returns the path.
 */
export function neutralCopy(corpus: Corpus, dir: string): string {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of [...corpus.files, 'package.json', 'tsconfig.json']) {
    const src = path.join(corpus.repoRoot, f);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(src, path.join(dir, f));
  }
  const git = (a: string[]) => { const r = spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@localhost', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a[0]}: ${r.stderr}`); };
  git(['init', '-q']); git(['add', '-A']); git(['commit', '-q', '-m', 'snapshot']);
  return dir;
}
