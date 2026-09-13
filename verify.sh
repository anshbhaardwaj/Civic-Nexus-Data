#!/usr/bin/env bash
# CivicData Nexus backend verification: exercises every route in docs/API.md
# against a running server (default http://localhost:5000).
set -uo pipefail
BASE="${BASE:-http://localhost:5000}"
PASS=0; FAIL=0; OUT_DIR="${OUT_DIR:-/tmp/cdn-verify}"
mkdir -p "$OUT_DIR"

login() { # email -> token
  curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"${2:-Demo@1234}\"}" | node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).token||"")}catch{process.stdout.write("")}})'
}

check() { # name expected_status method path token [body]
  local name="$1" want="$2" method="$3" path="$4" token="${5:-}" body="${6:-}"
  local file="$OUT_DIR/$(echo "$name" | tr -c 'a-zA-Z0-9' '_').out"
  local args=(-s -o "$file" -w '%{http_code}' -X "$method" "$BASE$path")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' -d "$body"); fi
  local code
  code=$(curl "${args[@]}")
  if [ "$code" = "$want" ]; then
    PASS=$((PASS+1)); printf 'PASS %-3s %-6s %-52s %s\n' "$code" "$method" "$path" "$name"
  else
    FAIL=$((FAIL+1)); printf 'FAIL want=%s got=%s %-6s %-52s %s\n  -> %s\n' "$want" "$code" "$method" "$path" "$name" "$(head -c 300 "$file")"
  fi
}

assert() { # name condition_result
  if [ "$2" = "1" ]; then PASS=$((PASS+1)); echo "PASS assert  $1"; else FAIL=$((FAIL+1)); echo "FAIL assert  $1"; fi
}

echo "== logins =="
MIN=$(login minister@gov.in); ANA=$(login analyst@gov.in); DIR=$(login director@gov.in); AUD=$(login auditor@gov.in)
for pair in "minister:$MIN" "analyst:$ANA" "director:$DIR" "auditor:$AUD"; do
  n="${pair%%:*}"; t="${pair#*:}"
  assert "login $n returns a JWT" "$([ ${#t} -gt 40 ] && echo 1 || echo 0)"
done
check "bad password rejected" 401 POST /api/auth/login "" '{"email":"minister@gov.in","password":"wrong-password"}'
check "unknown user rejected" 401 POST /api/auth/login "" '{"email":"nobody@gov.in","password":"Demo@1234"}'
check "missing token rejected" 401 GET /api/dashboard
check "malformed login validated" 422 POST /api/auth/login "" '{"email":"x"}'
check "auditor forbidden from ai.run" 403 GET "/api/ai/forecast?dataset=ambulance_response" "$AUD"
check "minister forbidden from audit log" 403 GET /api/audit "$MIN"
check "analyst forbidden from user admin" 403 GET /api/users "$ANA"

echo "== auth =="
check "health" 200 GET /api/health
check "logout" 200 POST /api/auth/logout "$DIR"
check "me" 200 GET /api/auth/me "$ANA"
check "demo users" 200 GET /api/auth/demo-users
check "permission catalogue" 200 GET /api/auth/permissions

echo "== datasets =="
check "dataset list" 200 GET /api/datasets "$ANA"
check "dataset detail" 200 GET /api/datasets/ambulance_response "$ANA"
check "dataset columns" 200 GET /api/datasets/citizen_grievances/columns "$ANA"
check "dataset rows" 200 GET "/api/datasets/hospital_capacity/rows?limit=5" "$ANA"
check "dataset rejects" 200 GET /api/datasets/water_supply/rejects "$ANA"
check "unknown dataset 404" 404 GET /api/datasets/not_a_dataset "$ANA"
check "bad order column 422" 422 GET "/api/datasets/water_supply/rows?orderBy=nope" "$ANA"
printf 'district,month,cases\nAlpha,2025-01,10\nAlpha,2025-02,12\n' > "$OUT_DIR/upload.csv"
BODY=$(node -e 'const fs=require("fs");console.log(JSON.stringify({slug:"verify_upload",name:"Verify Upload",domain:"Test",content:fs.readFileSync(process.argv[1],"utf8")}))' "$OUT_DIR/upload.csv")
check "ingest upload" 201 POST /api/datasets/ingest "$ANA" "$BODY"
check "delete uploaded dataset" 200 DELETE /api/datasets/verify_upload "$ANA"
check "director cannot delete datasets" 403 DELETE /api/datasets/air_quality "$DIR"
check "lineage index" 200 GET /api/lineage "$ANA"
check "lineage detail" 200 GET /api/lineage/scheme_expenditure "$ANA"

