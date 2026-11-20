#!/usr/bin/env tsx
/**
 * Experiment 11: each tool as its vendor ships it for Claude Code, on each tool's own kind of task. Protocol:
 * experiments/11-vendor-setups/protocol.md.
 *
 *   npx tsx scripts/exp11/agent.ts --run <id> --set pilot|main --task T1|T2|T3 [--n N] --arms G0,TT,TS,GF,CR --repeats 2 \
 *       --model claude-haiku-5-5 --accounts <login1>,<login2> [--workers 2] [--mock] [--only id,id] [--timeout-s 900]
 *
 * Arms (protocol, Arms):
 *   G0 Claude Code's base tools only (Read, Grep, Glob, Skill);
 *   TT TypeTrace as it ships before 0.3.0: `typetrace init --no-setup` (index + .mcp.json entry only);
 *   TS TypeTrace 0.3.0: `typetrace init` (index, .mcp.json, CLAUDE.md block, skill, soft hook);
 *   GF graphify 0.9.113: `graphify update .` (code graph, no LLM), `graphify install --project --platform claude`,
 *      `graphify claude install`; no MCP server: the agent may run graphify's read commands through Bash;
 *   CR code-review-graph 2.4.0: `build`, `embed` (local model), `install --platform claude-code -y`; MCP server.
 * Every installer runs in the workspace itself (a git repository with one commit of the snapshot), with a throwaway
 * HOME. The only changes to what they write: commands are pointed at the pinned installs (protocol, "Adapting").
 *
 * Isolation ('project-oauth' profile): the workspace's CLAUDE.md, skills and hooks load, user-level ones never; reads
 * outside the workspace are blocked; Bash exists only in GF, limited to graphify's read commands. graphify and
 * code-review-graph always run through wrappers with their own HOME, so they never read or write the owner's files.
 *
 * Output under experiments/11-vendor-setups/results/<run>/: plan.json, runs.jsonl, excluded.jsonl, accounts.jsonl,
 * setups.jsonl (hashes of every file each installer wrote), meta.json, transcripts/ and tool-logs/ (git-ignored).
 * T3 answers are scored afterwards by scripts/exp11/judge.ts. Resumable.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { abs } from '../../src/config.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import { initLanguages, grammarLanguages } from '../../src/languages/registry.js';
import { sourceFiles } from '../../src/product/source-files.js';
import type { GroundTruthTask } from '../../src/types.js';
import {
  BillableGuard, BillableRefused, EXPECTED_MCP_TOOLS, PROJECT_TOOLS, buildClaudeCommand, checkInit, installSignalHandlers, isUsageLimitExclusion,
  onHarnessAbort, parseStreamJson, runClaude, type McpServerSpec,
} from '../../src/agent-eval/backends/claude-code.js';
import { bindAccount, claudeVersion, DENY_TOOLS } from '../../src/agent-eval/agentic.js';
import { accountRecord, type AccountInfo } from '../../src/agent-eval/account.js';
import { startMockServer, type MockStep } from '../../src/agent-eval/mock-anthropic/server.js';
import { opaqueId, WORK_ROOT } from '../../src/agent-eval/workspace.js';
import { cleanFile, parseAnswer, scoreAnswer, ANSWER_SCHEMA } from '../../src/agent-eval/exp3/score.js';
import { UNSET_ENV } from '../../src/agent-eval/mcp/competitor-servers.js';
import { T1_PROMPT, T2_PROMPT, T3_PROMPT, T3_SCHEMA, TASK_SYSTEM_PROMPT, parseT3Answer } from './prompts.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (n: string) => process.argv.includes(`--${n}`);
const RUN = arg('run')!;
const SET = arg('set', 'pilot')!;
const TASK = arg('task', 'T1')! as 'T1' | 'T2' | 'T3';
const N = arg('n') ? Number(arg('n')) : null;
const ARMS = arg('arms', 'G0,TT,TS,GF,CR')!.split(',');
const MODEL = arg('model', 'claude-haiku-5-5')!;
const EFFORT = arg('effort', 'high')!;
const REPEATS = Number(arg('repeats', '2'));
const MOCK = flag('mock');
const ACCOUNTS = arg('accounts', MOCK ? 'mock' : '')!.split(',').filter(Boolean);
const label = (n: string) => `login${ACCOUNTS.indexOf(n) + 1}`;
const WORKERS = Number(arg('workers', '2'));
const MIN_FREE_GB = Number(arg('min-free-gb', '4'));
const ONLY = arg('only')?.split(',');
const TIMEOUT_S = Number(arg('timeout-s', '900'));
const MAX_TURNS = 40;
const ALL_ARMS = ['G0', 'TT', 'TS', 'GF', 'CR'];
const EXP = abs('experiments/11-vendor-setups');
const OUT = path.join(EXP, 'results', RUN);
const SCRATCH = abs('.cache/exp11/run');
const GF_VENV = abs('vendor/.venvs/graphify-0.9.113');
const CR_VENV = abs('vendor/.venvs/code-review-graph');
const TT_BIN = abs('bin/typetrace.js');
const CLAUDE_BIN = process.env.AGENT_EVAL_CLAUDE_BIN ?? path.join(os.homedir(), 'dev/backups/claude-code-pinned/bin/claude');
const BUILTINS = JSON.parse(fs.readFileSync(path.join(EXP, 'claude-builtins.json'), 'utf8')) as { claude_code_version: string; skills: string[]; slash_commands: string[] };
/** Skill names in the owner's own Claude Code configurations: never allowed in any arm (only names are read). */
const OWNER_SKILLS = [path.join(os.homedir(), '.claude', 'skills'), ...(() => { try { return fs.readdirSync(path.join(os.homedir(), '.config', 'claude-accounts')).map((a) => path.join(os.homedir(), '.config', 'claude-accounts', a, 'skills')); } catch { return []; } })()]
  .flatMap((d) => { try { return fs.readdirSync(d); } catch { return []; } });
