export type AcaoWebhookOrcamento = 'aprovar' | 'recusar';

export interface OrcamentoWebhookTokenPayload {
  osId: string;
  acao: AcaoWebhookOrcamento;
}

export interface OrcamentoWebhookTokenPort {
  gerarToken(payload: OrcamentoWebhookTokenPayload): Promise<string>;
  validarToken(token: string): Promise<OrcamentoWebhookTokenPayload>;
}
