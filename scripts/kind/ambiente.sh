#!/usr/bin/env bash
# Ambiente completo da Fase 4 em kind: OS, Billing e Execution com bancos
# próprios, emuladores de Service Bus e Cosmos DB e Mercado Pago (simulado ou
# de teste). Uso: scripts/kind/ambiente.sh subir|jornada|tunel|status|destruir
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKSPACE="${SOAT_WORKSPACE:-$(dirname "$ROOT")}"
BILLING_DIR="${BILLING_DIR:-$WORKSPACE/soat-billing-service}"
EXECUTION_DIR="${EXECUTION_DIR:-$WORKSPACE/soat-execution-service}"
CLUSTER="${KIND_CLUSTER:-soat}"
NAMESPACE=soat-local
NETWORK=kind
STATE="$ROOT/.kind-local"
LOCAL_ENV="${SOAT_ENV_FILE:-$ROOT/.env.kind.local}"
MSSQL_IMAGE="${MSSQL_IMAGE:-mcr.microsoft.com/mssql/server:2022-latest}"
SERVICEBUS_IMAGE="${SERVICEBUS_IMAGE:-mcr.microsoft.com/azure-messaging/servicebus-emulator:latest}"
COSMOS_IMAGE="${COSMOS_IMAGE:-mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-latest}"
# Chave pública e fixa do emulador Cosmos, documentada pela Microsoft.
COSMOS_EMULATOR_KEY='C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=='

log() { printf '\n==> %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "Instale $1 antes de continuar." >&2; exit 1; }; }
k() { kubectl --context "kind-$CLUSTER" -n "$NAMESPACE" "$@"; }

load_local_env() {
  if [[ -f "$LOCAL_ENV" ]]; then
    set -a; # shellcheck disable=SC1090
    source "$LOCAL_ENV"; set +a
  fi
}

ensure_repos() {
  local branch="${SOAT_SERVICES_BRANCH:-development}"
  for entry in "soat-billing-service:$BILLING_DIR:${BILLING_BRANCH:-$branch}" "soat-execution-service:$EXECUTION_DIR:${EXECUTION_BRANCH:-$branch}"; do
    local name="${entry%%:*}" rest="${entry#*:}"
    local dir="${rest%%:*}" ref="${rest#*:}"
    if [[ ! -d "$dir/.git" ]]; then
      log "Clonando $name ($ref) em $dir"
      git clone --branch "$ref" "https://github.com/JoaoGW/$name.git" "$dir"
    fi
  done
}

build_images() {
  log 'Construindo as imagens dos três serviços'
  docker build -t ghcr.io/joaogw/soat-api:local "$ROOT"
  docker build --target runtime -t ghcr.io/joaogw/soat-billing-service:local "$BILLING_DIR"
  docker build --target migration -t ghcr.io/joaogw/soat-billing-service:local-migration "$BILLING_DIR"
  docker build -t ghcr.io/joaogw/soat-execution-service:local "$EXECUTION_DIR"
}

ensure_cluster() {
  if ! kind get clusters | grep -qx "$CLUSTER"; then
    log "Criando cluster kind $CLUSTER"
    kind create cluster --name "$CLUSTER" --wait 120s
  fi
  # O DNS repassado pelo Docker Desktop perde consultas em algumas redes domésticas;
  # com a chamada ao Mercado Pago sem resposta, a cobrança iria para reconciliação.
  local dns=(kubectl --context "kind-$CLUSTER" -n kube-system)
  if "${dns[@]}" get configmap coredns -o jsonpath='{.data.Corefile}' | grep -q 'forward \. /etc/resolv\.conf'; then
    log "Apontando o CoreDNS para resolvedores públicos"
    "${dns[@]}" get configmap coredns -o yaml | sed 's#forward \. /etc/resolv\.conf#forward . 1.1.1.1 8.8.8.8#' | "${dns[@]}" replace -f - >/dev/null
    "${dns[@]}" rollout restart deployment/coredns >/dev/null
    "${dns[@]}" rollout status deployment/coredns --timeout=120s
  fi
  kind load docker-image --name "$CLUSTER" ghcr.io/joaogw/soat-api:local ghcr.io/joaogw/soat-billing-service:local \
    ghcr.io/joaogw/soat-billing-service:local-migration ghcr.io/joaogw/soat-execution-service:local
}

start_emulators() {
  log 'Subindo emuladores de Service Bus e Cosmos DB na rede do kind'
  local password
  password="$(cat "$STATE/mssql-password")"
  docker rm -f soat-mssql soat-servicebus soat-cosmos >/dev/null 2>&1 || true
  # Imagens publicadas somente para amd64; no Apple Silicon o Docker usa emulação.
  docker run -d --name soat-mssql --network "$NETWORK" --platform linux/amd64 \
    -e ACCEPT_EULA="${SOAT_ACCEPT_EULA:?Leia os termos do SQL Server e do Service Bus Emulator e defina SOAT_ACCEPT_EULA=Y}" \
    -e MSSQL_SA_PASSWORD="$password" "$MSSQL_IMAGE" >/dev/null
  docker run -d --name soat-servicebus --network "$NETWORK" --platform linux/amd64 \
    -e SQL_SERVER=soat-mssql -e MSSQL_SA_PASSWORD="$password" -e ACCEPT_EULA="$SOAT_ACCEPT_EULA" \
    -v "$ROOT/deploy/kind-completo/servicebus-config.json:/ServiceBus_Emulator/ConfigFiles/Config.json:ro" \
    "$SERVICEBUS_IMAGE" >/dev/null
  docker run -d --name soat-cosmos --network "$NETWORK" "$COSMOS_IMAGE" --enable-explorer false >/dev/null
  local attempt=0
  until docker logs soat-servicebus 2>&1 | grep -q 'Emulator Service is Successfully Up'; do
    attempt=$((attempt + 1)); (( attempt < 120 )) || { docker logs soat-servicebus | tail -40; echo 'Service Bus Emulator não ficou pronto' >&2; exit 1; }
    sleep 3
  done
}

endpoint_slice() {
  local service="$1" container="$2" port="$3" ip
  ip="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$NETWORK\").IPAddress}}" "$container")"
  k apply -f - <<EOF
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: $service-externo
  labels:
    kubernetes.io/service-name: $service
addressType: IPv4
ports:
  - name: $( [[ "$service" == servicebus ]] && echo amqp || echo gateway )
    port: $port
endpoints:
  - addresses: ["$ip"]
EOF
}

