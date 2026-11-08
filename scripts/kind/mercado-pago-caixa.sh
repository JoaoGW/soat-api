#!/usr/bin/env bash
# Cria a loja e o caixa (POS) do vendedor de teste do Mercado Pago, usados nas
# orders QR do ambiente kind. Lê o token de .env.kind.local e não o exibe.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${SOAT_ENV_FILE:-$ROOT/.env.kind.local}"
[[ -f "$ENV_FILE" ]] || { echo "Crie $ENV_FILE com MERCADO_PAGO_ACCESS_TOKEN" >&2; exit 1; }
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a
: "${MERCADO_PAGO_ACCESS_TOKEN:?Defina MERCADO_PAGO_ACCESS_TOKEN em .env.kind.local}"

# Mostra o corpo das respostas de erro da API (nunca o token) e falha a chamada.
api() {
  local body status
  body="$(curl -sS -X "$1" "https://api.mercadopago.com$2" -w '\n%{http_code}' \
    -H "Authorization: Bearer $MERCADO_PAGO_ACCESS_TOKEN" -H 'Content-Type: application/json' ${3:+-d "$3"})"
  status="${body##*$'\n'}"; body="${body%$'\n'*}"
  if [[ "$status" != 2* ]]; then echo "$1 $2 -> HTTP $status: $body" >&2; return 1; fi
  printf '%s' "$body"
}

STORE_ID="${MERCADO_PAGO_STORE_ID:-SOATOFICINA}"
POS_ID="${MERCADO_PAGO_EXTERNAL_POS_ID:-SOATCAIXA01}"
json() { python3 -c "import json,sys; print(eval('json.load(sys.stdin)' + sys.argv[1]))" "$1"; }
# O access token termina no ID do usuário dono das credenciais.
user_id="${MERCADO_PAGO_ACCESS_TOKEN##*-}"
[[ "$user_id" =~ ^[0-9]+$ ]] || user_id="$(api GET /users/me | json "['id']")"

store="$(api POST "/users/$user_id/stores" "$(cat <<EOF
{"name":"Oficina SOAT","external_id":"$STORE_ID","location":{"street_number":"3003","street_name":"Avenida das Nações Unidas","city_name":"Osasco","state_name":"São Paulo","latitude":-23.5329,"longitude":-46.7919,"reference":"Ambiente de teste da Fase 4"}}
EOF
)" 2>&1)" || echo "Loja não criada (pode já existir): $store"
store_id="$(api GET "/users/$user_id/stores/search?external_id=$STORE_ID" | json "['results'][0]['id']")"

# A categoria (MCC) é opcional e o código aceito varia por país; o caixa é criado sem ela.
pos="$(api POST /pos "{\"name\":\"Caixa oficina\",\"fixed_amount\":false,\"store_id\":$store_id,\"external_store_id\":\"$STORE_ID\",\"external_id\":\"$POS_ID\"}" 2>&1)" || echo "Caixa não criado (pode já existir): $pos"
found="$(api GET "/pos?external_id=$POS_ID" | json "['paging']['total']")"
[[ "$found" -ge 1 ]] || { echo "Caixa $POS_ID não encontrado no Mercado Pago" >&2; exit 1; }

if ! grep -q '^MERCADO_PAGO_EXTERNAL_POS_ID=' "$ENV_FILE"; then
  printf 'MERCADO_PAGO_EXTERNAL_POS_ID=%s\n' "$POS_ID" >> "$ENV_FILE"
fi
echo "Loja $STORE_ID (id $store_id) e caixa $POS_ID prontos; external_pos_id gravado em .env.kind.local."
