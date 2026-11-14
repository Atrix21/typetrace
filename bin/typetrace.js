#!/usr/bin/env node
// TypeTrace CLI entry point: runs src/product/cli.ts with the bundled tsx.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsx = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const r = spawnSync(tsx, [path.join(root, 'src', 'product', 'cli.ts'), ...process.argv.slice(2)], { stdio: 'inherit', cwd: process.cwd(), env: { ...process.env, NODE_NO_WARNINGS: '1' } });
process.exit(r.status ?? 1);
