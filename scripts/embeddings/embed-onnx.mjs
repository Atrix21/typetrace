#!/usr/bin/env node
/**
 * Node (ONNX Runtime via transformers.js) twin of embed.py / embed_server.py: same model (Qwen3-Embedding-0.6B, ONNX
 * export), same query instruction, last-token pooling, L2 normalisation, same max sequence length, same I/O protocols.
 * No Python needed.
 *
 *   node embed-onnx.mjs --in items.jsonl --out vectors.jsonl [--batch 16] [--max-seq 1024] [--dtype fp32|fp16|q8]
 *   node embed-onnx.mjs --server [--max-seq 1024]        JSON lines on stdin/stdout: {"id","text","kind"} -> {"id","vector","tokens"}
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { AutoTokenizer, AutoModel, env } from '@huggingface/transformers';

export const ONNX_MODEL = 'onnx-community/Qwen3-Embedding-0.6B-ONNX';
export const ONNX_REVISION = 'c25a394dd583836952667c12f008335071b3f43d';
const QUERY_INSTRUCTION = 'Instruct: Given a natural-language bug report, retrieve the source code most relevant to it\nQuery: ';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const maxSeq = Number(opt('max-seq', '1024'));
const batch = Number(opt('batch', '16'));
const dtype = opt('dtype', process.env.TYPETRACE_EMBED_DTYPE || 'fp32');
if (process.env.TYPETRACE_MODEL_DIR) env.cacheDir = process.env.TYPETRACE_MODEL_DIR;

const tokenizer = await AutoTokenizer.from_pretrained(ONNX_MODEL, { revision: ONNX_REVISION });
tokenizer.padding_side = 'left'; // last-token pooling reads the final position; left padding keeps it the real last token
const device = opt('device', process.env.TYPETRACE_EMBED_DEVICE || 'cpu');
// No growing CPU arena: memory is returned between batches (large repositories embed tens of thousands of chunks).
const model = await AutoModel.from_pretrained(ONNX_MODEL, { revision: ONNX_REVISION, dtype, device, session_options: { enableCpuMemArena: false, enableMemPattern: false } });
const TOKEN_BUDGET = Number(opt('token-budget', process.env.TYPETRACE_EMBED_TOKEN_BUDGET || '4096'));

async function embed(texts) {
  const enc = tokenizer(texts, { padding: true, truncation: true, max_length: maxSeq });
  const out = await model(enc);
  const h = out.last_hidden_state ?? out.token_embeddings ?? Object.values(out)[0];
  const [n, len, dim] = h.dims;
  const data = h.data;
  const vecs = [];
  for (let i = 0; i < n; i++) {
    const off = (i * len + (len - 1)) * dim; // left padding: last position is the last real token
    const v = new Float32Array(dim);
    let norm = 0;
    for (let j = 0; j < dim; j++) { v[j] = data[off + j]; norm += v[j] * v[j]; }
    norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < dim; j++) v[j] /= norm;
    vecs.push(v);
  }
  const tokens = texts.map((t) => Math.min(tokenizer(t).input_ids.size, maxSeq));
  return { vecs, tokens };
}

const fmt = (v) => Array.from(v, (x) => Math.round(x * 1e6) / 1e6);

if (argv.includes('--server')) {
  process.stdout.write(JSON.stringify({ ready: true, model: ONNX_MODEL, revision: ONNX_REVISION, backend: 'onnx', dtype }) + '\n');
  let chain = Promise.resolve();
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    chain = chain.then(async () => {
      let d;
      try { d = JSON.parse(line); } catch { return; }
      try {
        const text = d.kind === 'doc' ? d.text : QUERY_INSTRUCTION + d.text;
        const { vecs, tokens } = await embed([text]);
        process.stdout.write(JSON.stringify({ id: d.id, vector: fmt(vecs[0]), tokens: tokens[0] }) + '\n');
      } catch (e) { process.stdout.write(JSON.stringify({ id: d.id, error: String(e?.message ?? e) }) + '\n'); }
    });
  });
} else {
  const items = fs.readFileSync(opt('in'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const out = fs.openSync(opt('out'), 'w');
  const t0 = Date.now();
  for (const kind of ['doc', 'query']) {
    const sel = items.filter((it) => it.kind === kind);
    const texts = sel.map((it) => (kind === 'query' ? QUERY_INSTRUCTION + it.text : it.text));
    const order = texts.map((_, i) => i).sort((a, b) => texts[a].length - texts[b].length);
    // Batches bounded by padded tokens (batch x longest sequence), not item count: attention memory grows with both.
    const lens = texts.map((t) => Math.min(tokenizer(t).input_ids.size, maxSeq));
    for (let s = 0; s < order.length;) {
      const idx = [];
      while (s < order.length && idx.length < batch && (idx.length + 1) * lens[order[s]] <= Math.max(TOKEN_BUDGET, lens[order[s]])) idx.push(order[s++]);
      const { vecs, tokens } = await embed(idx.map((i) => texts[i]));
      idx.forEach((i, j) => fs.writeSync(out, JSON.stringify({ id: sel[i].id, vector: fmt(vecs[j]), tokens: tokens[j] }) + '\n'));
    }
  }
  fs.closeSync(out);
  process.stderr.write(JSON.stringify({ model: ONNX_MODEL, backend: 'onnx', dtype, n: items.length, seconds: (Date.now() - t0) / 1000, max_seq: maxSeq }) + '\n');
}
