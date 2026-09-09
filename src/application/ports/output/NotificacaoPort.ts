export interface NotificacaoPort {
  enviarNotificacaoOrcamento(params: {
    destinatario: string;
    osId: string;
    codigoAcompanhamento: string;
    tokenAprovacao: string;
    tokenRecusa: string;
  }): Promise<void>;
}
