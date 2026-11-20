#!/usr/bin/env python3
"""
Experiment 11: freeze the order of the multi-file pool for T1 and T2 (run once, before any ground truth is derived).

  python3 scripts/exp11/select_pool.py   -> experiments/11-vendor-setups/pool-order.json

Sources (.cache/exp11/, converted from the Hugging Face parquet files; hashes recorded):
- SWE-bench, full test split, minus the 300 Lite instances (experiments 5 and 10 used them);
- SWE-PolyBench test split, minus the instances that are also in SWE-bench Multilingual (experiments 8 and 10).

Pre-filter, from the gold patch alone: at least 2 changed files that are not test files and have a source
extension of the four languages. The ground truth step (prepare_pool.ts) then applies the exact rule: the ground
truth must span at least 2 corpus files.

Order: each language (Python, TypeScript, JavaScript, Java) is shuffled with the seed, then the four are interleaved
round-robin, so any prefix has about equal shares while every language lasts. T1, T2 and their pilots are assigned
from this order later (assign_pool.py), so the order is fixed before anyone sees a ground truth or a run.
"""
import hashlib, json, random, re

SEED = 20261120
C = '.cache/exp11/'
LANGS = ['Python', 'TypeScript', 'JavaScript', 'Java']
EXT = re.compile(r'\.(py|pyi|ts|tsx|mts|cts|js|jsx|mjs|cjs|java)$')
TEST = re.compile(r'(^|/)(tests?|testing|__tests__|__mocks__|spec|specs|fixtures?)(/|$)|(^|/)test_[^/]*$|_test\.[a-z]+$|\.(test|spec)\.[a-z]+$|Tests?\.java$', re.I)

lite = {r['instance_id'] for r in json.load(open('.cache/swebench/lite-test.json'))}
ml = {r['instance_id'] for r in json.load(open('.cache/swebench-ml/ml-test.json'))}
rows = json.load(open(C + 'swebench-full.json')) + json.load(open(C + 'polybench.json'))

def files(patch):
    return sorted(set(re.findall(r'^diff --git a/(\S+) b/', patch, re.M)))

kept, dropped = {l: [] for l in LANGS}, {'lite': 0, 'multilingual': 0, 'under 2 source files': 0, 'other language': 0}
for r in rows:
    if r['instance_id'] in lite: dropped['lite'] += 1; continue
    if r['instance_id'] in ml: dropped['multilingual'] += 1; continue
    if r['language'] not in kept: dropped['other language'] += 1; continue
    src = [f for f in files(r['patch']) if EXT.search(f) and not TEST.search(f)]
    if len(src) < 2: dropped['under 2 source files'] += 1; continue
    kept[r['language']].append(r['instance_id'])

rnd = random.Random(SEED)
for l in LANGS:
    kept[l].sort()
    rnd.shuffle(kept[l])
order = []
for i in range(max(len(v) for v in kept.values())):
    for l in LANGS:
        if i < len(kept[l]): order.append({'id': kept[l][i], 'language': l})

src = {f: hashlib.sha256(open(f, 'rb').read()).hexdigest() for f in [C + 'swebench-full.json', C + 'polybench.json', C + 'full-test.parquet', C + 'polybench-test.parquet']}
json.dump({'seed': SEED, 'sources_sha256': src, 'dropped': dropped, 'counts': {l: len(v) for l, v in kept.items()}, 'order': order},
          open('experiments/11-vendor-setups/pool-order.json', 'w'), indent=1)
print('kept', {l: len(v) for l, v in kept.items()}, 'dropped', dropped, 'order', len(order))
