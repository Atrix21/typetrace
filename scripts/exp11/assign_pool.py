#!/usr/bin/env python3
"""
Experiment 11: assign the multi-file pool to the pilots and the two tasks, and fix T3's question order.
Run once, after prepare_pool.ts and before any agent run. Uses only the frozen pool order and the ground truth,
never a run result.

  python3 scripts/exp11/assign_pool.py   -> experiments/11-vendor-setups/data/assignment.json, t3-selection.json

T1/T2 (protocol, "The multi-file pool"):
- valid instances of data/tasks.jsonl, in pool order;
- caps: corpus at most MAX_FILES files; ground truth at most MAX_GT_FUNCS functions and MAX_GT_FILES files;
- assigned in pool order, alternating T1 and T2 within each language (so both get the same language mix): first the two pilots (PILOT each), then the two main lists
  (up to CAP each), with at most REPO_CAP instances of one repository per main list. No instance is in two lists.
  The runner takes the first n of a main list once the pilot has fixed n.
T3: SWE-QA's 15 repositories x 48 questions. Each repository's questions are shuffled with the seed; the pilot is
the first 2 of each (30); the main order interleaves the rest round-robin, so any prefix is balanced across
repositories.
"""
import json, random, collections

SEED = 20261120
MAX_FILES, MAX_GT_FUNCS, MAX_GT_FILES = 20_000, 30, 10
PILOT, CAP = 30, 250
REPO_CAP = int(0.15 * CAP)  # 37
D = 'experiments/11-vendor-setups/data/'

tasks = [json.loads(l) for l in open(D + 'tasks.jsonl')]
tasks.sort(key=lambda t: t['position'])
dropped = collections.Counter()
ok = []
for t in tasks:
    if t['files'] > MAX_FILES: dropped[f'corpus over {MAX_FILES} files'] += 1; continue
    if len(t['ground_truth']) > MAX_GT_FUNCS: dropped[f'ground truth over {MAX_GT_FUNCS} functions'] += 1; continue
    if len(t['gt_files']) > MAX_GT_FILES: dropped[f'ground truth over {MAX_GT_FILES} files'] += 1; continue
    ok.append(t)

out = {'pilot': {'T1': [], 'T2': []}, 'main': {'T1': [], 'T2': []}}
per_repo = {'T1': collections.Counter(), 'T2': collections.Counter()}
turn = collections.Counter()  # per language, so both tasks get the same language mix
for t in ok:
    for _ in range(2):  # try the task whose turn it is for this language, then the other
        task = ('T1', 'T2')[turn[t['language']] % 2]
        turn[t['language']] += 1
        if len(out['pilot'][task]) < PILOT:
            out['pilot'][task].append(t['task_id']); break
        if len(out['main'][task]) < CAP and per_repo[task][t['repo']] < REPO_CAP:
            out['main'][task].append(t['task_id']); per_repo[task][t['repo']] += 1; break
    # an instance neither task can take (both full, or its repository at the cap in both) stays unused

lang = {t['task_id']: t['language'] for t in tasks}
summary = {s: {k: dict(collections.Counter(lang[i] for i in v)) | {'n': len(v)} for k, v in out[s].items()} for s in out}
json.dump({'seed': SEED, 'caps': {'max_files': MAX_FILES, 'max_gt_functions': MAX_GT_FUNCS, 'max_gt_files': MAX_GT_FILES, 'pilot': PILOT, 'cap': CAP, 'repo_cap': REPO_CAP},
           'valid': len(tasks), 'dropped': dict(dropped), 'summary': summary, **out}, open(D + 'assignment.json', 'w'), indent=1)
print('valid', len(tasks), 'dropped', dict(dropped)); print(json.dumps(summary, indent=1))

repos = ['astropy', 'conan', 'django', 'flask', 'matplotlib', 'pylint', 'pytest', 'reflex', 'requests', 'scikit-learn', 'sphinx', 'sqlfluff', 'streamlink', 'sympy', 'xarray']
rnd = random.Random(SEED)
order = {}
for r in repos:
    n = sum(1 for _ in open(f'.cache/exp11/sweqa/{r}.jsonl'))
    idx = list(range(n)); rnd.shuffle(idx); order[r] = idx
pilot = [f'{r}#{i}' for r in repos for i in order[r][:2]]
main = [f'{r}#{order[r][k]}' for k in range(2, max(len(v) for v in order.values())) for r in repos if k < len(order[r])]
json.dump({'seed': SEED, 'pilot': pilot, 'main': main}, open(D + 't3-selection.json', 'w'), indent=1)
print('T3 pilot', len(pilot), 'main', len(main))
