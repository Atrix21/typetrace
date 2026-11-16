#!/usr/bin/env node
// TypeTrace CLI entry point. Installed from npm: runs the compiled dist/. Source checkout without a build: runs src/ via tsx.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compiled = path.join(root, 'dist', 'product', 'cli.js');
// node:sqlite prints an ExperimentalWarning on Node 22; it is stable for what TypeTrace uses.
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') process.stderr.write(`${w.name}: ${w.message}\n`); });
if (fs.existsSync(compiled)) {
  await import(pathToFileURL(compiled).href);
} else {
  const tsx = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  const r = spawnSync(tsx, [path.join(root, 'src', 'product', 'cli.ts'), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  process.exit(r.status ?? 1);
}
