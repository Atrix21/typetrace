#!/usr/bin/env tsx
/**
 * TypeTrace: the retrieval tool benchmarked in experiments/03-graph-scale, packaged for use.
 *
 *   typetrace init    [repo]                                                      index + register with Claude Code (one step)
 *   typetrace index   <repo> [--include src,lib] [--max-package-decl-mb 50]   build the graph + search indexes
 *   typetrace query   <repo> "<question>"                                         print what the agent would see
 *   typetrace serve   <repo>                                                      MCP server (stdio): find_relevant_code
 *   typetrace install <repo>                                                      add the MCP server to <repo>/.mcp.json
 *
 * Languages: TypeScript (typed, TypeScript compiler) and Python (tree-sitter, scope/import/MRO resolution); mixed repos merge.
 * Embeddings: Node/ONNX on CPU by default (no Python); `--gpu` uses the PyTorch backend (needs `npm run setup`).
 * The served tool is exactly `compact_graph` from the benchmark: BM25 + embeddings (Qwen3-Embedding-0.6B) + typed call/
 * dispatch graph propagation, rendered as at most 800 tokens of file:line pointers with callers/callees/handlers.
 * Indexes live in ~/.cache/typetrace/<hash of repo path>/ (override with TYPETRACE_CACHE); the repository is never
 * written except by `install` (.mcp.json).
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
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
import { Embedder, EmbeddingRetriever, ONNX_EMBEDDING } from '../retrieval/embeddings.js';
import { grammarLanguages, initLanguages } from '../languages/registry.js';
import { languageSummary, sourceFiles } from './source-files.js';
import { PersistentQueryEmbedder } from '../agent-eval/mcp/retrieval-server.js';
import { primeGraphCache } from '../retrieval/graph-retrieval.js';
import type { Corpus, RetrievalMethod } from '../types.js';

const SERVER_NAME = 'typetrace';
const BUDGET = { maxResults: 50, maxContextTokens: 8000 };
const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const err = (s: string) => process.stderr.write(s + '\n');
const flag = (k: string) => argv.includes(`--${k}`);
// Product default: Python-free ONNX embeddings; --gpu switches to the PyTorch backend the benchmarks used.
process.env.TYPETRACE_EMBED_BACKEND ??= flag('gpu') ? 'python' : 'onnx';
// The embedding model (~2.4 GB) is cached outside the package, so npx/npm reinstalls never download it again.
process.env.TYPETRACE_MODEL_DIR ??= path.join(os.homedir(), '.cache', 'typetrace', 'models');
const PKG: { name: string; version: string } = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const FROM_NPM = PROJECT_ROOT.split(path.sep).includes('node_modules');


function cacheDir(repo: string): string {
  const base = process.env.TYPETRACE_CACHE ?? path.join(os.homedir(), '.cache', 'typetrace');
  return path.join(base, crypto.createHash('sha256').update(repo).digest('hex').slice(0, 16));
}

function includeDirs(repo: string, dir: string): string[] {
  const saved = path.join(dir, 'index.json');
  if (opt('include')) return opt('include')!.split(',');
  if (fs.existsSync(saved)) return JSON.parse(fs.readFileSync(saved, 'utf8')).include;
  return [''];
}

async function load(repo: string, quiet = false, queryEmbedder = true) {
  const dir = cacheDir(repo);
  const graphPath = path.join(dir, 'graph.sqlite');
  if (!fs.existsSync(graphPath)) throw new Error(`no index for ${repo}; run: typetrace index ${repo}`);
  const include = includeDirs(repo, dir);
  const files = sourceFiles(repo, include);
  await initLanguages(grammarLanguages(files));
  const corpus: Corpus = { repoRoot: repo, commit: 'local', files, cacheDir: path.join(dir, 'retrieval') };
  fs.mkdirSync(corpus.cacheDir, { recursive: true });
  const graph = loadGraph(graphPath);
  primeGraphCache(corpus, { nodes: graph.nodes, edges: graph.edges, build_ms: 0, cached: true });
  EmbeddingRetriever.embeddingCacheDir = path.join(dir, 'embeddings');
  // `index` only embeds the corpus (one model in memory); query/serve keep one persistent model for query vectors.
  const embedder = queryEmbedder ? new PersistentQueryEmbedder() : null;
  EmbeddingRetriever.defaultQueryEmbedder = embedder;
  for (const sig of ['SIGINT', 'SIGTERM', 'exit'] as const) process.on(sig, () => { try { embedder?.close(); } catch { /* */ } if (sig !== 'exit') process.exit(0); });
  const m = (await REGISTRY.compact_graph()) as RetrievalMethod & { prewarmQuery?(q: string): Promise<void> };
  if (!quiet) err(`loading indexes for ${files.length} files…`);
  await m.prepare(corpus);
  await embedder?.ready;
  return { m, files, graph };
}

function dirBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) { try { const st = fs.statSync(path.join(dir, f)); if (st.isFile()) n += st.size; } catch { /* in flux */ } }
  return n;
}

/** Load the embedding model once, downloading it on first use (~2.4 GB). Progress = growth of the model directory. */
async function ensureModel() {
  const dir = process.env.TYPETRACE_MODEL_DIR!;
  err('checking the embedding model (Qwen3-Embedding-0.6B, runs locally)…');
  const child = spawn(process.execPath, [abs(ONNX_EMBEDDING.script), '--download'], { stdio: ['ignore', 'ignore', 'pipe'], env: process.env });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const before = dirBytes(dir);
  let shown = false;
  const timer = setInterval(() => {
    const got = dirBytes(dir) - before;
    if (got < 5e6) return;
    shown = true;
    process.stderr.write(`\r  downloading the model (first run only): ${(got / 1e9).toFixed(2)} of ~2.4 GB   `);
  }, 1000);
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  clearInterval(timer);
  if (shown) process.stderr.write('\n');
  if (code !== 0) throw new Error(`could not load the embedding model:\n${stderr.slice(-2000)}`);
}

async function index(repo: string) {
  const dir = cacheDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  const include = opt('include')?.split(',') ?? [''];
  const files = sourceFiles(repo, include);
  if (!files.length) throw new Error(`no supported source files in ${repo}${opt('include') ? ` under ${include.join(', ')}` : ''} (TypeScript, JavaScript, Python, Go, Java, Kotlin, Scala, C#, Rust, C, C++, Ruby, PHP, Swift)`);
  err(`found ${files.length} files: ${languageSummary(files)}`);
  await initLanguages(grammarLanguages(files));
  const mb = opt('max-package-decl-mb');
  err(`building the code graph…`);
  const g = buildGraph({ repoRoot: repo, files, maxPackageDeclarationBytes: mb !== undefined ? Number(mb) * 1e6 : files.length > 5000 ? 0 : 50e6 });
  saveGraph(path.join(dir, 'graph.sqlite'), { nodes: g.nodes, edges: g.edges, coverage: g.coverage, stats: g.stats, meta: { repo, files: files.length, build_ms: g.build_ms } });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ repo, include, files: files.length, nodes: g.nodes.length, edges: g.edges.length, graph_build_ms: g.build_ms, at: new Date().toISOString() }, null, 2) + '\n');
  err(`graph: ${g.nodes.length} nodes, ${g.edges.length} edges in ${(g.build_ms / 1000).toFixed(1)} s`);
  if (process.env.TYPETRACE_EMBED_BACKEND === 'onnx') await ensureModel();
  Embedder.showProgress = true;
  const t = performance.now();
  await load(repo, true, false);
  err(`search indexes (BM25 + embeddings, ${process.env.TYPETRACE_EMBED_BACKEND === 'onnx' ? 'CPU' : 'GPU/PyTorch'}) ready in ${((performance.now() - t) / 1000).toFixed(1)} s\nindex: ${dir}`);
}

