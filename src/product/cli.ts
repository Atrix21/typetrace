#!/usr/bin/env tsx
/**
 * TypeTrace: the retrieval tool benchmarked in experiments/03-graph-scale, packaged for use.
 *
 *   typetrace init      [repo] [--client auto|all|none|ids] [--include src,lib] [--wait] [--no-embed]
 *   typetrace index     [repo] [--include src,lib] [--no-embed]      rebuild everything in the foreground
 *   typetrace status    [repo]                                       what is indexed, what is still running
 *   typetrace query     <repo> "<question>"                          print what the agent would see
 *   typetrace serve     [repo]                                       MCP server (stdio): find_relevant_code
 *   typetrace install   [repo] [--client ...] [--dry-run] [--no-setup] register the server with AI coding tools
 *   typetrace uninstall [repo] [--client ...] [--dry-run]
 *
 * First index: `init` builds the call graph and the keyword index (minutes), registers the server and returns. The
 * embeddings are computed by a background job at low priority; until they are complete, each code chunk without a
 * vector simply has no semantic score, so search starts as keywords + call graph (benchmarked as compact_graph_lex)
 * and becomes the benchmarked tool (compact_graph) when the job finishes. The server picks up each batch by itself.
 *
 * Updates: the server rescans the indexed files every TYPETRACE_POLL_MS (15 s). After edits settle it rebuilds the
 * graph in a background job, then embeds only the changed code. Queries never wait: the previous index answers until
 * the new one is loaded. The two jobs never run at the same time (the embedding job pauses between batches).
 *
 * Indexes live in ~/.cache/typetrace/<hash of repo path>/ (TYPETRACE_CACHE); see index-state.ts for the layout. The
 * repository itself is only written by `init`/`install`: the tools' MCP configuration files and, for Claude Code, the
 * setup in claude-setup.ts (a CLAUDE.md block, a skill and a soft hook; `--no-setup` skips it).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { abs, PROJECT_ROOT } from '../config.js';
import { REGISTRY } from '../evaluation/methods.js';
import { countTokens } from '../evaluation/token-accounting.js';
import { buildGraph } from '../graph/graph-builder.js';
import { loadGraph, saveGraph } from '../graph/graph-store.js';
import { EXP3_TOOL_DESCRIPTION, EXP3_TOOL_NAME, EXP3_TOOL_SCHEMA } from '../agent-eval/exp3/tool-def.js';
import { Embedder, EmbeddingPaused, EmbeddingRetriever, ONNX_EMBEDDING } from '../retrieval/embeddings.js';
import { grammarLanguages, initLanguages } from '../languages/registry.js';
import { languageSummary } from './source-files.js';
import { PersistentQueryEmbedder } from '../agent-eval/mcp/retrieval-server.js';
import { primeGraphCache } from '../retrieval/graph-retrieval.js';
import { applyClients, CLIENTS, describe, selectClients, SERVER_NAME, type Launch } from './clients.js';
import { applyClaudeSetup, describeSetup } from './claude-setup.js';
import { changesSince, DeclIndex, overview, readSnapshots, readWorklog, recentWork } from './continuity.js';
import type { GraphEdge, GraphNode } from '../graph/graph-schema.js';
import {
  clearGraphWanted, diffManifest, embedProgress, findIndexedRepo, graphWanted, jobRunning, paths, readManifest, readMeta,
  requestGraph, scan, spawnJob, tryLock, unlock, writeManifest, writeMeta, type IndexMeta, type Manifest,
} from './index-state.js';
import type { Corpus, RetrievalMethod } from '../types.js';
import { spawn } from 'node:child_process';

const BUDGET = { maxResults: 50, maxContextTokens: 8000 };
const VALUE_OPTS = new Set(['include', 'client', 'job', 'max-package-decl-mb']);
const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (k: string) => argv.includes(`--${k}`);
// Only options that take a value consume the next argument (`init --gpu .` keeps the repository).
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && VALUE_OPTS.has(argv[i - 1].slice(2))));
const err = (s: string) => process.stderr.write(s + '\n');
// Product default: Python-free ONNX embeddings; --gpu switches to the PyTorch backend the benchmarks used.
process.env.TYPETRACE_EMBED_BACKEND ??= flag('gpu') ? 'python' : 'onnx';
// The embedding model (~2.4 GB) is cached outside the package, so npx/npm reinstalls never download it again.
process.env.TYPETRACE_MODEL_DIR ??= path.join(os.homedir(), '.cache', 'typetrace', 'models');
const PKG: { name: string; version: string } = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const FROM_NPM = PROJECT_ROOT.split(path.sep).includes('node_modules');
const BIN = path.join(PROJECT_ROOT, 'bin', 'typetrace.js');
const POLL_MS = Number(process.env.TYPETRACE_POLL_MS ?? 15_000);
const QUIET_MS = Number(process.env.TYPETRACE_QUIET_MS ?? 10_000); // edits must settle this long before a rebuild
const RELOAD_MIN_MS = Number(process.env.TYPETRACE_RELOAD_MIN_MS ?? 600_000); // partial-embedding reloads at most this often

const ago = (iso?: string) => { if (!iso) return 'never'; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 90 ? `${Math.round(s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${(s / 3600).toFixed(1)} h ago` : `${Math.round(s / 86400)} days ago`; };
const dur = (s: number) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

// ---- building ----

/** Call graph + manifest + index.json. Keyword search needs nothing else (it is built from the files when loaded). */
async function buildGraphIndex(repo: string, include: string[], quiet = false) {
  const t0 = performance.now();
  const { files, manifest } = scan(repo, include);
  if (!files.length) throw new Error(`no supported source files in ${repo}${include.join('') ? ` under ${include.join(', ')}` : ''} (TypeScript, JavaScript, Python, Go, Java, Kotlin, Scala, C#, Rust, C, C++, Ruby, PHP, Swift)`);
  if (!quiet) err(`found ${files.length} files: ${languageSummary(files)}\nbuilding the code graph…`);
  await initLanguages(grammarLanguages(files));
  const mb = opt('max-package-decl-mb');
  const g = buildGraph({ repoRoot: repo, files, maxPackageDeclarationBytes: mb !== undefined ? Number(mb) * 1e6 : files.length > 5000 ? 0 : 50e6 });
  const P = paths(repo);
  const next = `${P.graph}.next`;
  saveGraph(next, { nodes: g.nodes, edges: g.edges, coverage: g.coverage, stats: g.stats, meta: { repo, files: files.length, build_ms: g.build_ms } });
  fs.renameSync(next, P.graph); // a server loading at this moment sees the old graph or the new one, never half of one
  writeManifest(repo, manifest);
  const meta = writeMeta(repo, { repo, include, files: files.length, nodes: g.nodes.length, edges: g.edges.length, graph_build_ms: Math.round(performance.now() - t0), graph_at: new Date().toISOString() });
  if (!quiet) err(`graph: ${g.nodes.length} nodes, ${g.edges.length} edges in ${(g.build_ms / 1000).toFixed(1)} s`);
  return meta;
}

