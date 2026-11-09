#!/usr/bin/env tsx
// Experiment 3: repository + method-configuration manifests (pinned commits, corpus hashes, dependency lockfiles, tool
// versions, frozen retrieval configurations).  npx tsx scripts/exp3/manifests.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { abs, listCorpusFiles, loadConfig } from '../../src/config.js';
import { customGraphConfig, hybridConfig } from '../../src/evaluation/configs.js';
import { HYBRID_NOGRAPH_OVERRIDE, STAGE1_METHODS } from '../../src/evaluation/methods.js';
import { COMPACT_OPTIONS } from '../../src/retrieval/compact-retrieval.js';
import { DispatchExtractor } from '../../src/parser/dispatch-extractor.js';
import { RipgrepRetriever } from '../../src/retrieval/ripgrep.js';
const sha = (b: string | Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const git = (cwd: string, a: string[]) => spawnSync('git', a, { cwd: abs(cwd), encoding: 'utf8' }).stdout.trim();
function corpusHash(root: string, include: string[]) {
  const files = listCorpusFiles(abs(root), include);
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(f + '\0'); h.update(fs.readFileSync(path.join(abs(root), f))); h.update('\0'); }
  return { files: files.length, sha256: h.digest('hex') };
}
const fileSha = (p: string) => (fs.existsSync(abs(p)) ? sha(fs.readFileSync(abs(p))) : null);
const cfg = loadConfig();
const repos = {
  S: { name: 'brocoders/nestjs-boilerplate', commit: cfg.target.upstream_commit, snapshot: 'targets/bench (experiment-1 single-bug branches)', corpus_root: 'targets/bench', include: cfg.target.include_dirs, base_corpus: corpusHash('targets/bench', cfg.target.include_dirs), lockfile_sha256: fileSha('targets/package-lock.json') ?? fileSha('targets/bench/package-lock.json'), type_stub_policy: 'none (experiment-1 configuration)' },
  M: { name: 'immich-app/immich (server/)', commit: git('targets/exp3/immich', ['rev-parse', 'HEAD']), corpus_root: 'targets/exp3/immich/server', include: ['src'], pinned_corpus: corpusHash('targets/exp3/immich/server', ['src']), lockfile: 'pnpm-lock.yaml', lockfile_sha256: fileSha('targets/exp3/immich/pnpm-lock.yaml'), install: 'pnpm install --ignore-scripts --filter ./server --filter ./packages/plugin-sdk --filter ./packages/sdk; plugin-sdk built (esbuild + tsc declarations)', type_stub_policy: 'packages with > 50 MB of declarations (none in Immich)' },
  L: { name: 'twentyhq/twenty (packages/twenty-server/)', commit: git('targets/exp3/twenty', ['rev-parse', 'HEAD']), corpus_root: 'targets/exp3/twenty/packages/twenty-server', include: ['src'], pinned_corpus: corpusHash('targets/exp3/twenty/packages/twenty-server', ['src']), lockfile: 'yarn.lock', lockfile_sha256: fileSha('targets/exp3/twenty/yarn.lock'), install: 'yarn workspaces focus twenty-server twenty-shared twenty-emails twenty-client-sdk (enableScripts false, constraints checks off); twenty-shared and twenty-emails declarations built with tsc', type_stub_policy: 'all third-party declaration files stubbed (workspace packages, @types/*, TS lib typed) — E3-D15' },
};
const out = {
  generated_by: 'scripts/exp3/manifests.ts', generated_at: new Date().toISOString(),
  tools: { node: process.version, typescript_extractor: ts.version, embeddings: cfg.embeddings, ripgrep: (spawnSync(new RipgrepRetriever()['rgBin' as never] as unknown as string, ['--version'], { encoding: 'utf8' }).stdout ?? 'unknown').split('\n')[0] },
  repositories: repos,
};
fs.writeFileSync(abs('experiments/03-graph-scale/manifests/repositories.json'), JSON.stringify(out, null, 2) + '\n');
const methods = {
  generated_by: 'scripts/exp3/manifests.ts', methods: STAGE1_METHODS,
  budget: { maxResults: 50, maxContextTokens: 8000, note: 'experiment-1 frozen budget; natural output = native context under this budget' },
  fixed_token_budgets: [500, 800, 1000, 2000, 4000, 8000],
  hybrid: hybridConfig(), hybrid_nograph_override: HYBRID_NOGRAPH_OVERRIDE, custom_graph: customGraphConfig(),
  compact: { ...COMPACT_OPTIONS, compact_graph: { ranking: 'hybrid', relations: true }, compact_nograph: { ranking: 'hybrid_nograph', relations: false }, signature: 'first non-decorator line of the declaration (source text), both variants' },
  dispatch_extractor: { min_domain_specificity: DispatchExtractor.MIN_SPECIFICITY, rules: 'E3-D14, E3-D21, E3-D22' },
  frozen_from: 'evaluation/configs/FROZEN-CONFIG.json (experiment 1); no per-repository tuning',
};
fs.writeFileSync(abs('experiments/03-graph-scale/manifests/methods.json'), JSON.stringify(methods, null, 2) + '\n');
console.log(JSON.stringify({ S: repos.S.base_corpus, M: repos.M.pinned_corpus, L: repos.L.pinned_corpus }));
