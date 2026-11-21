#!/bin/bash
# Copies the run logs from the game folder to data/runtime/<run name>/. Usage: BOX=user@host pull_logs.sh <run name>
: "${BOX:?set BOX=user@host}"
cd "$(dirname "$0")/../../.."
mkdir -p "data/runtime/$1"
for f in coverage_log.csv coverage_this.csv coverage_summary.txt decade_log.csv; do
  scp -o BatchMode=yes "$BOX:C:/Games/TheMovies/$f" "data/runtime/$1/" 2>/dev/null || true
done
ls -la "data/runtime/$1"
