#!/usr/bin/env python3
"""
Local OpenAI-compatible /v1/embeddings endpoint serving Qwen3-Embedding-0.6B (the embedder TypeTrace uses), so that
code-review-graph can be run with the SAME embedding model as ours (fairness control, Amendment D2b). 127.0.0.1 only.

  vendor/.venvs/embeddings/bin/python -I scripts/competitors/openai_embed_server.py --port 0
Prints {"ready": true, "port": N} on stdout. Texts are embedded as sent (code-review-graph sends no query instruction).
"""
import argparse, json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

MODEL = 'Qwen/Qwen3-Embedding-0.6B'
REVISION = '97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=0)
    ap.add_argument('--device', default=None)
    a = ap.parse_args()
    import torch
    from sentence_transformers import SentenceTransformer
    dev = a.device or ('cuda' if torch.cuda.is_available() else 'cpu')
    m = SentenceTransformer(MODEL, revision=REVISION, device=dev, **({'model_kwargs': {'dtype': torch.float16}} if dev == 'cuda' else {}))
    lock = threading.Lock()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *x):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get('content-length', 0))) or b'{}')
            inp = body.get('input', [])
            if isinstance(inp, str):
                inp = [inp]
            with lock:
                vecs = m.encode(inp, batch_size=16, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
            out = {'object': 'list', 'model': body.get('model', MODEL),
                   'data': [{'object': 'embedding', 'index': i, 'embedding': [float(x) for x in v]} for i, v in enumerate(vecs)],
                   'usage': {'prompt_tokens': 0, 'total_tokens': 0}}
            data = json.dumps(out).encode()
            self.send_response(200)
            self.send_header('content-type', 'application/json')
            self.send_header('content-length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    srv = ThreadingHTTPServer(('127.0.0.1', a.port), H)
    print(json.dumps({'ready': True, 'port': srv.server_address[1], 'model': MODEL, 'device': dev}), flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