/** Load the embedding model once, downloading it on first use (~2.4 GB). Progress = growth of the model directory. */
async function ensureModel() {
  const dir = process.env.TYPETRACE_MODEL_DIR!;
  err('checking the embedding model (Qwen3-Embedding-0.6B, runs locally)…');
  const child = spawn(process.execPath, [abs(ONNX_EMBEDDING.script), '--download'], { stdio: ['ignore', 'ignore', 'pipe'], env: process.env });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const size = (d: string): number => { if (!fs.existsSync(d)) return 0; let n = 0; for (const f of fs.readdirSync(d, { recursive: true }) as string[]) { try { const st = fs.statSync(path.join(d, f)); if (st.isFile()) n += st.size; } catch { /* in flux */ } } return n; };
  const before = size(dir);
  let shown = false;
  const timer = setInterval(() => {
    const got = size(dir) - before;
    if (got < 5e6) return;
    shown = true;
    process.stderr.write(`\r  downloading the model (first run only): ${(got / 1e9).toFixed(2)} of ~2.4 GB   `);
  }, 1000);
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  clearInterval(timer);
  if (shown) process.stderr.write('\n');
  if (code !== 0) throw new Error(`could not load the embedding model:\n${stderr.slice(-2000)}`);
}

/** Embed every chunk that has no cached vector yet. In a background job: smaller batches, progress, pausable. */
async function embedAll(repo: string, job: boolean) {
  if (process.env.TYPETRACE_EMBED_BACKEND === 'onnx') await ensureModel();
  Embedder.showProgress = true;
  Embedder.cachedOnly = false;
  if (job) {
    Embedder.EMBED_BATCH_ITEMS = 2000; // a pending graph rebuild waits at most one batch
    Embedder.onBatch = () => writeMeta(repo, { vectors_at: new Date().toISOString() });
    Embedder.shouldPause = () => graphWanted(repo);
  }
  const t = performance.now();
  await openIndex(repo, { embed: true });
  const now = new Date().toISOString();
  writeMeta(repo, { vectors_at: now, embedded_at: now });
  err(`semantic search ready (${((performance.now() - t) / 1000).toFixed(0)} s)`);
}

