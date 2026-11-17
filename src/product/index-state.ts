/**
 * On-disk state of a repository's index, shared by the CLI, the MCP server and the background jobs.
 *
 *   ~/.cache/typetrace/<hash of the repository path>/
 *     graph.sqlite        the call graph (the graph job replaces it atomically)
 *     index.json          what is indexed: include dirs, counts, when the graph was built, the embedding setting
 *     manifest.json       size and modification time of every indexed file (edit detection)
 *     embeddings/         vector cache, appended in batches by the embedding job
 *     jobs/<kind>.lock    pid of the running job (graph | embed); jobs/<kind>.log its output
 *     jobs/graph.wanted   asks a running embedding job to pause after its batch, so the two never hold memory together
 *
 * The server and `typetrace query` only read. Every write happens in one of the two jobs (or a foreground `index`).
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceFiles } from './source-files.js';

export type JobKind = 'graph' | 'embed';

export interface IndexMeta {
  repo: string;
  include: string[];
  files: number;
  nodes: number;
  edges: number;
  graph_build_ms: number;
  /** ISO time the graph job finished. The server reloads when it changes. */
  graph_at: string;
  /** 'auto': embed in the background (default). 'off': keyword + call-graph search only. */
  embeddings: 'auto' | 'off';
  /** ISO time an embedding job last appended vectors. The server reloads when it changes. */
  vectors_at?: string;
  /** ISO time an embedding job finished with every chunk embedded. */
  embedded_at?: string;
}

export const cacheBase = (): string => process.env.TYPETRACE_CACHE ?? path.join(os.homedir(), '.cache', 'typetrace');
export const cacheDir = (repo: string): string => path.join(cacheBase(), crypto.createHash('sha256').update(repo).digest('hex').slice(0, 16));

export function paths(repo: string) {
  const dir = cacheDir(repo);
  return {
    dir,
    graph: path.join(dir, 'graph.sqlite'),
    meta: path.join(dir, 'index.json'),
    manifest: path.join(dir, 'manifest.json'),
    embeddings: path.join(dir, 'embeddings'),
    retrieval: path.join(dir, 'retrieval'),
    jobs: path.join(dir, 'jobs'),
  };
}

/** Write a file so that readers see either the old or the new content, never a partial one. */
export function writeAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function readMeta(repo: string): IndexMeta | null {
  try { return JSON.parse(fs.readFileSync(paths(repo).meta, 'utf8')) as IndexMeta; } catch { return null; }
}

/** Merge fields into index.json. The two jobs write disjoint fields, so a merge never undoes the other job's update. */
export function writeMeta(repo: string, patch: Partial<IndexMeta>): IndexMeta {
  const next = { ...(readMeta(repo) ?? { repo, include: [''], embeddings: 'auto' }), ...patch } as IndexMeta;
  writeAtomic(paths(repo).meta, JSON.stringify(next, null, 2) + '\n');
  return next;
}

/** rel path -> "size:mtime" */
export type Manifest = Record<string, string>;

export function scan(repo: string, include: string[]): { files: string[]; manifest: Manifest } {
  const files = sourceFiles(repo, include);
  const manifest: Manifest = {};
  for (const f of files) {
    try { const st = fs.statSync(path.join(repo, f)); manifest[f] = `${st.size}:${Math.round(st.mtimeMs)}`; } catch { /* deleted while scanning */ }
  }
  return { files: Object.keys(manifest), manifest };
}

export function readManifest(repo: string): Manifest | null {
  try { return JSON.parse(fs.readFileSync(paths(repo).manifest, 'utf8')) as Manifest; } catch { return null; }
}
export const writeManifest = (repo: string, m: Manifest): void => writeAtomic(paths(repo).manifest, JSON.stringify(m) + '\n');

export function diffManifest(before: Manifest, after: Manifest): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = [], removed: string[] = [], changed: string[] = [];
  for (const [f, v] of Object.entries(after)) { if (!(f in before)) added.push(f); else if (before[f] !== v) changed.push(f); }
  for (const f of Object.keys(before)) if (!(f in after)) removed.push(f);
  return { added, removed, changed };
}

// ---- jobs ----

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const lockFile = (repo: string, kind: JobKind) => path.join(paths(repo).jobs, `${kind}.lock`);
export const jobLog = (repo: string, kind: JobKind) => path.join(paths(repo).jobs, `${kind}.log`);
const wantedFile = (repo: string) => path.join(paths(repo).jobs, 'graph.wanted');

/** pid of the running job of this kind, or null. A lock left by a dead process is removed. */
export function jobRunning(repo: string, kind: JobKind): number | null {
  const f = lockFile(repo, kind);
  let pid: number;
  try { pid = Number(fs.readFileSync(f, 'utf8').trim()); } catch { return null; }
  if (pid && alive(pid)) return pid;
  fs.rmSync(f, { force: true });
  return null;
}

/** Take the lock for this kind of job for the current process. False if another live process holds it. */
export function tryLock(repo: string, kind: JobKind): boolean {
  fs.mkdirSync(paths(repo).jobs, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(lockFile(repo, kind), String(process.pid), { flag: 'wx' }); return true; } catch { /* exists */ }
    if (jobRunning(repo, kind)) return false; // removes a stale lock, then retry once
  }
  return false;
}
export function unlock(repo: string, kind: JobKind): void {
  try { if (Number(fs.readFileSync(lockFile(repo, kind), 'utf8')) === process.pid) fs.rmSync(lockFile(repo, kind)); } catch { /* gone */ }
}

export const requestGraph = (repo: string): void => { fs.mkdirSync(paths(repo).jobs, { recursive: true }); fs.writeFileSync(wantedFile(repo), String(Date.now())); };
export const graphWanted = (repo: string): boolean => fs.existsSync(wantedFile(repo));
export const clearGraphWanted = (repo: string): void => fs.rmSync(wantedFile(repo), { force: true });

/**
 * Start `typetrace index <repo> --job <kind>` detached at low priority, logging to jobs/<kind>.log. It outlives the
 * caller (an `init` that has returned, or a server that stops). Returns its pid, or null if one is already running.
 */
export function spawnJob(repo: string, kind: JobKind, bin: string, extra: string[] = []): number | null {
  if (jobRunning(repo, kind)) return null;
  fs.mkdirSync(paths(repo).jobs, { recursive: true });
  const log = fs.openSync(jobLog(repo, kind), 'a');
  const child = spawn(process.execPath, [bin, 'index', repo, '--job', kind, ...extra], { detached: true, stdio: ['ignore', log, log], env: process.env });
  fs.closeSync(log);
  try { if (child.pid) os.setPriority(child.pid, 10); } catch { /* not permitted: normal priority */ }
  child.unref();
  return child.pid ?? null;
}

/** Progress of the running (or last) embedding job, from its log: chunks embedded / chunks it had to embed. */
export function embedProgress(repo: string): { done: number; total: number } | null {
  let text: string;
  try { text = fs.readFileSync(jobLog(repo, 'embed'), 'utf8'); } catch { return null; }
  const all = [...text.matchAll(/embedding code chunks on CPU: (\d+)\/(\d+)/g)];
  const last = all[all.length - 1];
  return last ? { done: Number(last[1]), total: Number(last[2]) } : null;
}

/** The nearest directory at or above `start` that has an index (MCP clients with one global configuration). */
export function findIndexedRepo(start: string): string | null {
  for (let d = path.resolve(start); ; d = path.dirname(d)) {
    if (fs.existsSync(paths(d).graph)) return d;
    if (path.dirname(d) === d) return null;
  }
}