echo "== masked export =="
curl -s -H "Authorization: Bearer $ANA" "$BASE/api/datasets/citizen_grievances/export-masked" -o "$OUT_DIR/masked.csv"
TWELVE=$(grep -oE '[0-9]{12}' "$OUT_DIR/masked.csv" | wc -l | tr -d ' ')
EMAILS=$(grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$OUT_DIR/masked.csv" | wc -l | tr -d ' ')
PHONES=$(grep -oE '(^|,)(\+91)?[6-9][0-9]{9}(,|$)' "$OUT_DIR/masked.csv" | wc -l | tr -d ' ')
echo "masked export: $(wc -l < "$OUT_DIR/masked.csv") lines, 12-digit runs=$TWELVE, emails=$EMAILS, phone-shaped=$PHONES"
assert "masked export has 0 twelve-digit runs" "$([ "$TWELVE" = "0" ] && echo 1 || echo 0)"
assert "masked export has 0 email-shaped values" "$([ "$EMAILS" = "0" ] && echo 1 || echo 0)"
assert "masked export has 0 phone-shaped values" "$([ "$PHONES" = "0" ] && echo 1 || echo 0)"

echo "== anomalies =="
check "anomaly list" 200 GET "/api/anomalies?limit=5" "$ANA"
check "anomaly summary" 200 GET /api/anomalies/summary "$ANA"
check "anomaly detail" 200 GET /api/anomalies/1 "$ANA"
check "anomaly 404" 404 GET /api/anomalies/999999 "$ANA"
check "anomaly ack" 200 POST /api/anomalies/1/ack "$ANA" '{}'
check "anomaly dismiss" 200 POST /api/anomalies/2/dismiss "$ANA" '{}'

echo "== AI engines =="
check "engine registry" 200 GET /api/ai/engines "$ANA"
check "AI-1 anomalies" 200 GET "/api/ai/anomalies?dataset=hospital_capacity&limit=10" "$ANA"
check "AI-1 rescan" 200 POST /api/ai/anomalies/scan "$ANA" '{"dataset":"air_quality"}'
check "AI-2 isolation forest" 200 GET "/api/ai/isolation-forest?dataset=bridge_health&topN=10" "$ANA"
check "AI-3 forecast" 200 GET "/api/ai/forecast?dataset=ambulance_response&metric=avg_response_min&aggregation=avg" "$ANA"
check "AI-3 not applicable on cross-section" 422 GET "/api/ai/forecast?dataset=bridge_health" "$ANA"
check "AI-4 clusters" 200 GET "/api/ai/clusters?dataset=water_supply" "$ANA"
check "AI-5 correlation" 200 GET "/api/ai/correlation?dataset=air_quality" "$ANA"
check "AI-6 policy cards" 200 GET /api/ai/policy-cards "$MIN"
check "AI-6 refresh" 200 POST /api/ai/policy-cards/refresh "$ANA" '{}'
check "AI-7 optimise (derived budget)" 200 GET /api/ai/optimise "$DIR"
check "AI-7 optimise (explicit budget)" 200 GET "/api/ai/optimise?budgetCr=500" "$DIR"
check "AI-8 ask" 200 POST /api/ai/ask "$ANA" '{"question":"Which district has the worst ambulance response time?"}'
check "AI-8 ask examples" 200 GET "/api/ai/ask/examples?run=true" "$ANA"

echo "== simulator / live / brief =="
check "simulate defaults" 200 POST /api/simulate "$MIN" '{}'
check "simulate levers" 200 POST /api/simulate "$MIN" '{"budgetReallocationPct":25,"hospitalBedsAdded":4000,"ambulancesAdded":600,"staffHired":9000,"waterCapexPct":30,"roadRepairCapexCr":1200,"enforcementIntensity":60}'
check "simulate rejects out-of-range" 422 POST /api/simulate "$MIN" '{"budgetReallocationPct":900}'
check "simulate assumptions" 200 GET /api/simulate/assumptions "$MIN"
check "live tick" 200 POST /api/live/tick "$ANA" '{"dataset":"ambulance_response"}'
check "brief preview" 200 GET /api/brief/preview "$MIN"
curl -s -H "Authorization: Bearer $MIN" "$BASE/api/brief/pdf" -o "$OUT_DIR/brief.pdf"
HEAD4=$(head -c 4 "$OUT_DIR/brief.pdf")
assert "brief pdf starts with %PDF" "$([ "$HEAD4" = "%PDF" ] && echo 1 || echo 0)"
PDFSZ=$(wc -c < "$OUT_DIR/brief.pdf" | tr -d ' ')
assert "brief pdf larger than 20 kB (got ${PDFSZ}B)" "$([ "$PDFSZ" -gt 20000 ] && echo 1 || echo 0)"
RUPEE=$(pdftotext "$OUT_DIR/brief.pdf" - 2>/dev/null | grep -c '₹' || echo 0)
echo "pdf extracted-text ₹ occurrences: $RUPEE"
assert "brief pdf renders the ₹ glyph (U+20B9)" "$([ "${RUPEE:-0}" -gt 0 ] && echo 1 || echo 0)"
PAGES=$(python3 -c "import pypdf,sys;print(len(pypdf.PdfReader(sys.argv[1]).pages))" "$OUT_DIR/brief.pdf" 2>/dev/null || echo 0)
assert "brief pdf is multi-page (got ${PAGES})" "$([ "${PAGES:-0}" -ge 3 ] && echo 1 || echo 0)"

echo "== audit =="
check "audit list" 200 GET "/api/audit?limit=5" "$AUD"
check "audit verify" 200 GET /api/audit/verify "$AUD"
VALID=$(curl -s -H "Authorization: Bearer $AUD" "$BASE/api/audit/verify" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).valid)))')
assert "audit chain valid:true" "$([ "$VALID" = "true" ] && echo 1 || echo 0)"
check "audit export" 200 GET /api/audit/export "$AUD"