async function query(repo: string, q: string) {
  const { m } = await load(repo);
  await m.prewarmQuery?.(q);
  const out = await m.retrieve({ task_id: 'cli', query: q }, BUDGET);
  const text = out.context?.trim() ? out.context : 'No results.';
  process.stdout.write(text + '\n');
  err(`(${countTokens(text)} tokens)`);
}

async function serve(repo: string) {
  console.log = console.error; // stdout belongs to the MCP transport
  // Answer the MCP handshake at once and load in the background: large repositories take a minute to load, longer
  // than an MCP client waits for a server to start. Tool calls wait for the load.
  const ready = load(repo, true);
  ready.catch((e) => err(`typetrace: ${(e as Error).message}`));
  let chain: Promise<unknown> = Promise.resolve();
  const server = new Server({ name: SERVER_NAME, version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: EXP3_TOOL_NAME, description: EXP3_TOOL_DESCRIPTION, inputSchema: EXP3_TOOL_SCHEMA as never }] }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const q = (req.params.arguments as { query?: unknown } | undefined)?.query;
    if (req.params.name !== EXP3_TOOL_NAME || typeof q !== 'string' || !q.trim()) return { isError: true, content: [{ type: 'text' as const, text: 'Invalid call: "query" must be a non-empty string.' }] };
    const run = async () => {
      const { m } = await ready;
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

async function init(repo: string) {
  await index(repo);
  install(repo);
  err(`\ndone. Next: restart Claude Code in ${repo}, approve the "${SERVER_NAME}" MCP server, and ask it about your code.\nTry it here first:  typetrace query ${JSON.stringify(repo)} "where is <something> handled?"`);
}

function install(repo: string) {
  const f = path.join(repo, '.mcp.json');
  const cfg = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  cfg.mcpServers ??= {};
  const extra = flag('gpu') ? ['--gpu'] : [];
  // Installed from npm: launch through npx (stable across npx cache clean-ups and Node upgrades). From a source checkout: this checkout.
  cfg.mcpServers[SERVER_NAME] = FROM_NPM
    ? { command: 'npx', args: ['-y', `${PKG.name}@${VERSION}`, 'serve', repo, ...extra] }
    : { command: process.execPath, args: [path.join(PROJECT_ROOT, 'bin', 'typetrace.js'), 'serve', repo, ...extra] };
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
  err(`added "${SERVER_NAME}" to ${f}. Restart Claude Code in ${repo}; the tool is mcp__${SERVER_NAME}__${EXP3_TOOL_NAME}.`);
}

async function main() {
  const [cmd, repoArg = '.', ...rest] = positional;
  if (flag('version') || cmd === 'version') { process.stdout.write(VERSION + '\n'); process.exit(0); }
  if (!cmd || !['init', 'index', 'query', 'serve', 'install'].includes(cmd)) {
    err(`typetrace ${VERSION}: code search + call graph for AI coding agents (MCP)

  typetrace init [repo]                 index the repo and register the MCP server with Claude Code (one step)
  typetrace query <repo> "question"     print what the agent would see
  typetrace index <repo>                rebuild the index (after big changes)
  typetrace install <repo>              (re)write <repo>/.mcp.json
  typetrace serve <repo>                run the MCP server (Claude Code starts this for you)

  options: --include src,lib   only index these directories
           --gpu               PyTorch/CUDA embeddings (source checkout with \`npm run setup\` only)
  indexes: ~/.cache/typetrace (TYPETRACE_CACHE to move); model: ~/.cache/typetrace/models (TYPETRACE_MODEL_DIR)`);
    process.exit(cmd ? 2 : 0);
  }
  const repo = path.resolve(repoArg);
  if (cmd === 'init') await init(repo);
  else if (cmd === 'index') await index(repo);
  else if (cmd === 'query') await query(repo, rest.join(' '));
  else if (cmd === 'serve') await serve(repo);
  else install(repo);
  if (cmd !== 'serve') process.exit(0);
}
main().catch((e) => { err(String((e as Error).message ?? e)); process.exit(1); });
