#!/usr/bin/env tsx
/**
 * Experiment 11 preparation (mock only, no API calls): which Claude Code flags load a workspace's own CLAUDE.md, skills
 * and hooks while keeping the owner's configuration out, and confine Bash and the file tools to the workspace.
 *   npx tsx scripts/exp11/probe_isolation.ts <variant>
 * Prints what reached the (mock) model and what the tools could read. Nothing is billed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockServer } from '../../src/agent-eval/mock-anthropic/server.js';
import { DUMMY_API_KEY, ISOLATION_ENV } from '../../src/agent-eval/backends/claude-code.js';

const variant = process.argv[2] ?? 'A';
const BIN = path.join(os.homedir(), 'dev/backups/claude-code-pinned/bin/claude');
const root = fs.mkdtempSync('/tmp/work/probe-');
const ws = path.join(root, 'app');
const sib = fs.mkdtempSync('/tmp/work/probe-sibling-');
fs.writeFileSync(path.join(sib, 'SIBLING_SECRET.txt'), 'SIBLING_MARKER_7731\n');
fs.mkdirSync(path.join(ws, '.claude/skills/projskill'), { recursive: true });
fs.writeFileSync(path.join(ws, 'CLAUDE.md'), 'PROJECT_MARKER_4412: this is the project instruction file.\n');
fs.writeFileSync(path.join(ws, '.claude/skills/projskill/SKILL.md'), '---\nname: projskill\ndescription: PROJSKILL_MARKER_9917 use for nothing\n---\nbody\n');
const hookOut = path.join(root, 'hook-fired.txt');
const hooks = { hooks: { PreToolUse: [{ matcher: 'Grep|Read|Bash', hooks: [{ type: 'command', command: `echo fired >> ${hookOut}; echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"HOOK_MARKER_5520"}}'` }] }] } };
fs.writeFileSync(path.join(ws, '.claude/settings.json'), JSON.stringify(hooks));
fs.writeFileSync(path.join(ws, 'm.py'), 'def add(a, b):\n    return a + b\n');
const log = path.join(root, 'mock.jsonl');
const sandbox = { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, filesystem: { denyRead: ['/home', '/tmp', '/root', '/var/tmp', '/mnt', '/media'], allowRead: [ws], allowWrite: [ws] }, network: { allowedDomains: [] } };
const settings: any = { permissions: { blockReadsOutsideWorkingDirectories: true, allow: ['Bash(echo:*)'] } };
if (variant === 'A') Object.assign(settings, hooks);
const srv = await startMockServer({ logFile: log, policy: { kind: 'scripted', steps: [
  { tool: 'Bash', input: { command: `cat ${sib}/SIBLING_SECRET.txt; ls ${os.homedir()}/.claude | head -3; echo BASH_RAN` } },
  { tool: 'Read', input: { file_path: `${sib}/SIBLING_SECRET.txt` } },
  { tool: 'Grep', input: { pattern: 'SIBLING_MARKER', path: sib } },
  { tool: 'Read', input: { file_path: path.join(ws, 'm.py') } },
  { structured: { summary: 'probe', locations: [{ file: 'm.py', symbol: 'add' }] } },
] } });
const env: Record<string, string> = { PATH: `${path.dirname(BIN)}:${path.resolve('vendor/socat/root/usr/bin')}:/usr/bin:/bin`, HOME: os.homedir(), LANG: 'C.UTF-8', ...ISOLATION_ENV, ANTHROPIC_BASE_URL: srv.url, ANTHROPIC_API_KEY: DUMMY_API_KEY, TMPDIR: path.join(root, 'tmp') };
fs.mkdirSync(env.TMPDIR, { recursive: true });
delete (env as any).CLAUDE_CODE_DISABLE_CLAUDE_MDS;
const mcp = path.join(root, 'mcp.json'); fs.writeFileSync(mcp, JSON.stringify({ mcpServers: {} }));
const args = ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--model', 'claude-haiku-5-5',
  ...(variant === 'A' ? ['--restricted', '--setting-sources', 'project'] : ['--setting-sources', 'project']),
  '--strict-mcp-config', '--mcp-config', mcp, '--settings', JSON.stringify(settings),
  '--append-system-prompt', 'TASK_PROMPT_MARKER', '--json-schema', JSON.stringify({ type: 'object', properties: { summary: { type: 'string' }, locations: { type: 'array' } }, required: ['summary', 'locations'] }),
  '--max-turns', '10', '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
  '--tools', 'Read,Grep,Glob,Bash,Skill', '--allowedTools', 'Read,Grep,Glob,Skill,Bash(echo:*)', '--disallowedTools', 'Edit,Write,NotebookEdit,WebFetch,WebSearch,Task,Agent,TodoWrite'];
// async: the mock server runs in this process, so a blocking spawn would starve it
const r = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
  const c = spawn(BIN, [...args, '--', 'find add'], { cwd: ws, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => c.kill('SIGTERM'), 150_000);
  c.on('exit', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});
await srv.close();
if (r.status !== 0 || !fs.readFileSync(log, "utf8").trim()) console.error("STDERR", (r.stderr ?? "").slice(-1500), "STDOUT", (r.stdout ?? "").slice(-800));
const reqs = fs.readFileSync(log, 'utf8');
const ownerMd = fs.existsSync(path.join(os.homedir(), '.claude/CLAUDE.md')) ? fs.readFileSync(path.join(os.homedir(), '.claude/CLAUDE.md'), 'utf8').split('\n').filter((l) => l.trim().length > 25) : [];
const ownerSkills = fs.existsSync(path.join(os.homedir(), '.claude/skills')) ? fs.readdirSync(path.join(os.homedir(), '.claude/skills')) : [];
const init = r.stdout.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j?.type === 'system' && j?.subtype === 'init');
const results = r.stdout.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((j) => j?.type === 'user').flatMap((j) => (j.message?.content ?? []).filter((c: any) => c.type === 'tool_result').map((c: any) => JSON.stringify(c.content).slice(0, 160)));
console.log(JSON.stringify({
  variant, exit: r.status,
  tools: init?.tools, skills: init?.skills, slash: init?.slash_commands?.length,
  project_claude_md: reqs.includes('PROJECT_MARKER_4412'), project_skill: reqs.includes('PROJSKILL_MARKER_9917'), hook_context: reqs.includes('HOOK_MARKER_5520'), hook_fired: fs.existsSync(hookOut),
  task_prompt: reqs.includes('TASK_PROMPT_MARKER'),
  owner_claude_md_lines_leaked: ownerMd.filter((l) => reqs.includes(l.trim())).length, owner_md_lines: ownerMd.length,
  owner_skills_leaked: ownerSkills.filter((s) => reqs.includes(`"${s}"`) || reqs.includes(`- ${s}:`) || reqs.includes(`${s}:`)).slice(0, 8),
  sibling_marker_reached_model: reqs.includes('SIBLING_MARKER_7731'), bash_ran: reqs.includes('BASH_RAN'),
  tool_results: results,
}, null, 1));
if (variant === 'B' && process.argv.includes('--write-builtins') && init) {
  // Claude Code's own skills and slash commands under the 'project-oauth' profile, minus the probe's project skill.
  const out = { claude_code_version: init.claude_code_version, skills: init.skills.filter((k: string) => k !== 'projskill'), slash_commands: init.slash_commands.filter((k: string) => k !== 'projskill') };
  fs.writeFileSync('experiments/11-vendor-setups/claude-builtins.json', JSON.stringify(out, null, 1) + '\n');
}
fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(sib, { recursive: true, force: true });
