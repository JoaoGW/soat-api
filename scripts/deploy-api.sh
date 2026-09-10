#!/usr/bin/env bash
set -euo pipefail

mode="${1:?Informe o modo migration ou application}"
environment="${2:?Informe o ambiente hml ou prod}"
image="${3:?Informe a imagem imutável por SHA}"

case "$mode" in
  migration) overlay="deploy/kustomize/migration/overlays/$environment" ;;
  application) overlay="deploy/kustomize/overlays/$environment" ;;
  *) echo "Modo inválido: $mode" >&2; exit 1 ;;
esac

case "$environment" in
  hml|prod) ;;
  *) echo "Ambiente inválido: $environment" >&2; exit 1 ;;
esac

: "${KEY_VAULT_NAME:?KEY_VAULT_NAME é obrigatório}"
: "${AZURE_TENANT_ID:?AZURE_TENANT_ID é obrigatório}"
: "${API_WORKLOAD_CLIENT_ID:?API_WORKLOAD_CLIENT_ID é obrigatório}"

if [[ "$image" == *":latest" || "$image" != *":${GITHUB_SHA:-}" ]]; then
  echo "A imagem precisa usar exatamente o SHA do commit atual." >&2
  exit 1
fi

workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT
cp -R deploy "$workspace/deploy"

find "$workspace/deploy" -type f -name '*.yaml' -print0 | xargs -0 \
  sed -i \
  -e "s|__ENVIRONMENT__|$environment|g" \
  -e "s|__KEY_VAULT_NAME__|$KEY_VAULT_NAME|g" \
  -e "s|__AZURE_TENANT_ID__|$AZURE_TENANT_ID|g" \
  -e "s|__API_WORKLOAD_CLIENT_ID__|$API_WORKLOAD_CLIENT_ID|g"

cd "$workspace/$overlay"
kustomize edit set image "ghcr.io/joaogw/soat-api=$image"

if [[ "$mode" == "migration" ]]; then
  kubectl -n "$environment" apply \
    -f "$workspace/deploy/kustomize/base/serviceaccount.yaml" \
    -f "$workspace/deploy/kustomize/base/secret-provider-class.yaml"
  kubectl -n "$environment" delete job soat-api-migrate --ignore-not-found=true
  kubectl apply -k .
  kubectl -n "$environment" wait --for=condition=complete job/soat-api-migrate --timeout=10m
else
  kubectl apply -k .
  kubectl -n "$environment" rollout status deployment/soat-api --timeout=10m
fi