generate_secrets() {
  log 'Gerando segredos efêmeros do ambiente'
  mkdir -p "$STATE"; chmod 700 "$STATE"
  [[ -f "$STATE/mssql-password" ]] || printf 'Soat-%s!' "$(openssl rand -hex 12)" > "$STATE/mssql-password"
  for service in os billing execution; do
    [[ -f "$STATE/$service.key" ]] || openssl genpkey -algorithm ed25519 -out "$STATE/$service.key" 2>/dev/null
    openssl pkey -in "$STATE/$service.key" -pubout -out "$STATE/$service.pub" 2>/dev/null
  done
  for name in jwt-secret jwt-client-secret webhook-secret internal-token os-db billing-db; do
    [[ -f "$STATE/$name" ]] || openssl rand -hex 32 > "$STATE/$name"
  done
  [[ -f "$STATE/admin-password" ]] || openssl rand -hex 12 > "$STATE/admin-password"
  [[ -f "$STATE/mp-webhook-secret" ]] || openssl rand -hex 32 > "$STATE/mp-webhook-secret"
  chmod 600 "$STATE"/*
}

apply_secrets() {
  local admin_hash mp_token mp_secret mp_base pos observability
  admin_hash="$(docker run --rm --entrypoint node ghcr.io/joaogw/soat-api:local -e 'process.stdout.write(require("bcrypt").hashSync(process.argv[1], 10))' "$(cat "$STATE/admin-password")")"
  if [[ -n "${MERCADO_PAGO_ACCESS_TOKEN:-}" ]]; then
    mp_token="$MERCADO_PAGO_ACCESS_TOKEN"; mp_secret="${MERCADO_PAGO_WEBHOOK_SECRET:?Defina MERCADO_PAGO_WEBHOOK_SECRET}"
    pos="${MERCADO_PAGO_EXTERNAL_POS_ID:?Defina MERCADO_PAGO_EXTERNAL_POS_ID}"; mp_base=''
  else
    mp_token='TEST-simulado'; mp_secret="$(cat "$STATE/mp-webhook-secret")"; pos='CAIXA_KIND'; mp_base='http://mercado-pago-simulado:8080'
  fi
  observability=false
  [[ -n "${NEW_RELIC_LICENSE_KEY:-}" ]] && observability=true
  k create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl --context "kind-$CLUSTER" apply -f - >/dev/null
  local sb='Endpoint=sb://servicebus;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;'
  local otel=(--from-literal=OBSERVABILITY_ENABLED="$observability" --from-literal=OTEL_SERVICE_VERSION="$(git -C "$ROOT" rev-parse --short HEAD)")
  [[ "$observability" == true ]] && otel+=(--from-literal=NEW_RELIC_LICENSE_KEY="$NEW_RELIC_LICENSE_KEY" --from-literal=OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-https://otlp.nr-data.net:4318}")
  secret() { k create secret generic "$1" "${@:2}" --dry-run=client -o yaml | k apply -f - >/dev/null; }
  secret os-postgres --from-literal=POSTGRES_USER=os --from-literal=POSTGRES_PASSWORD="$(cat "$STATE/os-db")" --from-literal=POSTGRES_DB=oficina
  secret billing-postgres --from-literal=POSTGRES_USER=billing --from-literal=POSTGRES_PASSWORD="$(cat "$STATE/billing-db")" --from-literal=POSTGRES_DB=billing
  secret mercado-pago-simulado --from-literal=MERCADO_PAGO_WEBHOOK_SECRET="$mp_secret"
  secret soat-os-runtime \
    --from-literal=DATABASE_URL="postgresql://os:$(cat "$STATE/os-db")@os-postgres:5432/oficina" \
    --from-literal=SAGA_DATABASE_URL="postgresql://os:$(cat "$STATE/os-db")@os-postgres:5432/os_saga" \
    --from-literal=SERVICE_BUS_CONNECTION_STRING="$sb" \
    --from-literal=OS_MESSAGE_PRIVATE_KEY="$(cat "$STATE/os.key")" \
    --from-literal=BILLING_MESSAGE_PUBLIC_KEY="$(cat "$STATE/billing.pub")" \
    --from-literal=EXECUTION_MESSAGE_PUBLIC_KEY="$(cat "$STATE/execution.pub")" \
    --from-literal=MERCADO_PAGO_EXTERNAL_POS_ID="$pos" \
    --from-literal=JWT_SECRET="$(cat "$STATE/jwt-secret")" \
    --from-literal=JWT_CLIENT_SECRET="$(cat "$STATE/jwt-client-secret")" \
    --from-literal=INTERNAL_CLIENT_LOOKUP_TOKEN="$(cat "$STATE/internal-token")" \
    --from-literal=ADMIN_USERNAME=admin --from-literal=ADMIN_PASSWORD_HASH="$admin_hash" \
    --from-literal=WEBHOOK_SECRET="$(cat "$STATE/webhook-secret")" \
    --from-literal=MAIL_HOST=smtp.local.invalid --from-literal=MAIL_PORT=587 --from-literal=MAIL_USER=local \
    --from-literal=MAIL_PASS=local --from-literal=MAIL_FROM=oficina@local.invalid \
    --from-literal=APP_URL=http://soat-api.soat-local.svc.cluster.local "${otel[@]}"
  local billing_extra=()
  [[ -n "$mp_base" ]] && billing_extra+=(--from-literal=MERCADO_PAGO_API_BASE_URL="$mp_base")
  secret soat-billing-runtime \
    --from-literal=DATABASE_URL="postgresql://billing:$(cat "$STATE/billing-db")@billing-postgres:5432/billing" \
    --from-literal=SERVICE_BUS_CONNECTION_STRING="$sb" \
    --from-literal=BILLING_MESSAGE_PRIVATE_KEY="$(cat "$STATE/billing.key")" \
    --from-literal=OS_MESSAGE_PUBLIC_KEY="$(cat "$STATE/os.pub")" \
    --from-literal=EXECUTION_MESSAGE_PUBLIC_KEY="$(cat "$STATE/execution.pub")" \
    --from-literal=JWT_CLIENT_SECRET="$(cat "$STATE/jwt-client-secret")" \
    --from-literal=MERCADO_PAGO_ACCESS_TOKEN="$mp_token" --from-literal=MERCADO_PAGO_WEBHOOK_SECRET="$mp_secret" \
    ${billing_extra[@]+"${billing_extra[@]}"} "${otel[@]}"
  secret soat-execution-runtime \
    --from-literal=COSMOS_ENDPOINT=http://cosmos:8081 --from-literal=COSMOS_KEY="$COSMOS_EMULATOR_KEY" \
    --from-literal=COSMOS_DATABASE=execution --from-literal=COSMOS_CONTAINER=operations \
    --from-literal=SERVICE_BUS_CONNECTION_STRING="$sb" \
    --from-literal=OS_MESSAGE_PUBLIC_KEY="$(cat "$STATE/os.pub")" \
    --from-literal=EXECUTION_MESSAGE_PRIVATE_KEY="$(cat "$STATE/execution.key")" \
    --from-literal=JWT_SECRET="$(cat "$STATE/jwt-secret")" "${otel[@]}"
}

wait_job() {
  for _ in $(seq 1 150); do
    [[ "$(k get job "$1" -o jsonpath='{.status.succeeded}')" == '1' ]] && return 0
    [[ "$(k get job "$1" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}')" == 'True' ]] && { k logs "job/$1" --tail=50 || true; return 1; }
    sleep 2
  done
  echo "Job $1 não concluiu" >&2; return 1
}

deploy() {
  log 'Aplicando bancos, migrations e serviços'
  local rendered="$STATE/rendered.yaml"
  kubectl kustomize "$ROOT/deploy/kind-completo" > "$rendered"
  k apply -f "$rendered" -l 'app.kubernetes.io/component in (database,emulator)'
  endpoint_slice servicebus soat-servicebus 5672
  endpoint_slice cosmos soat-cosmos 8081
  k rollout status deployment/os-postgres deployment/billing-postgres --timeout=180s
  k delete job -l app.kubernetes.io/component=migration --ignore-not-found >/dev/null
  k apply -f "$rendered" -l app.kubernetes.io/component=migration
  for job in os-migrate-legacy os-migrate-saga billing-migrate execution-cosmos-init; do wait_job "$job"; done
  k apply -f "$rendered" -l '!app.kubernetes.io/component'
  k rollout restart deployment/soat-api deployment/soat-billing-service deployment/soat-execution-service >/dev/null
  k rollout status deployment/mercado-pago-simulado deployment/soat-api deployment/soat-billing-service deployment/soat-execution-service --timeout=300s
  k get deployments,pods,jobs,services -o wide
}

forward() {
  pkill -f "port-forward.*$NAMESPACE" 2>/dev/null || true
  k port-forward service/soat-api 3001:80 >/dev/null 2>&1 &
  k port-forward service/soat-billing-service 3002:80 >/dev/null 2>&1 &
  k port-forward service/soat-execution-service 3003:80 >/dev/null 2>&1 &
  k port-forward service/mercado-pago-simulado 3004:8080 >/dev/null 2>&1 &
  sleep 3
}

case "${1:-}" in
  subir)
    for tool in docker kind kubectl openssl git; do need "$tool"; done
    load_local_env; ensure_repos; generate_secrets; build_images; ensure_cluster; start_emulators; apply_secrets; deploy
    cat <<EOF

Ambiente pronto. Próximos passos:
  scripts/kind/ambiente.sh jornada              # fluxo completo (OS, Billing, Execution e Saga)
  CENARIO=compensacao scripts/kind/ambiente.sh jornada   # falha após pagamento e compensação
  scripts/kind/ambiente.sh tunel                # URL HTTPS pública do webhook (Mercado Pago de teste)
Swagger do OS após 'jornada' ou 'portas': http://localhost:3001/docs
EOF
    ;;
  portas) forward; echo 'OS :3001 | Billing :3002 | Execution :3003 | Mercado Pago simulado :3004' ;;
  jornada)
    need node; load_local_env; forward
    OS_URL=http://localhost:3001 BILLING_URL=http://localhost:3002 EXECUTION_URL=http://localhost:3003 \
      MP_SIMULADO_URL="$( [[ -n "${MERCADO_PAGO_ACCESS_TOKEN:-}" ]] || echo http://localhost:3004 )" \
      ADMIN_USERNAME=admin ADMIN_PASSWORD="$(cat "$STATE/admin-password")" JWT_CLIENT_SECRET="$(cat "$STATE/jwt-client-secret")" \
      node "$ROOT/scripts/kind/jornada.cjs"
    ;;
  tunel)
    need cloudflared; forward
    echo 'Cadastre no Mercado Pago (Webhooks, evento "Order") a URL exibida abaixo seguida de /webhooks/mercado-pago'
    cloudflared tunnel --url http://localhost:3002
    ;;
  status) k get deployments,pods,jobs,services -o wide ;;
  destruir)
    pkill -f "port-forward.*$NAMESPACE" 2>/dev/null || true
    docker rm -f soat-mssql soat-servicebus soat-cosmos >/dev/null 2>&1 || true
    kind delete cluster --name "$CLUSTER"
    ;;
  *) echo 'Uso: scripts/kind/ambiente.sh subir|portas|jornada|tunel|status|destruir' >&2; exit 2 ;;
esac