// ---- loading (read-only) ----

interface Loaded { m: RetrievalMethod & { prewarmQuery?(q: string): Promise<void>; coverage?: { covered: number; total: number } }; files: string[]; meta: IndexMeta; nodes: GraphNode[]; edges: GraphEdge[] }

/**
 * Open the index of `repo`. Default (server, query): read-only, cached vectors only. With `embed`, missing vectors
 * are computed (foreground `index` and the embedding job).
 */
async function openIndex(repo: string, o: { embed?: boolean; queryEmbedder?: PersistentQueryEmbedder | null } = {}): Promise<Loaded> {
  const P = paths(repo);
  const meta = readMeta(repo);
  if (!fs.existsSync(P.graph) || !meta) throw new Error(`no index for ${repo}; run: typetrace init ${JSON.stringify(repo)}`);
  const manifest = readManifest(repo);
  // The files the graph was built from (minus any deleted since), so keyword search and the graph agree.
  const files = manifest ? Object.keys(manifest).filter((f) => fs.existsSync(path.join(repo, f))) : scan(repo, meta.include).files;
  await initLanguages(grammarLanguages(files));
  const corpus: Corpus = { repoRoot: repo, commit: 'local', files, cacheDir: P.retrieval };
  fs.mkdirSync(corpus.cacheDir, { recursive: true });
  const graph = loadGraph(P.graph);
  primeGraphCache(corpus, { nodes: graph.nodes, edges: graph.edges, build_ms: 0, cached: true });
  EmbeddingRetriever.embeddingCacheDir = P.embeddings;
  Embedder.cachedOnly = !o.embed;
  EmbeddingRetriever.defaultQueryEmbedder = o.queryEmbedder ?? null;
  const m = (await REGISTRY.compact_graph()) as Loaded['m'];
  await m.prepare(corpus);
  return { m, files, meta, nodes: graph.nodes as GraphNode[], edges: graph.edges as GraphEdge[] };
}

// ---- working across sessions (0.4): tools beside find_relevant_code ----

export const CONTINUITY_TOOLS = [
  { name: 'recent_work', description: 'What earlier sessions in this repository searched for, read and edited, with the functions involved, most recent first. Use it when continuing earlier work.', inputSchema: { type: 'object', properties: { sessions: { type: 'number', description: 'How many sessions (default 3)' } } } },
  { name: 'changes_since_last_session', description: 'Files and functions that changed since the previous session ended, and the code that calls them.', inputSchema: { type: 'object', properties: {} } },
  { name: 'codebase_overview', description: 'A map of this codebase from its call graph: its areas with their size and languages, the most-called functions and the entry points.', inputSchema: { type: 'object', properties: { under: { type: 'string', description: 'Only this folder (e.g. src/server)' } } } },
] as const;