const ARM_SKILLS: Record<string, string[]> = { G0: [], TT: [], TS: ['typetrace'], GF: ['graphify'], CR: ['debug-issue', 'explore-codebase', 'refactor-safely', 'review-changes'] };
/**
 * Claude Code's Bash sandbox (bubblewrap), the same in every arm (E11-D01): no network; nothing outside the workspace
 * readable except the arm's own pinned tool install; writes only in the workspace (reset after every run), the run's
 * temp folder and the tool's own HOME.
 */
function sandboxFor(ws: string, runTmp: string, toolPaths: string[]): Record<string, unknown> {
  return {
    enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
    filesystem: { denyRead: [os.homedir(), '/tmp', '/var/tmp', '/root', '/mnt', '/media', '/srv', '/opt'], allowRead: [ws, runTmp, ...toolPaths], allowWrite: [runTmp, ...toolPaths.filter((p) => p.includes('tool-home'))] },
    network: { allowedDomains: [] },
  };
}
const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
EXPECTED_MCP_TOOLS.typetrace = ['find_relevant_code'];

const readJsonl = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const append = (f: string, o: unknown) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n');
const log = (s: string) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const memFreeGb = () => { const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); return m ? Number(m[1]) / 1048576 : 0; };
function sh(cmd: string, args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): string {
  const r = spawnSync(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, encoding: 'utf8', maxBuffer: 256 << 20, timeout: o.timeoutMs ?? 4 * 3600_000 });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')} failed (${r.status ?? r.signal}): ${(r.stderr || r.stdout || '').split('\n').filter((l) => !/^\s+at /.test(l)).join('\n').slice(-900)}`);
  return r.stdout;
}

// ---------------------------------------------------------------- items
interface Item {
  id: string; task: 'T1' | 'T2' | 'T3'; repo: string; commit: string; unit: string;
  prompt: string; gt?: string[]; gtFiles?: string[]; seed?: string; language: string; question?: { q: string; answer: string };
}
const CLONE_DIRS = [abs('targets/swebench'), abs('targets/swebench-ml'), abs('targets/exp11')];
function cloneOf(repo: string): string {
  const name = repo.replace('/', '__');
  const found = CLONE_DIRS.map((d) => path.join(d, name)).find((d) => fs.existsSync(path.join(d, '.git')));
  if (found) return found;
  const dir = path.join(abs('targets/exp11'), name);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  log(`cloning ${repo}`);
  sh('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', `https://github.com/${repo}.git`, dir]);
  return dir;
}

/** The seed file's part of the gold patch (T2 shows it to the agent). */
export function fileDiff(patch: string, file: string): string {
  const parts = patch.split(/^(?=diff --git )/m);
  return parts.find((p) => p.startsWith(`diff --git a/${file} b/`))?.trimEnd() ?? '';
}

