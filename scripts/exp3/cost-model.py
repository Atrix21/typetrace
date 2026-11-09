#!/usr/bin/env python3
"""
Experiment 3: single, transparent cost model for the (NOT approved, NOT run) agent stage. Planning only.

Reads frozen task counts from dataset/v2/FROZEN.json and writes cost-estimate tables (markdown) to stdout and
results/agent-cost-model.json. Every assumption is a named parameter below.

  python3 scripts/exp3/cost-model.py
"""
import json, os

EXP = 'experiments/03-graph-scale'
frozen = json.load(open(f'{EXP}/dataset/v2/FROZEN.json'))['repos']
n = {r: {'dev': v['dev'], 'test': v['test']} for r, v in frozen.items()}

# ---- per-run token profile (ASSUMPTIONS; experiment 2 measured ~5 turns / ~19.5k tokens / $0.022 per Sonnet run on
# 6k-line easy tasks. M/L tasks are expected to need 15-30 turns; the pilot replaces these numbers with measurements.)
PROFILE = {
    'low':     {'processed': 300_000, 'cache_write': 30_000, 'uncached_in': 5_000, 'output': 4_000},
    'central': {'processed': 600_000, 'cache_write': 50_000, 'uncached_in': 8_000, 'output': 8_000},
    'high':    {'processed': 1_500_000, 'cache_write': 80_000, 'uncached_in': 12_000, 'output': 15_000},
}
# list prices per million tokens (Claude API reference): Sonnet 5.5 $2/$10, cache read $0.20 (Claude Code reports $0.10),
# 1-hour cache write = 2x input; Haiku 5.5 $0.10/$0.50 (prompts <= 100K tokens; 5x above), cache read $0.01, 1h write $0.20.
PRICE = {'sonnet': {'in': 2.0, 'out': 10.0, 'read': 0.20, 'write1h': 4.0}, 'haiku': {'in': 0.10, 'out': 0.50, 'read': 0.01, 'write1h': 0.20}}
HAIKU_LONG_PROMPT_SHARE = {'low': 0.0, 'central': 0.1, 'high': 0.4}  # share of processed tokens in prompts > 100K (5x)
WINDOW_USD = 11.0  # experiment 2: $33.99 list-price over three Pro 5-hour windows (Sonnet-heavy); ASSUMED proportional
MIN_PER_RUN = {'low': 1.5, 'central': 3.0, 'high': 5.0}  # wall-clock minutes per sequential run


def run_cost(model, level):
    p, c = PROFILE[level], PRICE[model]
    read = p['processed'] - p['cache_write'] - p['uncached_in']
    mult = 1.0
    if model == 'haiku':
        mult = 1 + 4 * HAIKU_LONG_PROMPT_SHARE[level]
    return (read * c['read'] + p['cache_write'] * c['write1h'] + p['uncached_in'] * c['in']) / 1e6 * mult + p['output'] * c['out'] / 1e6


def plan(name, rows):
    out = {'plan': name, 'rows': [], 'total': {}}
    for lvl in ['low', 'central', 'high']:
        out['total'][lvl] = {'runs': 0, 'usd': 0.0, 'hours': 0.0, 'tokens_processed': 0, 'tokens_output': 0}
    for r in rows:
        runs = r['tasks'] * r['arms'] * r['repeats']
        row = {**r, 'runs': runs}
        for lvl in ['low', 'central', 'high']:
            usd = runs * run_cost(r['model'], lvl)
            row[f'usd_{lvl}'] = usd
            t = out['total'][lvl]
            t['runs'] += runs; t['usd'] += usd; t['hours'] += runs * MIN_PER_RUN[lvl] / 60
            t['tokens_processed'] += runs * PROFILE[lvl]['processed']; t['tokens_output'] += runs * PROFILE[lvl]['output']
        out['rows'].append(row)
    for lvl in out['total']:
        out['total'][lvl]['windows'] = out['total'][lvl]['usd'] / WINDOW_USD
    return out


L, M = n.get('twenty', {'dev': 0, 'test': 0}), n.get('immich', {'dev': 0, 'test': 0})
plans = [
    plan('minimum viable: L only, Haiku 5.5 (effort high), arms A0 baseline / A1 compact_nograph / A2 compact_graph', [
        {'stage': 'pilot (dev)', 'repo': 'L', 'model': 'haiku', 'tasks': L['dev'], 'arms': 3, 'repeats': 1},
        {'stage': 'main (test)', 'repo': 'L', 'model': 'haiku', 'tasks': L['test'], 'arms': 3, 'repeats': 3},
    ]),
    plan('full scale: M + L, Haiku A0-A2 x3, no-Grep A3/A4 on L x3, Sonnet 5.5 (effort high) A0/A2 on L x2', [
        {'stage': 'pilot (dev)', 'repo': 'M+L', 'model': 'haiku', 'tasks': M['dev'] + L['dev'], 'arms': 5, 'repeats': 1},
        {'stage': 'pilot (dev)', 'repo': 'L', 'model': 'sonnet', 'tasks': L['dev'], 'arms': 2, 'repeats': 1},
        {'stage': 'main (test)', 'repo': 'M+L', 'model': 'haiku', 'tasks': M['test'] + L['test'], 'arms': 3, 'repeats': 3},
        {'stage': 'main (test)', 'repo': 'L', 'model': 'haiku', 'tasks': L['test'], 'arms': 2, 'repeats': 3},
        {'stage': 'main (test)', 'repo': 'L', 'model': 'sonnet', 'tasks': L['test'], 'arms': 2, 'repeats': 2},
    ]),
]
res = {'task_counts': n, 'assumptions': {'profile_tokens_per_run': PROFILE, 'prices_per_mtok': PRICE, 'haiku_long_prompt_share': HAIKU_LONG_PROMPT_SHARE,
       'usd_per_pro_window': WINDOW_USD, 'minutes_per_run': MIN_PER_RUN}, 'per_run_usd': {m: {l: run_cost(m, l) for l in PROFILE} for m in PRICE}, 'plans': plans}
os.makedirs(f'{EXP}/results', exist_ok=True)
json.dump(res, open(f'{EXP}/results/agent-cost-model.json', 'w'), indent=1)
print('per-run list price (low / central / high):', {m: ' / '.join(f'${v:.3f}' for v in d.values()) for m, d in res['per_run_usd'].items()})
for p in plans:
    print(f"\n### {p['plan']}\n")
    print('| Stage | Repo | Model | Tasks | Arms | Repeats | Runs | List price low / central / high |')
    print('|---|---|---|---:|---:|---:|---:|---|')
    for r in p['rows']:
        print(f"| {r['stage']} | {r['repo']} | {r['model']} | {r['tasks']} | {r['arms']} | {r['repeats']} | {r['runs']} | ${r['usd_low']:.0f} / ${r['usd_central']:.0f} / ${r['usd_high']:.0f} |")
    t = p['total']
    print(f"| **total** | | | | | | **{t['central']['runs']}** | **${t['low']['usd']:.0f} / ${t['central']['usd']:.0f} / ${t['high']['usd']:.0f}** |")
    print(f"\nTokens processed (central): {t['central']['tokens_processed'] / 1e6:.0f}M input-side (mostly cache reads), {t['central']['tokens_output'] / 1e6:.1f}M output. "
          f"Wall clock (sequential): {t['low']['hours']:.0f}-{t['high']['hours']:.0f} h. Pro 5-hour windows if usage tracks list price: "
          f"{t['low']['windows']:.1f}-{t['high']['windows']:.1f}.")