function continuityAnswer(repo: string, l: Loaded, name: string, args: Record<string, unknown>): string {
  const dir = paths(repo).dir;
  if (name === 'recent_work') return recentWork(readWorklog(dir), new DeclIndex(l.nodes), { sessions: Math.min(10, Math.max(1, Number(args.sessions) || 3)) });
  if (name === 'codebase_overview') return overview(l.files, l.nodes, l.edges, { under: typeof args.under === 'string' ? args.under : undefined });
  return changesSince(repo, readSnapshots(dir), scan(repo, l.meta.include).manifest, new DeclIndex(l.nodes), l.nodes, l.edges);
}

/** A vector cache with content means the model has been downloaded and query vectors can be computed. */
const hasVectorCache = (repo: string) => { try { return fs.statSync(path.join(paths(repo).embeddings, 'vectors.jsonl')).size > 0; } catch { return false; } };

function startQueryEmbedder(): PersistentQueryEmbedder {
  const e = new PersistentQueryEmbedder();
  for (const sig of ['SIGINT', 'SIGTERM', 'exit'] as const) process.on(sig, () => { try { e.close(); } catch { /* */ } if (sig !== 'exit') process.exit(0); });
  return e;
}

/** Human-readable state of the semantic part of the index. */
function embeddingState(repo: string, meta: IndexMeta): string {
  if (meta.embeddings === 'off') return 'off (keyword + call-graph search only; `typetrace index` turns it on)';
  const pid = jobRunning(repo, 'embed');
  if (pid) {
    const p = embedProgress(repo);
    let started = Date.now();
    try { started = fs.statSync(path.join(paths(repo).jobs, 'embed.lock')).mtimeMs; } catch { /* */ }
    const el = (Date.now() - started) / 1000;
    const left = p && p.done > 0 ? ((p.total - p.done) * el) / p.done : null;
    return p ? `embedding in the background: ${p.done.toLocaleString()} of ${p.total.toLocaleString()} code chunks${left !== null ? `, about ${dur(left)} left` : ''} (pid ${pid})`
      : `starting the embedding job (loading or downloading the model; pid ${pid})`;
  }
  if (meta.embedded_at && (!meta.graph_at || meta.embedded_at >= meta.graph_at)) return `complete (${ago(meta.embedded_at)})`;
  if (graphWanted(repo) || jobRunning(repo, 'graph')) return 'paused while the graph is rebuilt; resumes by itself';
  return meta.embedded_at || hasVectorCache(repo) ? 'partly done: the server finishes it in the background (or run `typetrace index`)' : 'not started: the server starts it (or run `typetrace index`)';
}

// ---- commands ----

