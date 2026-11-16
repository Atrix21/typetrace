#!/usr/bin/env python3
"""Experiment 6: cross-encoder reranking of a variant's top-50 candidates (local model, no API).

  vendor/.venvs/embeddings/bin/python scripts/exp6/rerank.py --model BAAI/bge-reranker-base --cands a.jsonl,b.jsonl --out scores.jsonl

Writes one line per task: {"task_id", "model", "scores": [float per candidate, in candidate order], "seconds"}.
Scoring only; fusion and metrics are in rerank_eval.py so they can be recomputed without the model."""
import argparse, json, time, os
os.environ.setdefault('HF_HUB_OFFLINE', '1')
ap = argparse.ArgumentParser()
ap.add_argument('--model', required=True); ap.add_argument('--cands', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--max-len', type=int, default=512); ap.add_argument('--batch', type=int, default=16); ap.add_argument('--query-chars', type=int, default=1200)
a = ap.parse_args()
import torch
device = 'cuda' if torch.cuda.is_available() else 'cpu'
INSTRUCT = 'Given a bug report or a question about a codebase, retrieve the source code that is relevant to it'
if 'Qwen3-Reranker' in a.model:
    # Generative reranker: P("yes") vs P("no") at the last position, with the prompt format of the model card.
    from transformers import AutoModelForCausalLM, AutoTokenizer
    tok = AutoTokenizer.from_pretrained(a.model, padding_side='left')
    lm = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=torch.float16 if device == 'cuda' else torch.float32).to(device).eval()
    yes, no = tok.convert_tokens_to_ids('yes'), tok.convert_tokens_to_ids('no')
    pre = tok.encode('<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n', add_special_tokens=False)
    suf = tok.encode('<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n', add_special_tokens=False)
    class M:
        def predict(self, pairs, batch_size=8, show_progress_bar=False):
            out = []
            order = sorted(range(len(pairs)), key=lambda i: len(pairs[i][1]))
            for b in range(0, len(order), batch_size):
                idx = order[b:b + batch_size]
                texts = [f'<Instruct>: {INSTRUCT}\n<Query>: {pairs[i][0]}\n<Document>: {pairs[i][1]}' for i in idx]
                enc = tok(texts, add_special_tokens=False, truncation=True, max_length=a.max_len - len(pre) - len(suf))['input_ids']
                enc = tok.pad({'input_ids': [pre + e + suf for e in enc]}, padding=True, return_tensors='pt').to(device)
                with torch.no_grad(): lg = lm.lm_head(lm.model(**enc).last_hidden_state[:, -1, :])   # vocabulary logits for the last position only
                p = torch.softmax(torch.stack([lg[:, no], lg[:, yes]], dim=1).float(), dim=1)[:, 1].tolist()
                out.extend(zip(idx, p))
            return [s for _, s in sorted(out)]
    m = M()
else:
    from sentence_transformers import CrossEncoder
    m = CrossEncoder(a.model, device=device, max_length=a.max_len)
    if device == 'cuda': m.model.half()
done = set()
if os.path.exists(a.out):
    for l in open(a.out): done.add(json.loads(l)['task_id'])
out = open(a.out, 'a')
for f in a.cands.split(','):
    for l in open(f):
        t = json.loads(l)
        if t['task_id'] in done: continue
        q = t['query'][:a.query_chars]
        pairs = [(q, f"// {c['file']} {c['symbol']}\n{c['text']}") for c in t['cands']]
        t0 = time.time()
        s = m.predict(pairs, batch_size=a.batch, show_progress_bar=False)
        out.write(json.dumps({'task_id': t['task_id'], 'model': a.model, 'device': device, 'scores': [float(x) for x in s], 'seconds': round(time.time() - t0, 2)}) + '\n'); out.flush()
        print(t['task_id'], len(pairs), round(time.time() - t0, 2), 's', flush=True)
