#!/usr/bin/env python3
"""Experiment 10: check that no user configuration reached the model in a mock run.

    python3 scripts/swebench/agent_leak_check.py <results/mock-run dir> [--config-dir DIR ...]

The mock Anthropic server records every request the agent sent (transcripts/*.mock.jsonl). This script searches the
parts the harness controls (system prompt, user turns, tool definitions) for:
- distinctive lines of every CLAUDE.md in the given Claude config directories (lines of 24+ characters);
- the skill listing and memory markers that Claude Code adds when they are enabled.

Assistant turns and tool results are skipped: they hold the mock's scripted calls and the tools' own output.
Matches are reported as hashes, so no private text is written anywhere. Exit status 1 if anything matched.
The positive control (the same detectors firing when isolation is off) is src/agent-eval/verify-isolation.ts.
"""
import glob, hashlib, json, os, sys

SKILL_NEEDLES = ['skills are available', 'available skills', 'Skill tool', 'ig-reel', 'watchos', 'unity-mcp', 'paxel-remote-setup']
MEMORY_NEEDLES = ['MEMORY.md', 'auto memory', 'memory directory', 'auto-memory']


def claude_md_needles(cfg_dirs):
    needles = {}
    for d in cfg_dirs:
        for f in [os.path.join(d, 'CLAUDE.md')]:
            if os.path.isfile(f):
                for line in open(f, encoding='utf8', errors='replace'):
                    line = line.strip()
                    if len(line) >= 24:
                        needles[line[:70]] = 'claude-md#' + hashlib.sha256(line[:70].encode()).hexdigest()[:10]
    return needles


def segments(body):
    sys_ = body.get('system') or []
    if isinstance(sys_, str):
        sys_ = [{'text': sys_}]
    for i, s in enumerate(sys_):
        yield f'system[{i}]', str(s.get('text', ''))
    for i, m in enumerate(body.get('messages') or []):
        if m.get('role') == 'assistant':
            continue
        blocks = m.get('content') if isinstance(m.get('content'), list) else [{'type': 'text', 'text': str(m.get('content', ''))}]
        for b in blocks:
            if b.get('type') == 'tool_result':
                continue
            yield f'messages[{i}]', b.get('text', '') if b.get('type') == 'text' else json.dumps(b)
    for t in body.get('tools') or []:
        if not str(t.get('name', '')).startswith('mcp__'):  # MCP tool schemas come from the tools themselves
            yield f"tools:{t.get('name')}", json.dumps(t)


def main():
    run = sys.argv[1]
    cfg = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--config-dir']
    cm = claude_md_needles(cfg)
    files = sorted(glob.glob(os.path.join(run, 'transcripts', '*.mock.jsonl')))
    n_req, hits = 0, []
    for f in files:
        for line in open(f):
            rec = json.loads(line)
            body = rec.get('body') or {}
            if not body.get('messages'):
                continue
            n_req += 1
            for where, text in segments(body):
                low = text.lower()
                for n, label in cm.items():
                    if n.lower() in low:
                        hits.append((os.path.basename(f), where, label))
                for n in SKILL_NEEDLES + MEMORY_NEEDLES:
                    if n.lower() in low:
                        hits.append((os.path.basename(f), where, n))
    print(json.dumps({'run': os.path.basename(os.path.normpath(run)), 'recorded_files': len(files), 'requests_scanned': n_req,
                      'claude_md_needles': len(cm), 'config_dirs': len(cfg), 'hits': [list(h) for h in hits[:50]], 'n_hits': len(hits)}))
    sys.exit(1 if hits else 0)


if __name__ == '__main__':
    main()