/** TYPETRACE_LAUNCH: a JSON array, the command (and leading arguments) that starts TypeTrace; `serve ...` is appended. */
function launchOverride(): string[] | null {
  const raw = process.env.TYPETRACE_LAUNCH;
  if (!raw) return null;
  try { const v = JSON.parse(raw); if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' && x)) return v; } catch { /* below */ }
  throw new Error(`TYPETRACE_LAUNCH must be a JSON array of strings, e.g. ["uvx", "typetrace==${VERSION}"]; got ${raw}`);
}

const launchFor = (repo: string) => (pinned: boolean): Launch => {
  const tail = ['serve', ...(pinned ? [repo] : []), ...(flag('gpu') ? ['--gpu'] : [])];
  // Started by another installer (the PyPI package `typetrace` sets TYPETRACE_LAUNCH, e.g. ["uvx", "typetrace==0.3.2"]):
  // the tools launch the server the same way, so a machine without Node on its PATH works too.
  const custom = launchOverride();
  if (custom) return { command: custom[0], args: [...custom.slice(1), ...tail] };
  // Installed from npm: launch through npx (stable across npx cache clean-ups and Node upgrades). From source: this checkout.
  return FROM_NPM ? { command: 'npx', args: ['-y', `${PKG.name}@${VERSION}`, ...tail] } : { command: process.execPath, args: [BIN, ...tail] };
};

function install(repo: string, remove = false) {
  const clients = selectClients(opt('client') ?? (remove ? 'all' : 'auto'));
  if (!clients.length) { err('no clients selected'); return []; }
  const changes = applyClients(repo, clients, launchFor(repo), { dryRun: flag('dry-run'), remove });
  // Claude Code also gets its setup (instructions, skill, soft hook) unless --no-setup; uninstall always removes it.
  const setup = clients.some((c) => c.id === 'claude') && (remove || !flag('no-setup')) ? applyClaudeSetup(repo, { dryRun: flag('dry-run'), remove }) : [];
  err(`${flag('dry-run') ? 'would change (dry run, nothing written)' : remove ? 'removed TypeTrace from' : 'registered TypeTrace with'}:\n${[...changes.map((c) => describe(repo, c)), ...setup.map((c) => describeSetup(repo, c))].join('\n')}`);
  return changes;
}

async function init(repo: string) {
  if (jobRunning(repo, 'graph') || jobRunning(repo, 'embed')) throw new Error(`a background job is updating the index of ${repo}; wait for it (typetrace status) and retry`);
  const include = opt('include')?.split(',') ?? [''];
  const off = flag('no-embed');
  await buildGraphIndex(repo, include);
  writeMeta(repo, { embeddings: off ? 'off' : 'auto' });
  const changes = install(repo);
  const names = changes.filter((c) => ['added', 'updated', 'unchanged'].includes(c.action)).map((c) => c.client.name);
  if (off) err('\nsearch: keywords + call graph (--no-embed).');
  else if (flag('wait')) await embedAll(repo, false);
  else {
    spawnJob(repo, 'embed', BIN, flag('gpu') ? ['--gpu'] : []);
    err(`\nready now: keyword and call-graph search.\nsemantic search is being added in the background at low priority (the first run downloads a 2.4 GB model; on a CPU this takes minutes for small repositories and hours for very large ones).\nThe server switches over by itself. Progress: typetrace status ${JSON.stringify(repo)}`);
  }
  err(`\nnext: restart ${names.join(', ') || 'your MCP client'} in ${repo} and approve the "${SERVER_NAME}" server.\ntry it here first:  typetrace query ${JSON.stringify(repo)} "where is <something> handled?"`);
}

async function index(repo: string) {
  const job = opt('job');
  if (job === 'graph') {
    if (!tryLock(repo, 'graph')) return err('graph job already running');
    try { clearGraphWanted(repo); const meta = readMeta(repo); err(`[${new Date().toISOString()}] graph job`); await buildGraphIndex(repo, meta?.include ?? [''], false); } finally { unlock(repo, 'graph'); }
    return;
  }
  if (job === 'embed') {
    if (jobRunning(repo, 'graph') || graphWanted(repo) || !tryLock(repo, 'embed')) return err('embedding job not started: another job is running');
    err(`[${new Date().toISOString()}] embedding job`);
    try { await embedAll(repo, true); } catch (e) {
      if (e instanceof EmbeddingPaused) { err(`paused for a graph rebuild at ${e.done}/${e.total}; it resumes from there`); process.exitCode = 3; } else throw e;
    } finally { unlock(repo, 'embed'); }
    return;
  }
  const include = opt('include')?.split(',') ?? readMeta(repo)?.include ?? [''];
  if (jobRunning(repo, 'graph') || jobRunning(repo, 'embed')) throw new Error('a background job is updating this index; wait for it (typetrace status) and retry');
  await buildGraphIndex(repo, include);
  const off = flag('no-embed');
  writeMeta(repo, { embeddings: off ? 'off' : 'auto' });
  if (!off) await embedAll(repo, false);
  err(`index: ${paths(repo).dir}`);
}

function status(repo: string) {
  const meta = readMeta(repo);
  if (!meta || !fs.existsSync(paths(repo).graph)) { err(`${repo} is not indexed. Run: typetrace init ${JSON.stringify(repo)}`); process.exitCode = 1; return; }
  const before = readManifest(repo) ?? {};
  const { manifest } = scan(repo, meta.include);
  const d = diffManifest(before, manifest);
  const changed = d.added.length + d.changed.length + d.removed.length;
  const graphJob = jobRunning(repo, 'graph');
  const registered = CLIENTS.filter((c) => { try { const f = c.file(repo); return fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes(`${SERVER_NAME}`); } catch { return false; } }).map((c) => c.name);
  err([
    `TypeTrace index of ${repo}`,
    `  files:            ${meta.files.toLocaleString()}${meta.include.join('') ? ` (under ${meta.include.join(', ')})` : ''}`,
    `  call graph:       ${meta.nodes.toLocaleString()} nodes, ${meta.edges.toLocaleString()} edges, built ${ago(meta.graph_at)}`,
    `  since then:       ${changed ? `${changed} file${changed > 1 ? 's' : ''} changed${graphJob ? `; rebuilding now (pid ${graphJob})` : '; the server rebuilds after edits settle'}` : 'no changes'}`,
    `  semantic search:  ${embeddingState(repo, meta)}`,
    `  registered with:  ${registered.join(', ') || 'none (typetrace install)'}`,
    `  stored in:        ${paths(repo).dir}`,
  ].join('\n'));
}

async function query(repo: string, q: string) {
  const qe = hasVectorCache(repo) ? startQueryEmbedder() : null;
  const { m, meta } = await openIndex(repo, { queryEmbedder: qe });
  await qe?.ready;
  await m.prewarmQuery?.(q);
  const out = await m.retrieve({ task_id: 'cli', query: q }, BUDGET);
  const text = out.context?.trim() ? out.context : 'No results.';
  process.stdout.write(text + '\n');
  const cov = m.coverage;
  const notes = [`${countTokens(text)} tokens`];
  if (cov && cov.covered < cov.total && meta.embeddings !== 'off') notes.push(`semantic search covers ${Math.floor((100 * cov.covered) / Math.max(1, cov.total))}% of the code so far; the rest is found by keywords and the call graph`);
  err(`(${notes.join('; ')})`);
}

async function serve(repoArg: string | undefined) {
  console.log = console.error; // stdout belongs to the MCP transport
  const repo = repoArg ? path.resolve(repoArg) : findIndexedRepo(process.cwd()) ?? process.cwd();
  const indexed = () => fs.existsSync(paths(repo).graph) && !!readMeta(repo);
  let qe: PersistentQueryEmbedder | null = null;
  let current: Promise<Loaded> | null = null;
  let loadedMeta: IndexMeta | null = null;
  let reloading = false;
  let lastReload = 0;

  // Answer the MCP handshake at once and load in the background: large repositories take a minute to load, longer
  // than an MCP client waits for a server to start. Tool calls wait for the first load.
  const load = async (): Promise<Loaded> => {
    if (!qe && hasVectorCache(repo) && readMeta(repo)?.embeddings !== 'off') qe = startQueryEmbedder();
    const l = await openIndex(repo, { queryEmbedder: qe });
    if (qe) await qe.ready;
    return l;
  };
  if (indexed()) { current = load(); current.then((l) => { loadedMeta = l.meta; lastReload = Date.now(); }, (e) => err(`typetrace: ${(e as Error).message}`)); }
  const reload = () => {
    if (reloading) return;
    reloading = true;
    load().then((l) => { current = Promise.resolve(l); loadedMeta = l.meta; lastReload = Date.now(); err(`typetrace: index reloaded (${l.files.length} files)`); },
      (e) => err(`typetrace: reload failed, keeping the previous index: ${(e as Error).message}`)).finally(() => { reloading = false; });
  };

  // ---- automatic updates ----
  let lastSig = '', lastChange = 0, lastGraphJob = 0, lastEmbedSpawn = 0, scanning = false;
  let scanMs = 0;
  const tick = () => {
    if (scanning || !indexed()) return;
    if (!current) { current = load(); current.then((l) => { loadedMeta = l.meta; lastReload = Date.now(); }, (e) => err(`typetrace: ${(e as Error).message}`)); return; } // indexed after the server started
    scanning = true;
    try {
      const meta = readMeta(repo)!;
      // 1. A job finished something: load it (partial embeddings at most every RELOAD_MIN_MS; completion at once).
      if (loadedMeta && !reloading) {
        const graphNew = meta.graph_at !== loadedMeta.graph_at;
        const doneNew = meta.embedded_at !== loadedMeta.embedded_at;
        const vecNew = meta.vectors_at !== loadedMeta.vectors_at && Date.now() - lastReload >= RELOAD_MIN_MS;
        if (graphNew || doneNew || vecNew) reload();
      }
      // 2. Edits: rebuild the graph once the files have stopped changing for QUIET_MS.
      const t0 = performance.now();
      const { manifest } = scan(repo, meta.include);
      scanMs = performance.now() - t0;
      const sig = JSON.stringify(manifest);
      if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
      const d = diffManifest(readManifest(repo) ?? ({} as Manifest), manifest);
      const dirty = d.added.length + d.changed.length + d.removed.length > 0;
      const graphPid = jobRunning(repo, 'graph'), embedPid = jobRunning(repo, 'embed');
      const minGap = Math.max(30_000, 2 * (meta.graph_build_ms ?? 0));
      if (dirty && !graphPid && Date.now() - lastChange >= QUIET_MS && Date.now() - lastGraphJob >= minGap) {
        if (embedPid) requestGraph(repo); // the embedding job stops after its batch; the next tick starts the rebuild
        else { lastGraphJob = Date.now(); spawnJob(repo, 'graph', BIN); err(`typetrace: ${d.added.length + d.changed.length + d.removed.length} files changed, rebuilding the index in the background`); }
      }
      // 3. Embeddings: missing ones are computed in the background (retry at most every 10 min after a failure).
      const needEmbed = meta.embeddings !== 'off' && (!meta.embedded_at || (meta.graph_at && meta.embedded_at < meta.graph_at));
      if (needEmbed && !dirty && !graphPid && !embedPid && !graphWanted(repo) && Date.now() - lastEmbedSpawn >= 600_000) {
        lastEmbedSpawn = Date.now();
        spawnJob(repo, 'embed', BIN, flag('gpu') ? ['--gpu'] : []);
      }
    } catch (e) { err(`typetrace: update check failed: ${(e as Error).message}`); } finally { scanning = false; }
  };
  // A rescan stats every indexed file; on very large repositories it runs less often so it never crowds out queries.
  const schedule = (ms: number) => setTimeout(() => { tick(); schedule(Math.max(POLL_MS, 50 * scanMs)); }, ms).unref();
  if (!flag('no-watch') && process.env.TYPETRACE_AUTO_UPDATE !== '0') schedule(Math.min(POLL_MS, 2000));

  let chain: Promise<unknown> = Promise.resolve();
  const server = new Server({ name: SERVER_NAME, version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: EXP3_TOOL_NAME, description: EXP3_TOOL_DESCRIPTION, inputSchema: EXP3_TOOL_SCHEMA as never }, ...CONTINUITY_TOOLS.map((t) => ({ ...t, inputSchema: t.inputSchema as never }))] }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (CONTINUITY_TOOLS.some((t) => t.name === req.params.name)) {
      if (!current) return { isError: true, content: [{ type: 'text' as const, text: `TypeTrace has no index for ${repo}. Ask the user to run: npx typetrace-cli init ${JSON.stringify(repo)}` }] };
      try { return { content: [{ type: 'text' as const, text: continuityAnswer(repo, await current, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>) }] }; }
      catch (e) { return { isError: true, content: [{ type: 'text' as const, text: `${req.params.name} failed: ${(e as Error).message}` }] }; }
    }
    const q = (req.params.arguments as { query?: unknown } | undefined)?.query;
    if (req.params.name !== EXP3_TOOL_NAME || typeof q !== 'string' || !q.trim()) return { isError: true, content: [{ type: 'text' as const, text: 'Invalid call: "query" must be a non-empty string.' }] };
    if (!current) return { isError: true, content: [{ type: 'text' as const, text: `TypeTrace has no index for ${repo}. Ask the user to run: npx typetrace-cli init ${JSON.stringify(repo)}` }] };
    // The Claude Code hook stays quiet while this is recent (claude-setup.ts).
    try { fs.writeFileSync(path.join(paths(repo).dir, 'last_query'), new Date().toISOString()); } catch { /* read-only cache: the hook just nudges up to its cap */ }
    const run = async () => {
      const { m } = await current!;
      await m.prewarmQuery?.(q);
      const out = await m.retrieve({ task_id: 'mcp', query: q }, BUDGET);
      return { content: [{ type: 'text' as const, text: out.context?.trim() ? out.context : 'No results.' }] };
    };
    const p = chain.then(run, run); // retrievers keep per-query state: serialise
    chain = p.catch(() => undefined);
    try { return await p; } catch (e) { return { isError: true, content: [{ type: 'text' as const, text: `Search failed: ${(e as Error).message}` }] }; }
  });
  process.stdin.on('close', () => setTimeout(() => process.exit(0), 50).unref());
  await server.connect(new StdioServerTransport());
}

