#!/bin/sh
# Fetch SWE-bench Multilingual (test, 300 rows) into .cache/swebench-ml/ml-test.json; compare its SHA-256 with experiments/08-swebench-multilingual/FROZEN.json
set -e
mkdir -p .cache/swebench-ml
for off in 0 100 200; do curl -sSf "https://datasets-server.huggingface.co/rows?dataset=SWE-bench/SWE-bench_Multilingual&config=default&split=test&offset=$off&length=100" -o .cache/swebench-ml/rows-$off.json; done
python3 -c "import json;rows=[r['row'] for o in (0,100,200) for r in json.load(open(f'.cache/swebench-ml/rows-{o}.json'))['rows']];json.dump(rows,open('.cache/swebench-ml/ml-test.json','w'))"
sha256sum .cache/swebench-ml/ml-test.json
