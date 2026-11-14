#!/usr/bin/env python3
"""
LOCOMO retrieval recall@10 on an OPEN protocol (graphify's own LOCOMO harness is not public).

Protocol (identical to the independent replication github.com/devkancheti4-design/model-d-graphify, bench/locomo_eval.py):
  * data: locomo10.json from snap-research/locomo (not redistributed; fetched by scripts/locomo/get.sh)
  * questions: categories 1-4 with at least one evidence id (category 5 is adversarial, no answer in the conversation)
  * unit: one dialogue turn, text "Speaker (session date): text [shares a photo: caption]"; one index per conversation
  * recall@10 per question = |evidence turns in top 10| / |evidence turns|; reported = mean over questions
  * rows: all questions, and the seeded sample random.Random(20261010).sample(rows, 300)

Methods (no LLM anywhere):
  bm25        k1=1.5, b=0.75, \\w+ lower-cased tokens
  dense       Qwen3-Embedding-0.6B (the embedder of this project), cosine, query instruction as recommended by Qwen
  hybrid      reciprocal-rank fusion (k=60) of bm25 and dense top-100
  hybrid_rr   hybrid top-50 re-ranked by the BAAI/bge-reranker-base cross-encoder

  vendor/.venvs/embeddings/bin/python -I scripts/locomo/eval.py --data .cache/locomo/locomo10.json --out experiments/04-locomo
"""
import argparse, json, math, os, random, re, statistics, sys, time
from collections import Counter

TOK = re.compile(r'\w+')
QWEN = 'Qwen/Qwen3-Embedding-0.6B'
RERANK = 'BAAI/bge-reranker-base'
INSTR = 'Instruct: Given a question about a long conversation, retrieve the dialogue turns that answer it\nQuery: '


def turns_of(conv):
    c = conv['conversation']
    out = []
    n = 1
    while f'session_{n}' in c:
        date = c.get(f'session_{n}_date_time', '')
        for t in c[f'session_{n}']:
            txt = f"{t['speaker']} ({date}): {t['text']}"
            if t.get('blip_caption'):
                txt += f" [shares a photo: {t['blip_caption']}]"
            out.append((t['dia_id'], txt))
        n += 1
    return out


def evidence(q):
    ev = set()
    for e in q.get('evidence', []):
        for x in re.split(r'[;,\s]+', e):
            if re.fullmatch(r'D\d+:\d+', x):
                ev.add(x)
    return ev


class BM25:
    def __init__(self, docs, k1=1.5, b=0.75):
        self.toks = [TOK.findall(d.lower()) for d in docs]
        self.k1, self.b = k1, b
        self.N = len(docs)
        self.avg = sum(map(len, self.toks)) / self.N
        self.df = Counter(w for t in self.toks for w in set(t))
        self.tf = [Counter(t) for t in self.toks]

    def scores(self, q):
        qs = TOK.findall(q.lower())
        out = []
        for i, tf in enumerate(self.tf):
            s, L = 0.0, len(self.toks[i])
            for w in qs:
                f = tf.get(w)
                if not f:
                    continue
                idf = math.log(1 + (self.N - self.df[w] + 0.5) / (self.df[w] + 0.5))
                s += idf * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * L / self.avg))
            out.append(s)
        return out


def rank(scores):
    return sorted(range(len(scores)), key=lambda i: (-scores[i], i))


def rrf(*rankings, k=60, depth=100):
    s = Counter()
    for r in rankings:
        for pos, i in enumerate(r[:depth]):
            s[i] += 1 / (k + pos + 1)
    return sorted(s, key=lambda i: (-s[i], i))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--device', default='cuda')
    a = ap.parse_args()
    import torch
    from sentence_transformers import SentenceTransformer, CrossEncoder
    dev = a.device if (a.device != 'cuda' or torch.cuda.is_available()) else 'cpu'
    emb = SentenceTransformer(QWEN, device=dev, model_kwargs={'torch_dtype': torch.float16} if dev == 'cuda' else {})
    ce = CrossEncoder(RERANK, device=dev, max_length=512)
    data = json.load(open(a.data))
    rows = []
    t0 = time.time()
    for ci, conv in enumerate(data):
        T = turns_of(conv)
        ids = [i for i, _ in T]
        docs = [d for _, d in T]
        bm = BM25(docs)
        D = emb.encode(docs, batch_size=32, normalize_embeddings=True, convert_to_tensor=True)
        qs = [q for q in conv['qa'] if q.get('category') != 5 and evidence(q)]
        Q = emb.encode([INSTR + q['question'] for q in qs], batch_size=32, normalize_embeddings=True, convert_to_tensor=True)
        sims = (Q @ D.T).float().cpu().tolist()
        for qi, q in enumerate(qs):
            ev = evidence(q)
            r_bm = rank(bm.scores(q['question']))
            r_de = rank(sims[qi])
            r_hy = rrf(r_bm, r_de)
            cand = r_hy[:50]
            ce_s = ce.predict([(q['question'], docs[i]) for i in cand], batch_size=50).tolist()
            r_rr = [cand[j] for j in sorted(range(len(cand)), key=lambda j: (-ce_s[j], j))]
            rec = {'conv': conv.get('sample_id', ci), 'category': q['category'], 'question': q['question'], 'n_evidence': len(ev)}
            for name, r in [('bm25', r_bm), ('dense', r_de), ('hybrid', r_hy), ('hybrid_rr', r_rr)]:
                top = [ids[i] for i in r[:10]]
                rec[name] = len(ev & set(top)) / len(ev)
            rows.append(rec)
        print(f'conv {ci + 1}/{len(data)}: {len(qs)} questions, {len(T)} turns, {time.time() - t0:.0f}s', file=sys.stderr)
    sample = random.Random(20261010).sample(rows, 300)
    methods = ['bm25', 'dense', 'hybrid', 'hybrid_rr']
    res = {'protocol': 'open LOCOMO turn-level recall@10, categories 1-4 (see docstring)', 'embedder': QWEN, 'reranker': RERANK,
           'n_all': len(rows), 'all': {m: statistics.fmean(r[m] for r in rows) for m in methods},
           'sample300': {m: statistics.fmean(r[m] for r in sample) for m in methods},
           'by_category': {c: {m: statistics.fmean(r[m] for r in rows if r['category'] == c) for m in methods} for c in sorted({r['category'] for r in rows})}}
    os.makedirs(a.out, exist_ok=True)
    json.dump(res, open(os.path.join(a.out, 'locomo-recall.json'), 'w'), indent=1)
    with open(os.path.join(a.out, 'locomo-per-question.jsonl'), 'w') as f:
        for r in rows:
            f.write(json.dumps({k: v for k, v in r.items() if k != 'question'}) + '\n')
    print(json.dumps(res, indent=1))


if __name__ == '__main__':
    main()