async function main() {
  const [cmd, repoArg, ...rest] = positional;
  if (flag('version') || cmd === 'version') { process.stdout.write(VERSION + '\n'); process.exit(0); }
  if (!cmd || !['init', 'index', 'status', 'query', 'serve', 'install', 'uninstall', 'recent', 'overview', 'changes'].includes(cmd)) {
    err(`typetrace ${VERSION}: code search + call graph for AI coding agents (MCP)

  typetrace init [repo]                 index the repo and register the MCP server with your AI coding tools
  typetrace status [repo]               what is indexed, what is still running in the background
  typetrace query <repo> "question"     print what the agent would see
  typetrace recent [repo]               what earlier sessions searched, read and edited (the recent_work tool)
  typetrace changes [repo]              what changed since the last session ended (changes_since_last_session)
  typetrace overview [repo] [folder]    a map of the codebase from its call graph (codebase_overview)
  typetrace index [repo]                rebuild everything now, in the foreground
  typetrace install [repo]              (re)register the server; uninstall removes it
  typetrace serve [repo]                run the MCP server (your tools start this; it keeps the index up to date)

  options: --client auto|all|none|${CLIENTS.map((c) => c.id).join(',')}   (init/install; auto = the tools found here)
           --include src,lib   only index these directories
           --wait              init: compute the embeddings before returning instead of in the background
           --no-embed          keyword + call-graph search only (no model download)
           --dry-run           install/uninstall: show the changes, write nothing
           --no-setup          init/install: register the MCP server only (no Claude Code instructions, skill or hook)
           --gpu               PyTorch/CUDA embeddings (source checkout with \`npm run setup\` only)
  indexes: ~/.cache/typetrace (TYPETRACE_CACHE to move); model: ~/.cache/typetrace/models (TYPETRACE_MODEL_DIR)`);
    process.exit(cmd ? 2 : 0);
  }
  const repo = path.resolve(repoArg ?? '.');
  if (cmd === 'init') await init(repo);
  else if (cmd === 'index') await index(repo);
  else if (cmd === 'status') status(repo);
  else if (cmd === 'query') await query(repo, rest.join(' '));
  else if (cmd === 'recent' || cmd === 'overview' || cmd === 'changes') {
    const l = await openIndex(repo, {});
    const name = cmd === 'recent' ? 'recent_work' : cmd === 'overview' ? 'codebase_overview' : 'changes_since_last_session';
    process.stdout.write(continuityAnswer(repo, l, name, cmd === 'overview' && rest[0] ? { under: rest[0] } : {}) + '\n');
  }
  else if (cmd === 'serve') await serve(repoArg);
  else if (cmd === 'install') install(repo);
  else install(repo, true);
  if (cmd !== 'serve') process.exit(process.exitCode ?? 0);
}
main().catch((e) => { err(String((e as Error).message ?? e)); process.exit(1); });
