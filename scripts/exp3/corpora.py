#!/usr/bin/env python3
"""
Experiment 3 (M2.7): import-graph communities and nested corpora. Uses ONLY the import graph (file -> file IMPORTS
edges, which any TypeScript resolver yields identically) and file sizes; never a retrieval result (E3-D08, E3-D10).

  communities --name twenty --graph .cache/exp3/graph-twenty --repo <corpus root> --out manifests/communities-twenty.json
  nested --communities manifests/communities-twenty.json --tasks <dir of v2 task json> --targets 97000,300000
         --seed 20261110 --out manifests/corpora-twenty.json

Nested corpora per task, for each target size (corpus lines incl. tests) and each strategy:
  community: start from the communities holding the ground-truth files, then add whole communities in order of
             community-graph distance from them (BFS hops; ties: fewer lines first, then id) until the target is met;
  random:    same start, then whole communities in a seeded random order (seed = base seed + stable task hash).
Whole communities keep local structure intact; the random strategy is the sensitivity condition that does not use
graph proximity to decide what surrounds the task. Ground-truth files are asserted present in every corpus.
"""
import argparse, hashlib, json, os, random, sqlite3, sys
from collections import defaultdict, deque

import networkx as nx
from networkx.algorithms.community import louvain_communities, modularity

TEST = ('.spec.', '.test.', '/__tests__/', '/test/', '/tests/', 'e2e')


def file_lines(root, rel):
    try:
        with open(os.path.join(root, rel), encoding='utf-8', errors='ignore') as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def cmd_communities(a):
    db = sqlite3.connect(os.path.join(a.graph, 'graph.sqlite'))
    files = sorted(r[0][len('file:'):] for r in db.execute("select id from nodes where type='file'"))
    G = nx.Graph()
    G.add_nodes_from(files)
    for s, d in db.execute("select src, dst from edges where type='IMPORTS'"):
        if s.startswith('file:') and d.startswith('file:'):
            u, v = s[5:], d[5:]
            if u != v and u in G and v in G:
                G.add_edge(u, v, weight=G[u][v]['weight'] + 1 if G.has_edge(u, v) else 1)
    comms = louvain_communities(G, weight='weight', seed=a.seed, resolution=a.resolution)
    comms = sorted((sorted(c) for c in comms), key=lambda c: (-len(c), c[0]))
    of = {f: i for i, c in enumerate(comms) for f in c}
    lines = {f: file_lines(a.repo, f) for f in files}
    out = {
        'generated_by': 'scripts/exp3/corpora.py communities', 'name': a.name, 'graph': os.path.relpath(a.graph), 'seed': a.seed,
        'definition': 'Louvain (networkx, weight = number of import statements) on the undirected file import graph', 'resolution': a.resolution,
        'files': len(files), 'import_edges': G.number_of_edges(), 'modularity_Q': round(modularity(G, comms, weight='weight'), 4),
        'total_lines': sum(lines.values()),
        'communities': [{'id': i, 'files': c, 'lines': sum(lines[f] for f in c)} for i, c in enumerate(comms)],
        'community_edges': sorted([[min(of[u], of[v]), max(of[u], of[v]), d['weight']] for u, v, d in G.edges(data=True) if of[u] != of[v]]),
    }
    agg = defaultdict(int)
    for x, y, w in out['community_edges']:
        agg[(x, y)] += w
    out['community_edges'] = [[x, y, w] for (x, y), w in sorted(agg.items())]
    json.dump(out, open(a.out, 'w'))
    print(f"{a.name}: {len(files)} files, {len(comms)} communities, Q={out['modularity_Q']}, {out['total_lines']} lines -> {a.out}")


def stable_hash(s):
    return int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)


def cmd_nested(a):
    C = json.load(open(a.communities))
    comms = C['communities']
    of = {f: c['id'] for c in comms for f in c['files']}
    size = {c['id']: c['lines'] for c in comms}
    adj = defaultdict(set)
    for x, y, _ in C['community_edges']:
        adj[x].add(y); adj[y].add(x)
    targets = [int(t) for t in a.targets.split(',')]
    tasks = []
    for fn in sorted(os.listdir(a.tasks)):
        if fn.endswith('.json'):
            t = json.load(open(os.path.join(a.tasks, fn)))
            tasks.append(t)
    out = {'generated_by': 'scripts/exp3/corpora.py nested', 'communities': os.path.relpath(a.communities), 'seed': a.seed,
           'targets_lines': targets, 'full_lines': C['total_lines'], 'tasks': {}}
    for t in tasks:
        gt_files = sorted({k.split('::')[0] for k in t.get('relevant_symbols', [])} | set(t.get('relevant_files', [])))
        missing = [f for f in gt_files if f not in of]
        if missing:
            print(f"skip {t['task_id']}: ground-truth files not in communities: {missing[:3]}", file=sys.stderr)
            continue
        start = sorted({of[f] for f in gt_files})
        # community order: BFS distance from the start set
        dist = {c: 0 for c in start}
        q = deque(start)
        while q:
            c = q.popleft()
            for n in sorted(adj[c]):
                if n not in dist:
                    dist[n] = dist[c] + 1
                    q.append(n)
        far = max(dist.values(), default=0) + 1
        bfs_order = sorted((c['id'] for c in comms if c['id'] not in start), key=lambda c: (dist.get(c, far), size[c], c))
        rnd = random.Random(a.seed + stable_hash(t['task_id']))
        rand_order = [c['id'] for c in comms if c['id'] not in start]
        rnd.shuffle(rand_order)
        entry = {'gt_files': gt_files, 'start_communities': start, 'start_lines': sum(size[c] for c in start), 'corpora': []}
        for strategy, order in (('community', bfs_order), ('random', rand_order)):
            for target in targets:
                chosen = list(start)
                total = sum(size[c] for c in chosen)
                for c in order:
                    if total >= target:
                        break
                    chosen.append(c)
                    total += size[c]
                files = sorted(f for c in chosen for f in comms[c]['files'])
                assert all(f in set(files) for f in gt_files)
                h = hashlib.sha256('\n'.join(files).encode()).hexdigest()
                entry['corpora'].append({'strategy': strategy, 'target_lines': target, 'lines': total, 'files': len(files),
                                         'communities': sorted(chosen), 'files_sha256': h,
                                         'max_bfs_distance': max((dist.get(c, far) for c in chosen), default=0)})
        out['tasks'][t['task_id']] = entry
    json.dump(out, open(a.out, 'w'), indent=1)
    print(f"nested corpora for {len(out['tasks'])} tasks -> {a.out}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('communities')
    c.add_argument('--name', required=True); c.add_argument('--graph', required=True); c.add_argument('--repo', required=True)
    c.add_argument('--out', required=True); c.add_argument('--seed', type=int, default=20261110)
    c.add_argument('--resolution', type=float, default=1.0)
    n = sub.add_parser('nested')
    n.add_argument('--communities', required=True); n.add_argument('--tasks', required=True); n.add_argument('--targets', required=True)
    n.add_argument('--out', required=True); n.add_argument('--seed', type=int, default=20261110)
    a = ap.parse_args()
    {'communities': cmd_communities, 'nested': cmd_nested}[a.cmd](a)


if __name__ == '__main__':
    main()
