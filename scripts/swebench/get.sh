#!/bin/sh
# Fetch SWE-bench Lite (test, 300 rows) into .cache/swebench/lite-test.json; compare its SHA-256 with experiments/05-swebench-python/FROZEN.json
set -e
mkdir -p .cache/swebench
for off in 0 100 200; do curl -sSf "https://datasets-server.huggingface.co/rows?dataset=princeton-nlp/SWE-bench_Lite&config=default&split=test&offset=$off&length=100" -o .cache/swebench/rows-$off.json; done
python3 -c "import json;rows=[r['row'] for o in (0,100,200) for r in json.load(open(f'.cache/swebench/rows-{o}.json'))['rows']];json.dump(rows,open('.cache/swebench/lite-test.json','w'))"
sha256sum .cache/swebench/lite-test.json
