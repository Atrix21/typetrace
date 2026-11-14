#!/bin/sh
# Fetch LOCOMO (snap-research/locomo, not redistributed here) into .cache/locomo/
mkdir -p .cache/locomo && curl -sSfL -o .cache/locomo/locomo10.json https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json && sha256sum .cache/locomo/locomo10.json
