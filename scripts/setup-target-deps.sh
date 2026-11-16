#!/usr/bin/env bash
# Benchmark target dependencies (type information for the TS checker), installed OUTSIDE the snapshot.
# Needed by `npm run setup:target` and the test suite; no Python and no competitors (see setup-competitors.sh).
set -euo pipefail
mkdir -p targets/deps
if [ ! -d targets/nestjs-boilerplate-upstream/.git ]; then git clone -q https://github.com/brocoders/nestjs-boilerplate.git targets/nestjs-boilerplate-upstream; fi
git -C targets/nestjs-boilerplate-upstream checkout -q 9620f159eefe38f47747d02ab162852367c5472c
cp targets/nestjs-boilerplate-upstream/package.json targets/nestjs-boilerplate-upstream/package-lock.json targets/deps/
(cd targets/deps && npm install --ignore-scripts --no-audit --no-fund --silent)
ln -sfn deps/node_modules targets/node_modules