function loadItems(): Item[] {
  if (TASK === 'T3') {
    const sel = JSON.parse(fs.readFileSync(path.join(EXP, 'data', 't3-selection.json'), 'utf8'));
    const commits = new Map<string, string>();
    for (const l of fs.readFileSync(abs('.cache/exp11/sweqa/repo_commit.txt'), 'utf8').split('\n')) {
      const m = /github\.com\/([^/\s]+\/[^/\s]+)\s+([0-9a-f]+)/.exec(l); if (m) commits.set(m[1].split('/')[1], `${m[1]}@${m[2]}`);
    }
    const out: Item[] = [];
    for (const qid of sel[SET] as string[]) {
      const [name, idx] = qid.split('#');
      const rows = fs.readFileSync(abs(`.cache/exp11/sweqa/${name}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const q = rows[Number(idx)];
      const [repo, commit] = commits.get(name)!.split('@');
      out.push({ id: qid, task: 'T3', repo, commit, unit: `sweqa:${repo}`, language: 'Python', prompt: T3_PROMPT(q.question), question: { q: q.question, answer: q.answer } });
    }
    return out;
  }
  const assign = JSON.parse(fs.readFileSync(path.join(EXP, 'data', 'assignment.json'), 'utf8'));
  const tasks = new Map(readJsonl(path.join(EXP, 'data', 'tasks.jsonl')).map((t) => [t.task_id, t]));
  const src = new Map<string, any>();
  for (const f of ['swebench-full.json', 'polybench.json']) for (const r of JSON.parse(fs.readFileSync(abs(`.cache/exp11/${f}`), 'utf8'))) src.set(r.instance_id, r);
  return (assign[SET][TASK] as string[]).map((id) => {
    const t = tasks.get(id)!; const s = src.get(id)!;
    const base = { id, task: TASK, repo: t.repo, commit: t.base_commit, unit: id, language: t.language, gt: t.ground_truth as string[], gtFiles: t.gt_files as string[] };
    if (TASK === 'T1') return { ...base, prompt: T1_PROMPT(s.problem_statement) };
    return { ...base, seed: t.seed_file, prompt: T2_PROMPT(s.problem_statement, t.seed_file, fileDiff(s.patch, t.seed_file)) };
  });
}

// ---------------------------------------------------------------- snapshots and workspaces
function snapshot(it: Item): { root: string; files: string[] } {
  const clone = cloneOf(it.repo);
  try { sh('git', ['-C', clone, 'cat-file', '-e', `${it.commit}^{commit}`]); } catch { sh('git', ['-C', clone, 'fetch', '-q', 'origin', it.commit]); }
  const root = path.join(SCRATCH, 'snap', sha(it.unit).slice(0, 12));
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const a = spawnSync('bash', ['-c', `git -C '${clone}' archive --format=tar '${it.commit}' | tar -x -C '${root}'`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (a.status !== 0) throw new Error(`git archive ${it.unit}: ${a.stderr.slice(-400)}`);
  return { root, files: sourceFiles(root, ['']) };
}

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'dev@localhost', GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'dev@localhost', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
/** The whole repository at the issue's commit (E11-D02: as a user has it, docs and configuration included), as a git
 *  repository with one commit (no history, no ground truth). */
function makeWorkspace(root: string, _files: string[], key: string): string {
  const parent = path.join(WORK_ROOT, opaqueId(key, RUN));
  const dir = path.join(parent, 'app');
  fs.rmSync(parent, { recursive: true, force: true });
  fs.mkdirSync(parent, { recursive: true });
  sh('cp', ['-a', root + '/.', dir]);
  sh('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
  // Claude Code shows the git user in its context: a neutral one, never the owner's global identity.
  sh('git', ['config', 'user.name', 'dev'], { cwd: dir }); sh('git', ['config', 'user.email', 'dev@localhost'], { cwd: dir });
  // -f: every file of the snapshot is tracked, also those the repository's own .gitignore matches (e.g. test outputs
  // that were committed anyway), so the reset after each run restores them.
  sh('git', ['add', '-A', '-f'], { cwd: dir, env: GIT_ENV });
  sh('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'snapshot'], { cwd: dir, env: GIT_ENV });
  return dir;
}

/** Files a run changed in the workspace (Bash can write there), tool stamps excluded. Then undone with git. */
function wsChanges(ws: string): string[] {
  return sh('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ws }).split('\n').filter(Boolean).map((l) => l.slice(3)).filter((f) => !/^graphify-out\/cache\//.test(f));
}
function wsRestore(ws: string) {
  sh('git', ['reset', '-q', '--hard'], { cwd: ws });
  // -x: ignored files too (a run killed mid-command can leave some), except code-review-graph's own data folder.
  sh('git', ['clean', '-q', '-f', '-d', '-x', '-e', '.code-review-graph/'], { cwd: ws });
}

/** Tool state that may change during a run: hook counters and stamps (reset before each run), the tools' own data. */
const VOLATILE = [/^graphify-out\/cache\//, /^\.code-review-graph\//];
function wsState(ws: string): string { return sha(wsManifest(ws).sort().join('\n')); }
function wsManifest(ws: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); const rel = path.relative(ws, p); if (rel === '.git' || VOLATILE.some((r) => r.test(rel + (e.isDirectory() ? '/' : '')))) continue; if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(`${rel}\0${sha(fs.readFileSync(p))}`); } };
  walk(ws);
  return out;
}

// ---------------------------------------------------------------- the arms' setups
/** Wrappers that give graphify and code-review-graph their own HOME, so they never touch the owner's files. */
function writeWrappers(): { gfBin: string; crBin: string } {
  const unset = UNSET_ENV.map((v) => `unset ${v}`).join('; ');
  const mk = (dir: string, name: string, target: string, extra: string) => {
    const home = path.join(SCRATCH, 'tool-home', name);
    fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n# experiment 11: ${name} with its own HOME (never the owner's)\n${unset}\nexport HOME='${home}' XDG_CONFIG_HOME='${home}/.config' XDG_CACHE_HOME='${home}/.cache' XDG_DATA_HOME='${home}/.local/share'${extra}\nexec '${target}' "$@"\n`, { mode: 0o755 });
    return dir;
  };
  return {
    gfBin: mk(path.join(SCRATCH, 'bin-gf'), 'graphify', path.join(GF_VENV, 'bin', 'graphify'), ''),
    crBin: mk(path.join(SCRATCH, 'bin-cr'), 'code-review-graph', path.join(CR_VENV, 'bin', 'code-review-graph'), ` HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false HF_HOME='${path.join(os.homedir(), '.cache', 'huggingface')}'`),
  };
}

interface ArmSetup {
  ws: string; mcp: McpServerSpec | null; extraEnv: Record<string, string>; pathPrefix: string[];
  /** What the arm's own command line needs to read inside the sandbox (its wrapper, venv and HOME). */
  toolPaths: string[];
  reset: () => void; state: string; manifest: string[]; build_ms: number; files: Record<string, string>;
  /** Folders outside the workspace that belong to this setup (deleted with it). */
  dirs: string[];
}

/** Every file in the workspace that is not part of the snapshot commit, with its hash (paths normalised). */
function setupFiles(ws: string, extraRoots: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const tracked = new Set(sh('git', ['ls-files'], { cwd: ws }).split('\n').filter(Boolean));
  const norm = (b: Buffer) => b.toString('utf8').split(ws).join('<WS>').split(SCRATCH).join('<SCRATCH>').split(abs('.')).join('<ROOT>');
  const walk = (d: string, base: string, prefix: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); const rel = prefix + path.relative(base, p); if (rel === '.git' || /^graphify-out\//.test(rel) || /^\.code-review-graph\//.test(rel)) continue; if (e.isDirectory()) walk(p, base, prefix); else if (e.isFile() && !tracked.has(rel)) out[rel] = sha(norm(fs.readFileSync(p))).slice(0, 16); } };
  walk(ws, ws, '');
  for (const r of extraRoots) if (fs.existsSync(r)) walk(r, r, `<${path.basename(r)}>/`);
  for (const h of ['pre-commit', 'post-checkout', 'post-merge', 'post-rewrite']) { const p = path.join(ws, '.git', 'hooks', h); if (fs.existsSync(p)) out[`.git/hooks/${h}`] = sha(norm(fs.readFileSync(p))).slice(0, 16); }
  return out;
}

/** Append to `shared` the vector lines of `fresh` it lacks, streaming (caches of large repositories exceed 512 MB). */
export async function mergeVectors(shared: string, fresh: string) {
  const keyOf = (l: string) => /^\{"k":"([0-9a-f]{64})"/.exec(l)?.[1] ?? null;
  const have = new Set<string>();
  if (fs.existsSync(shared)) for await (const l of readline.createInterface({ input: fs.createReadStream(shared), crlfDelay: Infinity })) { const k = keyOf(l); if (k) have.add(k); }
  const out = fs.createWriteStream(shared, { flags: 'a' });
  for await (const l of readline.createInterface({ input: fs.createReadStream(fresh), crlfDelay: Infinity })) {
    const k = keyOf(l);
    if (k && !have.has(k)) { have.add(k); if (!out.write(l + '\n')) await new Promise<void>((r) => out.once('drain', () => r())); }
  }
  await new Promise<void>((r) => out.end(r));
}
const sharedVectors = (repo: string) => path.join(SCRATCH, 'emb', repo.replace('/', '__'), 'vectors.jsonl');
function ttCacheDir(cacheBase: string, ws: string) { return path.join(cacheBase, sha(ws).slice(0, 16)); }

async function setupArm(arm: string, root: string, files: string[], it: Item, w: { gfBin: string; crBin: string }): Promise<ArmSetup> {
  const ws = makeWorkspace(root, files, `${it.unit}|${arm}`);
  const home = fs.mkdtempSync(path.join(SCRATCH, 'install-home-'));
  const t0 = performance.now();
  const base: ArmSetup = { ws, mcp: null, extraEnv: {}, pathPrefix: [], toolPaths: [], reset: () => {}, state: '', manifest: [], build_ms: 0, files: {}, dirs: [] };
  try {
    if (arm === 'TT' || arm === 'TS') {
      const cache = path.join(SCRATCH, 'tt', `${sha(it.unit).slice(0, 12)}-${arm}`);
      fs.rmSync(cache, { recursive: true, force: true });
      base.dirs.push(cache);
      // Seed the vector cache with every vector computed before for this repository (keyed by chunk text and model).
      const shared = sharedVectors(it.repo);
      const emb = path.join(ttCacheDir(cache, ws), 'embeddings');
      fs.mkdirSync(emb, { recursive: true });
      if (fs.existsSync(shared)) fs.copyFileSync(shared, path.join(emb, 'vectors.jsonl'));
      const env = { ...process.env, HOME: home, TYPETRACE_CACHE: cache, HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false', HF_HOME: path.join(os.homedir(), '.cache', 'huggingface') };
      sh(process.execPath, [TT_BIN, 'init', ws, '--client', 'claude', '--wait', '--gpu', ...(arm === 'TT' ? ['--no-setup'] : [])], { cwd: ws, env });
      // Keep the shared cache complete for the next issue of this repository.
      fs.mkdirSync(path.dirname(shared), { recursive: true });
      await mergeVectors(shared, path.join(emb, 'vectors.jsonl'));
      const mcpJson = JSON.parse(fs.readFileSync(path.join(ws, '.mcp.json'), 'utf8')).mcpServers.typetrace;
      base.mcp = { name: 'typetrace', command: mcpJson.command, args: mcpJson.args, env: { TYPETRACE_CACHE: cache, HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false' }, denyTools: [] };
      base.extraEnv = { TYPETRACE_CACHE: cache }; // the hook script finds the index through it, as the server does
      const idx = ttCacheDir(cache, ws);
      base.reset = () => { fs.rmSync(path.join(idx, 'last_query'), { force: true }); fs.rmSync(path.join(idx, 'hooks'), { recursive: true, force: true }); };
    } else if (arm === 'GF') {
      const env = { ...process.env, HOME: home, PATH: `${w.gfBin}:/usr/bin:/bin` };
      sh('graphify', ['update', '.'], { cwd: ws, env }); // the code graph first, so the setup's own files are not in it
      sh('graphify', ['install', '--project', '--platform', 'claude'], { cwd: ws, env });
      sh('graphify', ['claude', 'install'], { cwd: ws, env });
      base.pathPrefix = [w.gfBin];
      base.toolPaths = [w.gfBin, GF_VENV, path.join(SCRATCH, 'tool-home', 'graphify')];
      base.reset = () => { for (const f of ['last_query_stamp', 'hook_sessions']) fs.rmSync(path.join(ws, 'graphify-out', 'cache', f), { recursive: true, force: true }); };
    } else if (arm === 'CR') {
      const env = { ...process.env, HOME: home, PATH: `${w.crBin}:/usr/bin:/bin` };
      sh('code-review-graph', ['build', '--repo', ws], { cwd: ws, env });
      sh('code-review-graph', ['embed', '--repo', ws], { cwd: ws, env });
      sh('code-review-graph', ['install', '--platform', 'claude-code', '-y', '--repo', ws], { cwd: ws, env });
      const m = JSON.parse(fs.readFileSync(path.join(ws, '.mcp.json'), 'utf8')).mcpServers['code-review-graph'];
      // The installer writes `uvx code-review-graph serve` when uvx is on the PATH (it would download the latest release at
      // run time), else its own interpreter (`<python> -m code_review_graph serve`). Either way: the pinned install, via the wrapper.
      const uvx = m.command === 'uvx' && JSON.stringify(m.args) === JSON.stringify(['code-review-graph', 'serve']);
      const own = /python[0-9.]*$/.test(String(m.command)) && JSON.stringify(m.args) === JSON.stringify(['-m', 'code_review_graph', 'serve']);
      if (!uvx && !own) throw new Error(`unexpected code-review-graph MCP entry ${JSON.stringify(m)}`);
      base.mcp = { name: 'code-review-graph', command: path.join(w.crBin, 'code-review-graph'), args: ['serve'], env: {}, denyTools: DENY_TOOLS.crg };
      base.pathPrefix = [w.crBin];
      base.toolPaths = [w.crBin, CR_VENV, path.join(SCRATCH, 'tool-home', 'code-review-graph'), path.join(os.homedir(), '.cache', 'huggingface')];
    }
    base.build_ms = Math.round(performance.now() - t0);
    base.files = setupFiles(ws);
    base.reset();
    // The setup is committed, as in a repository where the tool is set up: git status is clean in every arm, and
    // every run's changes (Bash can write in the workspace) are found and undone with git (E11-D01).
    sh('git', ['add', '-A'], { cwd: ws, env: GIT_ENV });
    if (sh('git', ['status', '--porcelain'], { cwd: ws })) sh('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'tool setup'], { cwd: ws, env: GIT_ENV });
    base.manifest = wsManifest(ws);
    base.state = wsState(ws);
    return base;
  } catch (e) {
    for (const d of [path.dirname(ws), ...base.dirs]) fs.rmSync(d, { recursive: true, force: true });
    throw e;
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- scoring
function scoreItem(index: SymbolIndex | null, it: Item, raw: unknown) {
  if (it.task === 'T3') return { answered: parseT3Answer(raw) ? 1 : 0 };
  const answer = parseAnswer(raw);
  const gt = it.task === 'T2' ? it.gt!.filter((k) => k.split('::')[0] !== it.seed) : it.gt!;
  const gtFiles = it.task === 'T2' ? it.gtFiles!.filter((f) => f !== it.seed) : it.gtFiles!;
  const task = { task_id: it.id, split: SET, description: it.prompt, root_cause_symbols: gt, relevant_symbols: gt, relevant_files: gtFiles, task_type: 'bug_localisation', repo: it.repo } as GroundTruthTask;
  const s = scoreAnswer(index!, task, answer);
  const listed = [...new Set((answer?.locations ?? []).map((l) => cleanFile(l.file)))].filter((f) => !(it.task === 'T2' && f === it.seed));
  const fileRecall = gtFiles.filter((f) => listed.includes(f)).length / gtFiles.length;
  const fileAt3 = listed.slice(0, 3).some((f) => gtFiles.includes(f)) ? 1 : 0;
  // Primary: T1 function recall; T2 file recall (code-review-graph's own unit). Accuracy: T1 a changed function in the
  // first three; T2 another changed file among the first three listed files other than the seed.
  return {
    ...s, file_recall: fileRecall, file_at_3: fileAt3, function_recall: s.recall,
    primary: answer ? (it.task === 'T1' ? s.recall : fileRecall) : 0,
    accuracy: answer ? (it.task === 'T1' ? s.rc_at_3 : fileAt3) : 0,
    top1: answer ? s.rc_at_1 : 0, gt_size: gt.length, gt_files: gtFiles.length,
  };
}

// ---------------------------------------------------------------- accounts with failover (as in experiment 10)
class AccountPool {
  private exhaustedAt = new Map<string, number>();
  private infos = new Map<string, AccountInfo | null>();
  private guards = new Map<string, BillableGuard>();
  constructor(private names: string[], runUsd: number, maxUsd: number) {
    for (const n of names) {
      const a = MOCK ? null : bindAccount({ account: n, billing: 'subscription', mock: MOCK });
      this.infos.set(n, a);
      const g = new BillableGuard({ protocol: 'agentic', conditions: ARMS, model: MODEL, split: `${SET}:${TASK}`, max_total_usd: maxUsd, billing: 'subscription', account: n },
        { runUsd, approvalPath: path.join(EXP, 'APPROVAL.json'), ledgerPath: path.join(EXP, 'spend-ledger.jsonl') });
      if (!MOCK) g.assertAllowed({}, false);
      this.guards.set(n, g);
    }
  }
  current(): string | null { const t = Date.now(); return this.names.find((n) => t - (this.exhaustedAt.get(n) ?? 0) > 30 * 60_000) ?? null; }
  exhausted(n: string, why: string) {
    if (Date.now() - (this.exhaustedAt.get(n) ?? 0) > 60_000) { log(`ACCOUNT ${label(n)} hit its limit: ${why.slice(0, 160)}`); append('accounts.jsonl', { at: new Date().toISOString(), account: label(n), event: 'limit', detail: why.slice(0, 300) }); }
    this.exhaustedAt.set(n, Date.now());
  }
  info(n: string) { return this.infos.get(n) ?? null; }
  guard(n: string) { return this.guards.get(n)!; }
  record(n: string) { const a = this.infos.get(n); return a ? { ...accountRecord(a), name: label(n) } : { name: label(n), mock: true }; }
}

function takeRunnerLock() {
  const lock = path.join(SCRATCH, 'runner.lock');
  fs.mkdirSync(SCRATCH, { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, run: RUN, started: new Date().toISOString() }), { flag: 'wx' });
      process.on('exit', () => { try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid) fs.rmSync(lock); } catch { /* */ } });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let owner: { pid?: number; run?: string } = {};
      try { owner = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { /* stale */ }
      let alive = false;
      try { if (owner.pid) { process.kill(owner.pid, 0); alive = true; } } catch { /* gone */ }
      if (alive) throw new Error(`another experiment-11 runner is active (pid ${owner.pid}, run ${owner.run})`);
      fs.rmSync(lock, { force: true });
    }
  }
  throw new Error(`could not take ${lock}`);
}

let buildChain: Promise<unknown> = Promise.resolve();
function serialBuild<T>(fn: () => Promise<T>): Promise<T> { const p = buildChain.then(fn, fn); buildChain = p.catch(() => undefined); return p; }

// ---------------------------------------------------------------- mock script (harness checks; no model)
function mockSteps(arm: string, it: Item, mcp: McpServerSpec | null): MockStep[] {
  const [f0, s0] = (it.gt?.[0] ?? 'README.md::x').split('::');
  const final = it.task === 'T3' ? { answer: 'mock answer (no model was called)', locations: [{ file: f0, symbol: s0 }] } : { summary: 'mock answer (no model was called)', locations: [{ file: f0, symbol: s0 }] };
  return [
    ...(mcp ? [{ tool: 'mcp:auto', input: { $fill: 'where is this implemented' } } as MockStep] : []),
    ...(arm === 'GF' ? [{ tool: 'Bash', input: { command: 'graphify query "where is this implemented"' } } as MockStep] : []),
    { tool: 'Bash', input: { command: `grep -rln "${(s0 ?? 'x').split('.').pop()}" . | head -3; echo x > mock-write.txt; cat ~/.claude/CLAUDE.md 2>&1 | head -1` } },
    { tool: 'Grep', input: { pattern: (s0 ?? 'x').split('.').pop()! } },
    { tool: 'Read', input: { file_path: f0 } },
    { structured: final },
  ];
}

// ---------------------------------------------------------------- main
async function main() {
  if (!RUN || !['pilot', 'main'].includes(SET) || !['T1', 'T2', 'T3'].includes(TASK)) throw new Error('usage: agent.ts --run <id> --set pilot|main --task T1|T2|T3 ...');
  if (!ACCOUNTS.length) throw new Error('--accounts <login>[,<login>...] is required (in order; the next is used only when one hits its limit)');
  for (const a of ARMS) if (!ALL_ARMS.includes(a)) throw new Error(`unknown arm ${a}`);
  takeRunnerLock();
  for (const d of ['transcripts', 'tool-logs']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
  let items = loadItems();
  if (N != null) items = items.slice(0, N);
  if (ONLY) items = items.filter((i) => ONLY.includes(i.id));
  const runUsd = Number(arg('run-usd', '1'));
  const pool = new AccountPool(ACCOUNTS, runUsd, Number(arg('max-usd', '0.01')));
  const version = claudeVersion(CLAUDE_BIN); // the pinned copy (E10-D05), not whatever `claude` is on the PATH
  if (!MOCK && version !== BUILTINS.claude_code_version) throw new Error(`Claude Code ${version} is not the pinned ${BUILTINS.claude_code_version}`);
  const config = { set: SET, task: TASK, n: N, arms: ARMS, model: MODEL, effort: EFFORT, repeats: REPEATS, max_turns: MAX_TURNS, items: items.map((i) => i.id), claude_version: version, mock: MOCK, accounts: ACCOUNTS.map(label), system_prompt_sha: sha(TASK_SYSTEM_PROMPT[TASK]).slice(0, 16), schema_sha: sha(JSON.stringify(TASK === 'T3' ? T3_SCHEMA : ANSWER_SCHEMA)).slice(0, 16) };
  const planFile = path.join(OUT, 'plan.json');
  const mkPlan = () => items.flatMap((it) => ARMS.flatMap((a) => Array.from({ length: REPEATS }, (_, r) => ({ run_id: `${it.id}|${a}|r${r + 1}`, item: it.id, unit: it.unit, arm: a, repeat: r + 1 }))))
    .sort((x, y) => (x.unit !== y.unit ? (items.findIndex((i) => i.unit === x.unit) - items.findIndex((i) => i.unit === y.unit)) : sha(`20261120|${x.run_id}`) < sha(`20261120|${y.run_id}`) ? -1 : 1));
  let plan = mkPlan();
  if (fs.existsSync(planFile)) {
    const prev = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    for (const k of ['set', 'task', 'arms', 'model', 'effort', 'repeats', 'max_turns', 'items', 'claude_version', 'system_prompt_sha', 'schema_sha'] as const) if (JSON.stringify(prev.config[k]) !== JSON.stringify((config as any)[k])) throw new Error(`resuming ${RUN} with a different ${k}`);
    plan = prev.items;
  } else fs.writeFileSync(planFile, JSON.stringify({ config, items: plan }, null, 1) + '\n');
  for (const f of ['runs.jsonl', 'excluded.jsonl', 'accounts.jsonl', 'setups.jsonl']) if (!fs.existsSync(path.join(OUT, f))) fs.writeFileSync(path.join(OUT, f), '');
  const done = new Set(readJsonl(path.join(OUT, 'runs.jsonl')).map((r) => r.run_id));
  const excl = readJsonl(path.join(OUT, 'excluded.jsonl'));
  const counted = (id: string) => excl.filter((e) => e.run_id === id && !isUsageLimitExclusion(e) && e.excluded_kind !== 'aborted');
  const attempts = (id: string) => counted(id).length;
  // As experiment 10 (E10-D02): a stalled response is retried up to 4 attempts in all; other infrastructure failures once.
  const canTry = (id: string) => { const c = counted(id); const stalls = c.filter((e) => e.excluded === 'infra_error:no_result').length; return c.length - stalls < 2 && c.length < 4; };
  const finalExcl = new Set(excl.filter((e) => e.retryable === false).map((e) => e.run_id));
  const pending = (unit: string) => plan.filter((p: any) => p.unit === unit && !done.has(p.run_id) && !finalExcl.has(p.run_id) && canTry(p.run_id));

  installSignalHandlers();
  const children = new Set<ChildProcess>();
  onHarnessAbort(() => { for (const c of children) { try { c.kill('SIGTERM'); } catch { /* */ } } });
  const writeMeta = (status: string, extra: Record<string, unknown> = {}) => fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ run: RUN, status, ...config, items: items.length, run_usd: runUsd, workers: WORKERS, updated: new Date().toISOString(), ...extra }, null, 2) + '\n');
  writeMeta('running');
  let halted: string | null = null, infraStreak = 0;
  const mcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp11-mcp-'));
  const wrappers = writeWrappers();
  await initLanguages();
  // Preflight: the Bash sandbox must work on this machine (bubblewrap + socat; E11-D01), else nothing runs.
  const pre = spawnSync('bwrap', ['--unshare-user', '--unshare-net', '--ro-bind', '/', '/', 'true'], { encoding: 'utf8' });
  if (pre.status !== 0 || /Operation not permitted/.test(pre.stderr) || spawnSync('which', ['socat']).status !== 0) throw new Error(`Bash sandbox unavailable (bwrap: ${pre.stderr.trim().slice(0, 200)}; socat ${spawnSync('which', ['socat']).status === 0 ? 'ok' : 'missing'})`);
  const units = [...new Set(items.map((i) => i.unit))].filter((u) => pending(u).length);
  log(`${RUN}: ${TASK} ${SET}, ${units.length} unit(s) with pending runs, ${plan.length - done.size} run(s) pending, ${WORKERS} workers`);

  async function runUnit(unit: string, w: number) {
    const todo = pending(unit);
    const unitItems = items.filter((i) => i.unit === unit);
    const setups: Record<string, ArmSetup> = {};
    let snapRoot: string | null = null;
    try {
      const { root, files } = snapshot(unitItems[0]);
      snapRoot = root;
      await initLanguages(grammarLanguages(files));
      const index = TASK === 'T3' ? null : new SymbolIndex(root, files);
      await serialBuild(async () => {
        for (const arm of ARMS.filter((a) => todo.some((p: any) => p.arm === a))) {
          log(`w${w} ${unit}: ${arm} setup (${files.length} files)`);
          setups[arm] = await setupArm(arm, root, files, unitItems[0], wrappers);
          append('setups.jsonl', { unit, arm, build_ms: setups[arm].build_ms, files: setups[arm].files, corpus_files: files.length });
          log(`w${w} ${unit}: ${arm} ready in ${(setups[arm].build_ms / 1000).toFixed(0)} s`);
        }
      });
      for (const p of todo as any[]) {
        if (halted) break;
        const it = unitItems.find((i) => i.id === p.item)!;
        const su = setups[p.arm];
        for (let attempt = attempts(p.run_id) + 1; canTry(p.run_id) && !halted; attempt++) {
          let acctName = pool.current();
          while (!acctName && !halted) { log(`w${w}: all accounts at their limit; waiting 20 min`); await sleep(20 * 60_000); acctName = pool.current(); }
          if (!acctName) break;
          const acct = pool.info(acctName);
          const safe = p.run_id.replace(/[^A-Za-z0-9_.-]+/g, '_') + (attempt > 1 ? `_try${attempt}` : '');
          let mockSrv: Awaited<ReturnType<typeof startMockServer>> | null = null;
          let usageLimited = false;
          let runTmp: string | null = null;
          let initSkills: { skills: string[]; slash: string[] } | null = null;
          try {
            su.reset(); // every run starts like a new session: no hook counters or query stamps from earlier runs
            if (MOCK) {
              const limited = (process.env.EXP11_MOCK_LIMIT_ACCOUNTS ?? '').split(',').includes(acctName);
              mockSrv = await startMockServer({ logFile: path.join(OUT, 'transcripts', `${safe}.mock.jsonl`), policy: limited ? { kind: 'fault', status: 429, error_type: 'rate_limit_error', message: 'Claude AI usage limit reached|resets 9pm' } : { kind: 'scripted', steps: mockSteps(p.arm, it, su.mcp) } });
            }
            runTmp = fs.mkdtempSync('/tmp/x11-'); // short: the sandbox's bridge sockets live under TMPDIR (socket paths are limited to ~100 bytes)
            const pathEnv = [...su.pathPrefix, path.dirname(CLAUDE_BIN), path.dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
            const spec = buildClaudeCommand({
              protocol: 'agentic', profile: 'project-oauth', model: MODEL, cwd: su.ws, mcp: su.mcp, systemPrompt: TASK_SYSTEM_PROMPT[TASK], jsonSchema: TASK === 'T3' ? T3_SCHEMA : ANSWER_SCHEMA,
              mcpConfigPath: path.join(mcpDir, `${safe}.json`), mockUrl: mockSrv?.url, maxTurns: MAX_TURNS, maxBudgetUsd: runUsd, effort: EFFORT, billing: 'subscription', baseEnv: acct?.env,
              sandbox: sandboxFor(su.ws, runTmp, su.toolPaths), path: pathEnv, claudeBin: CLAUDE_BIN,
              extraEnv: { ...su.extraEnv, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', TMPDIR: runTmp, PYTHONDONTWRITEBYTECODE: '1' },
              // Positive control of the leak check (mock only): user-level settings, CLAUDE.md and skills switched back on.
              ...(MOCK && process.env.EXP11_POSITIVE_CONTROL === '1' ? { extraArgs: ['--setting-sources', 'user,project,local'] } : {}),
            });
            let mismatch: string[] = [];
            const tools = [...PROJECT_TOOLS, 'Bash'];
            const r = await runClaude(spec, it.prompt, { run_id: p.run_id, task_id: it.id, condition: `exp11:${TASK}:${p.arm}`, repeat: p.repeat, model: MODEL, workspace_hash: sha(su.ws).slice(0, 12) }, {
              guard: pool.guard(acctName), timeoutMs: TIMEOUT_S * 1000, transcriptPath: path.join(OUT, 'transcripts', `${safe}.jsonl`),
              afterResultGraceMs: 15_000, // E11-D03: a process lingering after its result is stopped; the result is used
              onInit: (init) => {
                const own = ARM_SKILLS[p.arm];
                const forbidden = [...new Set([...OWNER_SKILLS, ...Object.values(ARM_SKILLS).flat()])].filter((k) => !own.includes(k));
                initSkills = { skills: init?.skills ?? [], slash: init?.slash_commands ?? [] };
                const m = checkInit(init, { mcp: su.mcp, model: MODEL, version, mock: MOCK, billing: 'subscription', project: { tools, required: own, forbidden } });
                mismatch = m.details;
                if (MOCK && process.env.EXP11_POSITIVE_CONTROL === '1') return null; // let the request-level detector see the leak
                if (MOCK && process.env.EXP11_FORCE_INIT_MISMATCH === '1') return 'forced'; // test of the abort path (mock only)
                return m.categories.length ? m.categories.join(',') : null;
              },
              shouldAbort: () => halted,
            });
            // Fail closed: a run in which Bash was not sandboxed stops the experiment (failIfUnavailable should prevent it).
            const unsandboxed = /Sandbox disabled|WITHOUT sandboxing|Sandboxing is disabled|Sandbox is enabled but failed|Refusing to start without a working sandbox/;
            if (unsandboxed.test(r.detail.stderr_tail ?? '') || unsandboxed.test(r.raw)) {
              append('excluded.jsonl', { run_id: p.run_id, item: it.id, arm: p.arm, attempt, account: label(acctName), excluded: 'infra_error:sandbox', excluded_kind: 'infra_error', retryable: false, detail: 'Bash sandbox not active' });
              halted = `Bash sandbox not active in ${p.run_id}`; log(halted); break;
            }
            const changed = wsChanges(su.ws);
            const ps = parseStreamJson(r.raw);
            const raw = ps.result?.structured_output ?? ps.lastStructured ?? null;
            const oc = r.outcome;
            if (oc.status === 'infra_error' || oc.status === 'init_mismatch' || oc.status === 'aborted') {
              const ex = { run_id: p.run_id, item: it.id, arm: p.arm, attempt, account: label(acctName), excluded: oc.status === 'infra_error' ? `infra_error:${oc.infra_kind}` : oc.status, excluded_kind: oc.status, retryable: oc.status !== 'init_mismatch', detail: [oc.reason, ...mismatch, oc.text].filter(Boolean).join(' | ').slice(0, 600), cost_ledger_usd: r.cost.ledger };
              append('excluded.jsonl', ex); excl.push(ex);
              if (oc.infra_kind === 'limit') { pool.exhausted(acctName, oc.text ?? oc.reason ?? 'limit'); usageLimited = true; attempt--; continue; }
              log(`w${w} ${p.run_id} EXCLUDED ${ex.excluded} ${ex.detail.slice(0, 200)}`);
              if (oc.infra_kind === 'auth') { halted = `auth (${label(acctName)}): ${(oc.text ?? oc.reason ?? '').slice(0, 200)}`; break; }
              if (oc.status === 'init_mismatch') { halted = `init mismatch: ${mismatch.join('; ')}`; break; }
              if (oc.status !== 'aborted' && ++infraStreak >= 3 * WORKERS) { halted = 'repeated infrastructure errors'; break; }
              continue;
            }
            infraStreak = 0;
            const score = scoreItem(index, it, raw);
            const u = r.run.usage;
            const calls = ps.toolCalls;
            const toolUse = p.arm === 'G0' ? null : p.arm === 'GF' ? calls.some((c) => (c.name === 'Bash' && /(^|[\s;&|(`$])graphify\s+\w|graphify-out\//.test(String(c.input?.command ?? ''))) || (['Read', 'Grep', 'Glob'].includes(c.name) && /graphify-out/.test(JSON.stringify(c.input ?? {})))) : calls.some((c) => c.name.startsWith('mcp__'));
            const rec = {
              run_id: p.run_id, item: it.id, task: TASK, repo: it.repo, language: it.language, arm: p.arm, repeat: p.repeat, attempt, model: MODEL, effort: EFFORT, set: SET,
              account: pool.record(acctName), worker: w, status: raw ? 'submitted' : oc.status, turns: r.run.turns, tool_calls: r.run.tool_calls,
              usage: u, total_tokens: u ? u.input + u.output + u.cache_read + u.cache_write : null,
              cost_reported_usd: r.cost.reported, cost_list_usd: r.cost.list, cost_ledger_usd: r.cost.ledger, wall_ms: r.timing.wall_ms, api_ms: r.detail.duration_api_ms, session_ms: ps.result?.duration_ms ?? null,
              used_tool: toolUse, skills_invoked: calls.filter((c) => c.name === 'Skill').map((c) => String(c.input?.skill ?? c.input?.name ?? '')),
              bash_commands: calls.filter((c) => c.name === 'Bash').map((c) => String(c.input?.command ?? '').slice(0, 300)),
              mcp_calls: calls.filter((c) => c.name.startsWith('mcp__')).map((c) => c.name.split('__').pop()),
              files_read: new Set(calls.filter((c) => c.name === 'Read').map((c) => String(c.input?.file_path ?? ''))).size,
              answer: TASK === 'T3' ? parseT3Answer(raw) : parseAnswer(raw), score, claude_version: version, mock: MOCK, setup_build_ms: su.build_ms,
              workspace_changes: changed.slice(0, 20), workspace_changed: changed.length, init_skills: initSkills, lingered: !!r.timing.lingered, close_ms: r.timing.close_ms,
            };
            append('runs.jsonl', rec); done.add(p.run_id);
            log(`w${w} ${p.run_id} [${label(acctName)}] ${rec.status} turns=${rec.turns} tok=${rec.total_tokens} used=${toolUse} ${TASK === 'T3' ? '' : `primary=${(score as any).primary?.toFixed(2)}`}`);
            break;
          } catch (e) {
            if (e instanceof BillableRefused) { halted = e.message; break; }
            const ex = { run_id: p.run_id, item: it.id, arm: p.arm, attempt, account: label(acctName), excluded: 'infra_error:harness', excluded_kind: 'infra_error', retryable: true, detail: String((e as Error).stack ?? e).slice(0, 600) };
            append('excluded.jsonl', ex); excl.push(ex);
            log(`w${w} ${p.run_id} harness error: ${(e as Error).message}`);
            if (++infraStreak >= 3 * WORKERS) { halted = 'repeated infrastructure errors'; break; }
          } finally {
            await mockSrv?.close();
            if (runTmp) fs.rmSync(runTmp, { recursive: true, force: true });
            wsRestore(su.ws);
            su.reset();
            if (wsState(su.ws) !== su.state) {
              const now = new Set(wsManifest(su.ws)), was = new Set(su.manifest);
              const diff = [...[...now].filter((x) => !was.has(x)).map((x) => `+${x.split('\0')[0]}`), ...[...was].filter((x) => !now.has(x)).map((x) => `-${x.split('\0')[0]}`)].slice(0, 12);
              halted = `workspace could not be restored after ${p.run_id}: ${diff.join(' ')}`; log(halted);
            }
          }
          if (usageLimited) continue;
        }
      }
    } catch (e) {
      log(`w${w} ${unit}: setup failed: ${(e as Error).message.slice(0, 400)}`);
      append('excluded.jsonl', { run_id: `${unit}|setup`, item: unit, excluded: 'infra_error:setup', excluded_kind: 'infra_error', retryable: true, detail: String((e as Error).message).slice(0, 900) });
    } finally {
      // E10-D06: every index is rebuilt per unit and never read after it.
      for (const su of Object.values(setups)) for (const d of [path.dirname(su.ws), ...su.dirs]) fs.rmSync(d, { recursive: true, force: true });
      if (snapRoot) fs.rmSync(snapRoot, { recursive: true, force: true });
    }
  }

  let next = 0;
  const worker = async (w: number) => {
    await sleep((w - 1) * 15_000);
    while (!halted && next < units.length) {
      while (memFreeGb() < MIN_FREE_GB && !halted) await sleep(30_000);
      if (halted || next >= units.length) break;
      await runUnit(units[next++], w);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, WORKERS) }, (_, i) => worker(i + 1)));
  fs.rmSync(mcpDir, { recursive: true, force: true });
  const runs = readJsonl(path.join(OUT, 'runs.jsonl'));
  writeMeta(halted ? 'halted' : runs.length >= plan.length ? 'completed' : 'incomplete', { halted, n_plan: plan.length, n_scored: runs.length, ledger_usd: runs.reduce((s, r) => s + (r.cost_ledger_usd ?? 0), 0) });
  log(`${halted ? `HALTED: ${halted}` : 'finished'}: ${runs.length}/${plan.length} scored`);
  if (halted) process.exitCode = 3;
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });
