# Deploy imutável da API

## Escopo

O workflow `Deploy imutável da API` publica a imagem exclusivamente como
`ghcr.io/joaogw/soat-api:<SHA_DO_COMMIT>`. Não há tag `latest`, tag de branch
nem credencial persistente de Azure ou Kubernetes.

Em cada ambiente, o pipeline usa OIDC do GitHub Actions, aplica primeiro um
Job `prisma migrate deploy` e só então atualiza o Deployment. A referência da
imagem é substituída por seu SHA no diretório temporário do runner, antes da
renderização do Kustomize. Nenhum manifesto versiona valor de segredo.

## Pré-requisitos de infraestrutura

Antes de habilitar o deploy, a foundation do repositório `soat-aks-infra` deve
ter sido aplicada após a conferência de custo. Ela cria o AKS com OIDC,
Workload Identity e o add-on Secrets Store CSI, além das identities:

- `api_hml` e `api_prod`: OIDC do GitHub, com Azure Kubernetes Service RBAC
  Cluster Admin apenas no cluster e escrita somente no state;
- `api_workload[hml|prod]`: identity do ServiceAccount `soat-api`, com papel
  `Key Vault Secrets User` apenas no Key Vault.

Configure os ambientes GitHub `hml` e `prod` com variáveis não sigilosas:

| Variável | Origem |
|---|---|
| `AZURE_CLIENT_ID` | output `github_identity_client_ids.api_hml` ou `.api_prod` |
| `AZURE_TENANT_ID` | tenant da assinatura Azure |
| `AZURE_SUBSCRIPTION_ID` | assinatura Azure |
| `AKS_RESOURCE_GROUP` | `rg-soat-platform` |
| `AKS_NAME` | output `aks_name` da foundation |
| `KEY_VAULT_NAME` | output `key_vault_name` da foundation |
| `API_WORKLOAD_CLIENT_ID` | output `api_workload_client_ids.hml` ou `.prod` |
| `TF_APPLY_ENABLED` | `false` até a aprovação explícita de custo |

As variáveis acima não são segredos. Senhas, tokens e URLs de conexão não vão
para GitHub Actions.

## Segredos do Key Vault

O `SecretProviderClass` cria em tempo de execução o Secret Kubernetes
`soat-api-runtime` por meio do CSI; apenas os nomes são versionados. Para cada
ambiente (`hml` e `prod`), o Key Vault precisa conter os seguintes nomes:

```text
database-url-<ambiente>
jwt-secret-<ambiente>
jwt-client-secret-<ambiente>
admin-username-<ambiente>
admin-password-hash-<ambiente>
mail-host-<ambiente>
mail-port-<ambiente>
mail-user-<ambiente>
mail-pass-<ambiente>
mail-from-<ambiente>
webhook-secret-<ambiente>
app-url-<ambiente>
```

`database-url-<ambiente>` exige TLS (`sslmode=require`). O segredo
`jwt-client-secret-<ambiente>` deve ser exatamente o mesmo usado pela Function
de autenticação do ambiente, para que a API valide os tokens CPF emitidos por
ela. Os valores devem ser cadastrados diretamente no Key Vault por operador
autorizado, sem registrá-los no Git nem nos logs do workflow.

## Roteamento e disponibilidade

- `hml`: uma réplica, Service `ClusterIP` e Ingress Kong com prefixo `/`;
  a rota exata `POST /auth/cpf` criada para a Function continua prioritária.
- `prod`: Service `ClusterIP`, duas réplicas mínimas, HPA de 2 a 4 réplicas
  por CPU e PDB com `minAvailable: 1`. Não há Ingress, URL pública ou
  LoadBalancer adicional.

Ambos os ambientes possuem readiness/liveness probes em `/`, limites de CPU e
memória e ServiceAccount com Workload Identity. A observabilidade ativa fica
deliberadamente para a Fase 6.

## Validação local

```bash
kubectl kustomize deploy/kustomize/overlays/hml
kubectl kustomize deploy/kustomize/overlays/prod
kubectl kustomize deploy/kustomize/migration/overlays/hml
bash -n scripts/deploy-api.sh
```

O script de deploy é destinado ao runner autenticado pelo OIDC. Ele exige o
SHA atual em `GITHUB_SHA`, rejeita `latest` e não deve ser executado localmente
contra Azure sem a liberação de custo.
