#!/usr/bin/env python3
"""
Experiment 10: freeze the pilot set and the order of the main pool (run once, before any agent run).

  python3 scripts/swebench/select_agent_issues.py   -> experiments/10-swebench-agents/selection.json

- Pilot: 15 SWE-bench Lite + 15 Multilingual issues, drawn at random (seed below). They are never in the main pool.
- Main pool: every other issue, in a seeded random order that alternates Lite and Multilingual. The first n issues are
  therefore a random sample, balanced across the two benchmarks, for whatever n the power analysis fixes.
"""
import hashlib, json, random

SEED = 20261118
lite = sorted(x['instance_id'] for x in json.load(open('.cache/swebench/lite-test.json')))
ml = sorted(x['instance_id'] for x in json.load(open('.cache/swebench-ml/ml-test.json')))
r = random.Random(SEED)
r.shuffle(lite); r.shuffle(ml)
pilot = lite[:15] + ml[:15]
rest_l, rest_m = lite[15:], ml[15:]
main = []
for i in range(max(len(rest_l), len(rest_m))):
    if i < len(rest_l): main.append(rest_l[i])
    if i < len(rest_m): main.append(rest_m[i])
src = {f: hashlib.sha256(open(f, 'rb').read()).hexdigest() for f in ['.cache/swebench/lite-test.json', '.cache/swebench-ml/ml-test.json']}
json.dump({'seed': SEED, 'sources_sha256': src, 'pilot': pilot, 'main': main}, open('experiments/10-swebench-agents/selection.json', 'w'), indent=1)
print(f'pilot {len(pilot)} (15 + 15), main pool {len(main)}')
