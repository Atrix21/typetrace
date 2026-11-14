#!/usr/bin/env tsx
/**
 * code-graphs: the retrieval tool benchmarked in experiments/03-graph-scale, packaged for use.
 *
 *   code-graphs index   <repo> [--include src,lib] [--max-package-decl-mb 50]   build the typed graph + search indexes
 *   code-graphs query   <repo> "<question>"                                         print what the agent would see
 *   code-graphs serve   <repo>                                                      MCP server (stdio): find_relevant_code
 *   code-graphs install <repo>                                                      add the MCP server to <repo>/.mcp.json
 *
 * The served tool is exactly `compact_graph` from the benchmark: BM25 + embeddings (Qwen3-Embedding-0.6B) + typed call/
 * dispatch graph propagation, rendered as at most 800 tokens of file:line pointers with callers/callees/handlers.
 * Indexes live in ~/.cache/code-graphs/<hash of repo path>/ (override with CODE_GRAPHS_CACHE); the repository is never
 * written except by `install` (.mcp.json).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listCorpusFiles, PROJECT_ROOT } from '../config.js';
import { REGISTRY } from '../evaluation/methods.js';
import { countTokens } from '../evaluation/token-accounting.js';
import { buildGraph } from '../graph/graph-builder.js';
import { loadGraph, saveGraph } from '../graph/graph-store.js';
import { EXP3_TOOL_DESCRIPTION, EXP3_TOOL_NAME, EXP3_TOOL_SCHEMA } from '../agent-eval/exp3/tool-def.js';
import { EmbeddingRetriever } from '../retrieval/embeddings.js';
import { PersistentQueryEmbedder } from '../agent-eval/mcp/retrieval-server.js';
import { primeGraphCache } from '../retrieval/graph-retrieval.js';
import type { Corpus, RetrievalMethod } from '../types.js';

const SERVER_NAME = 'code-graphs';
const BUDGET = { maxResults: 50, maxContextTokens: 8000 };
const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const err = (s: string) => process.stderr.write(s + '\n');

function cacheDir(repo: string): string {
  const base = process.env.CODE_GRAPHS_CACHE ?? path.join(os.homedir(), '.cache', 'code-graphs');
  return path.join(base, crypto.createHash('sha256').update(repo).digest('hex').slice(0, 16));
}

function includeDirs(repo: string, dir: string): string[] {
  const saved = path.join(dir, 'index.json');
  if (opt('include')) return opt('include')!.split(',');
  if (fs.existsSync(saved)) return JSON.parse(fs.readFileSync(saved, 'utf8')).include;
  return fs.existsSync(path.join(repo, 'src')) ? ['src'] : ['.'];
}

async function load(repo: string, quiet = false, queryEmbedder = true) {
  const dir = cacheDir(repo);
  const graphPath = path.join(dir, 'graph.sqlite');
  if (!fs.existsSync(graphPath)) throw new Error(`no index for ${repo}; run: code-graphs index ${repo}`);
  const include = includeDirs(repo, dir);
  const files = listCorpusFiles(repo, include);
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

async function index(repo: string) {
  const dir = cacheDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  const include = opt('include')?.split(',') ?? (fs.existsSync(path.join(repo, 'src')) ? ['src'] : ['.']);
  const files = listCorpusFiles(repo, include);
  if (!files.length) throw new Error(`no .ts files under ${include.join(', ')} in ${repo}`);
  const mb = opt('max-package-decl-mb');
  err(`building typed graph over ${files.length} files…`);
  const g = buildGraph({ repoRoot: repo, files, maxPackageDeclarationBytes: mb !== undefined ? Number(mb) * 1e6 : files.length > 5000 ? 0 : 50e6 });
  saveGraph(path.join(dir, 'graph.sqlite'), { nodes: g.nodes, edges: g.edges, coverage: g.coverage, stats: g.stats, meta: { repo, files: files.length, build_ms: g.build_ms } });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ repo, include, files: files.length, nodes: g.nodes.length, edges: g.edges.length, graph_build_ms: g.build_ms, at: new Date().toISOString() }, null, 2) + '\n');
  err(`graph: ${g.nodes.length} nodes, ${g.edges.length} edges in ${(g.build_ms / 1000).toFixed(1)} s`);
  const t = performance.now();
  await load(repo, true, false);
  err(`search indexes (BM25 + embeddings) ready in ${((performance.now() - t) / 1000).toFixed(1)} s\nindex: ${dir}`);
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
  const { m } = await load(repo, true);
  let chain: Promise<unknown> = Promise.resolve();
  const server = new Server({ name: SERVER_NAME, version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: EXP3_TOOL_NAME, description: EXP3_TOOL_DESCRIPTION, inputSchema: EXP3_TOOL_SCHEMA as never }] }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const q = (req.params.arguments as { query?: unknown } | undefined)?.query;
    if (req.params.name !== EXP3_TOOL_NAME || typeof q !== 'string' || !q.trim()) return { isError: true, content: [{ type: 'text' as const, text: 'Invalid call: "query" must be a non-empty string.' }] };
    const run = async () => {
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

function install(repo: string) {
  const f = path.join(repo, '.mcp.json');
  const cfg = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  cfg.mcpServers ??= {};
  cfg.mcpServers[SERVER_NAME] = { command: path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx'), args: [path.join(PROJECT_ROOT, 'src', 'product', 'cli.ts'), 'serve', repo] };
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
  err(`added "${SERVER_NAME}" to ${f}. Restart Claude Code in ${repo}; the tool is mcp__${SERVER_NAME}__${EXP3_TOOL_NAME}.`);
}

async function main() {
  const [cmd, repoArg, ...rest] = positional;
  if (!cmd || !repoArg || !['index', 'query', 'serve', 'install'].includes(cmd)) {
    err('usage: code-graphs index|query|serve|install <repo> ["question"] [--include src] [--max-package-decl-mb N]');
    process.exit(2);
  }
  const repo = path.resolve(repoArg);
  if (cmd === 'index') await index(repo);
  else if (cmd === 'query') await query(repo, rest.join(' '));
  else if (cmd === 'serve') await serve(repo);
  else install(repo);
  if (cmd !== 'serve') process.exit(0);
}
main().catch((e) => { err(String((e as Error).message ?? e)); process.exit(1); });
