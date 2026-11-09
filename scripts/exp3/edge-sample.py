#!/usr/bin/env python3
"""Experiment 3 (M2.2 audit): seeded sample of new-rule edges from a pinned graph for an independent precision audit.
Dispatch is sampled as producer->handler PAIRS through a key node (the unit whose correctness matters)."""
import json, random, sqlite3, sys
graph, repo, out = sys.argv[1], sys.argv[2], sys.argv[3]
db = sqlite3.connect(graph + '/graph.sqlite')
nodes = {r[0]: {'type': r[1], 'name': r[2], 'q': r[3], 'file': r[4], 'line': r[5]} for r in db.execute('select id,type,name,qualified_name,file,start_line from nodes')}
E = [dict(zip(['type', 'src', 'dst', 'file', 'line', 'extraction', 'evidence', 'meta'], r)) for r in db.execute(
    "select type,src,dst,file,line,extraction,evidence,meta from edges where extraction in ('keyed-dispatch','graphql-decorator') or extraction like '%-query-builder'")]
rnd = random.Random(20261110)
pub = [e for e in E if e['type'] == 'PUBLISHES_EVENT' and e['extraction'] == 'keyed-dispatch' and not json.loads(e['meta']).get('owner')]
con = [e for e in E if e['type'] == 'CONSUMES_EVENT']
pairs = [(p, c) for p in pub for c in con if c['dst'] == p['dst']]
rnd.shuffle(pairs)
gql = [e for e in E if e['extraction'] == 'graphql-decorator' and e['type'] == 'ROUTES_TO']
qb = [e for e in E if e['extraction'].endswith('-query-builder') and not json.loads(e['meta']).get('owner')]
rnd.shuffle(gql); rnd.shuffle(qb)
sample = []
def loc(nid): n = nodes.get(nid, {}); return f"{n.get('file')}:{n.get('line')} {n.get('q') or n.get('name')}"
for p, c in pairs[:35]:
    sample.append({'kind': 'dispatch_pair', 'key': nodes[p['dst']]['name'], 'producer': loc(p['src']), 'producer_site': f"{p['file']}:{p['line']}", 'producer_evidence': p['evidence'], 'handler': loc(c['src']), 'handler_registration': f"{c['file']}:{c['line']}", 'handler_evidence': c['evidence']})
for e in (gql if gql else qb)[:15]:
    sample.append({'kind': 'graphql_route' if e['extraction'] == 'graphql-decorator' else 'query_builder', 'source': loc(e['src']) if e['type'] != 'ROUTES_TO' else nodes[e['src']]['name'], 'target': loc(e['dst']), 'site': f"{e['file']}:{e['line']}", 'evidence': e['evidence']})
if gql and qb:
    for e in qb[:10]:
        sample.append({'kind': 'query_builder', 'source': loc(e['src']), 'target': nodes[e['dst']]['name'], 'site': f"{e['file']}:{e['line']}", 'evidence': e['evidence']})
for i, s in enumerate(sample): s['id'] = f'{repo}-{i + 1:02d}'
json.dump({'repo': repo, 'graph': graph, 'population': {'dispatch_pairs': len(pairs), 'graphql_routes': len(gql), 'query_builder_edges': len(qb)}, 'seed': 20261110, 'sample': sample}, open(out, 'w'), indent=1)
print(repo, len(sample), {'pairs': len(pairs), 'gql': len(gql), 'qb': len(qb)})