echo "== users / dashboard =="
check "user list" 200 GET /api/users "$DIR"
VEMAIL="verify.$(date +%s%N | tail -c 7)@gov.in"
check "user create" 201 POST /api/users "$DIR" "{\"email\":\"$VEMAIL\",\"name\":\"Verify User\",\"role\":\"analyst\",\"password\":\"Verify@12345\"}"
check "duplicate user rejected" 422 POST /api/users "$DIR" "{\"email\":\"$VEMAIL\",\"name\":\"Verify User\",\"role\":\"analyst\",\"password\":\"Verify@12345\"}"
NEWUID=$(VE="$VEMAIL" curl -s -H "Authorization: Bearer $DIR" "$BASE/api/users" | VE="$VEMAIL" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const u=JSON.parse(s).users.find(u=>u.email===process.env.VE);process.stdout.write(String(u?u.id:0))})')
check "user patch" 200 PATCH "/api/users/$NEWUID" "$DIR" '{"name":"Verify User 2","active":true}'
check "user deactivate" 200 DELETE "/api/users/$NEWUID" "$DIR"
check "user 404" 404 PATCH /api/users/999999 "$DIR" '{"name":"Nope"}'
check "dashboard" 200 GET /api/dashboard "$MIN"
check "unknown route 404" 404 GET /api/does-not-exist "$MIN"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
