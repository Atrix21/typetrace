#!/usr/bin/env python3
"""
Experiment 11: isolation and setup checks on a mock run (protocol, "Isolation and setup checks").

  python3 scripts/exp11/setup_check.py experiments/11-vendor-setups/results/<mock run> [--positive-control]

Reads every request the agent sent to the mock server (transcripts/*.mock.jsonl) and checks, per arm:
1. No leaks: no line of the owner's CLAUDE.md files (24+ characters), none of the owner's own skill names, no
   memory markers, nothing matching the private-pattern list. Matches are counted, never printed.
2. Setup delivered: each arm's own instructions, skill listing and hook text reach the model.
3. No crossover: no arm's request carries another arm's instructions, skill or hook text.
Exit status 1 on any failure. With --positive-control the leak detectors must FIRE (for a run made with isolation off).
"""
import glob, json, os, re, sys

RUN = sys.argv[1]
POSITIVE = '--positive-control' in sys.argv
HOME = os.path.expanduser('~')
CFG_DIRS = [os.path.join(HOME, '.claude')] + sorted(glob.glob(os.path.join(HOME, '.config', 'claude-accounts', '*')))
MARKERS = {
    'TS': {'instructions': 'This repository is indexed by TypeTrace', 'skill': 'Covers querying TypeTrace', 'hook': 'TypeTrace: this repository is indexed'},
    'GF': {'instructions': 'This project has a knowledge graph at graphify-out/', 'skill': 'graphify', 'hook': 'graphify: this project has a knowledge graph'},
    'CR': {'instructions': 'MCP Tools: code-review-graph', 'skill': 'explore-codebase'},
}
MEMORY = ['MEMORY.md', 'auto memory', 'memory directory', 'auto-memory']

def owner_lines():
    out = set()
    for d in CFG_DIRS:
        f = os.path.join(d, 'CLAUDE.md')
        if os.path.isfile(f):
            for l in open(f, encoding='utf8', errors='replace'):
                l = l.strip()
                if len(l) >= 24: out.add(l[:70])
    return out

def owner_skills():
    names = set()
    for d in CFG_DIRS:
        s = os.path.join(d, 'skills')
        if os.path.isdir(s): names |= set(os.listdir(s))
    return names

def private_patterns():
    f = os.path.join(HOME, 'dev', 'backups', 'private-patterns.txt')
    if not os.path.isfile(f): return []
    pats = []
    for l in open(f):
        l = l.strip()
        if l and not l.startswith('#'):
            try: pats.append(re.compile(l, re.I))
            except re.error: pass
    return pats

def texts(body, with_results):
    sys_ = body.get('system') or []
    if isinstance(sys_, str): sys_ = [{'text': sys_}]
    for s in sys_: yield str(s.get('text', ''))
    for m in body.get('messages') or []:
        if m.get('role') == 'assistant': continue
        blocks = m.get('content') if isinstance(m.get('content'), list) else [{'type': 'text', 'text': str(m.get('content', ''))}]
        for b in blocks:
            if b.get('type') == 'tool_result' and not with_results: continue
            yield b.get('text', '') if b.get('type') == 'text' else json.dumps(b)
    for t in body.get('tools') or []: yield json.dumps(t)

ol, osk, pp = owner_lines(), owner_skills(), private_patterns()
# The arms' own skill names are expected where they belong; Claude Code's bundled ones in every arm.
builtins = set(json.load(open('experiments/11-vendor-setups/claude-builtins.json'))['skills'])
arm_skills = {'TS': {'typetrace'}, 'GF': {'graphify'}, 'CR': {'debug-issue', 'explore-codebase', 'refactor-safely', 'review-changes'}}
fail, report = False, {}
for f in sorted(glob.glob(os.path.join(RUN, 'transcripts', '*.mock.jsonl'))):
    base = os.path.basename(f)
    arm = base.split('_')[-2] if base.count('_') >= 2 else '?'
    m = re.search(r'_(G0|TT|TS|GF|CR)_r\d', base); arm = m.group(1) if m else arm
    reqs = [json.loads(l)['body'] for l in open(f) if l.strip() and json.loads(l).get('body')]
    ctrl = '\n'.join(t for b in reqs for t in texts(b, False))     # what the harness and the setup put in
    allt = '\n'.join(t for b in reqs for t in texts(b, True))      # plus tool results (hook context arrives there)
    r = {'requests': len(reqs)}
    r['owner_claude_md_lines'] = sum(1 for l in ol if l in ctrl)
    listed = set(re.findall(r'"name":\s*"([^"]+)"', ctrl)) | set(re.findall(r'^- ([A-Za-z0-9_:.-]+):', ctrl, re.M))
    r['owner_skills'] = len([s for s in osk if s not in builtins and s not in arm_skills.get(arm, set()) and (f'- {s}:' in ctrl or f'"{s}"' in ctrl)])
    r['memory_markers'] = sum(1 for n in MEMORY if n in ctrl)
    r['private_pattern_hits'] = sum(1 for p in pp if p.search(allt))
    leaks = r['owner_claude_md_lines'] + r['owner_skills'] + r['memory_markers'] + r['private_pattern_hits']
    if POSITIVE:
        if leaks == 0: fail = True; r['FAIL'] = 'positive control: no leak detected'
    elif leaks: fail = True; r['FAIL'] = 'leak'
    for a, mk in MARKERS.items():
        for k, v in mk.items():
            hay = allt if k == 'hook' else ctrl
            present = (f'- {v}:' in ctrl or f'"{v}"' in ctrl or v in ctrl) if k == 'skill' and v in ('graphify', 'explore-codebase') else v in hay
            r[f'{a}.{k}'] = present
            if not POSITIVE and a == arm and not present: fail = True; r.setdefault('FAIL', f'{a} {k} not delivered')
            if not POSITIVE and a != arm and present and not (a == 'GF' and k == 'skill' and arm not in ('GF',) and 'graphify' in v and '- graphify:' not in ctrl):
                fail = True; r.setdefault('FAIL', f'crossover: {a} {k} in {arm}')
    if arm in ('TT', 'TS', 'CR'):
        r['mcp_tool'] = any(t.get('name', '').startswith('mcp__') for b in reqs for t in (b.get('tools') or []))
        if not r['mcp_tool'] and not POSITIVE: fail = True; r.setdefault('FAIL', 'no MCP tool offered')
    r['bash_tool'] = any(t.get('name') == 'Bash' for b in reqs for t in (b.get('tools') or []))
    if not POSITIVE and r['bash_tool'] != (arm == 'GF'): fail = True; r.setdefault('FAIL', 'Bash offered outside GF' if r['bash_tool'] else 'Bash missing in GF')
    report[base] = r
print(json.dumps(report, indent=1))
print('FAIL' if fail else 'OK')
sys.exit(1 if fail else 0)
