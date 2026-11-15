#!/bin/sh
# Verifica que los cálculos (cierres de mes, saldos, totales, saldo diario, préstamos)
# den exactamente lo mismo que la referencia guardada en tests/golden.json.
# Uso: sh tests/run.sh
set -e
cd "$(dirname "$0")/.."
PRELOAD=ui.js node tests/calc-snapshot.js app.js tests/fixture-state.json > /tmp/mi-dinero-calc.json
node tests/compare.js tests/golden.json /tmp/mi-dinero-calc.json
PRELOAD=ui.js node tests/calc-snapshot.js app.js tests/fixture-state.json --migrate > /tmp/mi-dinero-calc-m.json
node tests/compare.js tests/golden.json /tmp/mi-dinero-calc-m.json
