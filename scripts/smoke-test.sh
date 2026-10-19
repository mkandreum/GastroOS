#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$(mktemp -d /tmp/gastro-smoke-XXXXXX)"
PORT="${SMOKE_PORT:-3199}"
BASE="http://127.0.0.1:${PORT}"
JWT="smoke-secret-0123456789012345678901234567890123456789"
TABLE_SECRET="smoke-table-secret-012345678901234567890123456789"
ADMIN_PASS="SmokeAdmin123!"

cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$RUN"
}
trap cleanup EXIT

mkdir -p "$RUN/data"
cp -r "$ROOT/dist" "$RUN/dist"
ln -sfn "$ROOT/node_modules" "$RUN/node_modules"

cd "$RUN"
NODE_ENV=production PORT="$PORT" APP_TYPE=both APP_URL="$BASE" \
JWT_SECRET="$JWT" TABLE_TOKEN_SECRET="$TABLE_SECRET" \
ADMIN_PASSWORD="$ADMIN_PASS" SEED_DEMO=true \
node dist/server.cjs >server.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  curl -fsS "$BASE/health" >/dev/null 2>&1 && break
  sleep 0.25
done

json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s); console.log(eval(process.argv[1]))})" "$1"; }

TEST() { printf '%-38s' "$1"; }
PASS() { echo "OK"; }
FAIL() { echo "FAIL"; exit 1; }

TEST "health"; [ "$(curl -fsS "$BASE/health" | json "v.status")" = "ok" ] && PASS || FAIL

ADMIN_TOKEN=$(curl -fsS -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}" | json "v.token")
WAITER_TOKEN=$(curl -fsS -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"camarero1","password":"camarero123"}' | json "v.token")

TEST "tables require auth"; [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/tables")" = "401" ] && PASS || FAIL

TABLES=$(curl -fsS "$BASE/api/tables" -H "Authorization: Bearer $ADMIN_TOKEN")
TTOKEN=$(echo "$TABLES" | json "v.find(t=>t.number===1).qrToken")
PRODUCTS=$(curl -fsS "$BASE/api/products")
FOOD=$(echo "$PRODUCTS" | json "v.find(p=>p.name.includes('Tosta')).id")
DRINK=$(echo "$PRODUCTS" | json "v.find(p=>p.name.includes('Albariño')).id")

TEST "bad table QR rejected"; [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/tables/table-1" -H 'X-Table-Token: nope')" = "403" ] && PASS || FAIL

ORDER=$(curl -fsS -X POST "$BASE/api/orders" -H 'Content-Type: application/json' -H "X-Table-Token: $TTOKEN" -d "{\"tableId\":\"table-1\",\"items\":[{\"productId\":\"$FOOD\",\"quantity\":1},{\"productId\":\"$DRINK\",\"quantity\":2}]}")
ORDER_ID=$(echo "$ORDER" | json "v.id")
DESTINATIONS=$(echo "$ORDER" | json "v.items.map(i=>i.destination).sort().join(',')")
TEST "food to kitchen and drink to bar"; [ "$DESTINATIONS" = "bar,cocina" ] && PASS || FAIL

TEST "order total"; [ "$(echo "$ORDER" | json "v.totalAmount")" = "14.5" ] && PASS || FAIL

TEST "bad table cannot order"; [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/orders" -H 'Content-Type: application/json' -H 'X-Table-Token: nope' -d "{\"tableId\":\"table-1\",\"items\":[{\"productId\":\"$FOOD\",\"quantity\":1}]}")" = "403" ] && PASS || FAIL

TEST "kitchen station update"; [ "$(curl -fsS -X PUT "$BASE/api/orders/$ORDER_ID/status" -H 'Content-Type: application/json' -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"status":"listo","station":"cocina"}' | json "v.items.find(i=>i.destination==='cocina').stationStatus")" = "listo" ] && PASS || FAIL

BILL=$(curl -fsS "$BASE/api/tables/table-1/bill" -H "X-Table-Token: $TTOKEN")
TEST "bill tax included"; [ "$(echo "$BILL" | json "v.taxAmount")" = "1.89" ] && PASS || FAIL

TEST "line note"; [ "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/tables/table-1/bill/items/note" -H 'Content-Type: application/json' -H "Authorization: Bearer $WAITER_TOKEN" -d "{\"productId\":\"$FOOD\",\"oldNotes\":\"\",\"selectedExtras\":[],\"newNotes\":\"sin sal\"}")" = "200" ] && PASS || FAIL

TEST "line served"; [ "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/tables/table-1/bill/items/serve" -H 'Content-Type: application/json' -H "Authorization: Bearer $WAITER_TOKEN" -d "{\"productId\":\"$FOOD\",\"notes\":\"sin sal\",\"selectedExtras\":[]}")" = "200" ] && PASS || FAIL

TEST "partial payment"; [ "$(curl -fsS -X POST "$BASE/api/tables/table-1/close" -H 'Content-Type: application/json' -H "Authorization: Bearer $WAITER_TOKEN" -d "{\"splitMethod\":\"por_lineas\",\"paymentMethod\":\"tarjeta\",\"customItems\":[{\"productId\":\"$DRINK\",\"name\":\"Vino\",\"quantity\":2,\"priceUnit\":3.5,\"priceTotal\":7}]}" | json "v.receipt.invoiceNumber")" = "1" ] && PASS || FAIL

TEST "table pending payment"; [ "$(curl -fsS "$BASE/api/tables/table-1" -H "Authorization: Bearer $ADMIN_TOKEN" | json "v.status")" = "pendiente_pago" ] && PASS || FAIL

TEST "close remaining"; [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/tables/table-1/close" -H 'Content-Type: application/json' -H "Authorization: Bearer $WAITER_TOKEN" -d '{"splitMethod":"completa","paymentMethod":"efectivo"}')" = "200" ] && PASS || FAIL

TEST "sql injection blocked"; curl -fsS -o /dev/null -X PUT "$BASE/api/products/$FOOD" -H 'Content-Type: application/json' -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"name = (SELECT username FROM users LIMIT 1), description":"x"}'; [ "$(curl -fsS "$BASE/api/products" | json "v.find(p=>p.id==='$FOOD').name")" = "Tosta de Sardina Ahumada" ] && PASS || FAIL

FORGED=$(node -e "const c=require('crypto');const s=c.createHash('sha256').update('gastro-os-fallback-dev-key').digest('hex');const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const p=Buffer.from(JSON.stringify({sub:'attacker',role:'admin',iat:Date.now(),exp:Date.now()+86400000})).toString('base64url');const sig=c.createHmac('sha256',s).update(h+'.'+p).digest('base64url');console.log(h+'.'+p+'.'+sig)")
TEST "old forged JWT rejected"; [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/users" -H "Authorization: Bearer $FORGED")" = "401" ] && PASS || FAIL

TEST "waiter cannot read stats"; [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/stats" -H "Authorization: Bearer $WAITER_TOKEN")" = "403" ] && PASS || FAIL

TEST "SSE requires auth"; [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/api/events")" = "401" ] && PASS || FAIL

echo "Smoke test completado."
