import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  OrcamentoWebhookTokenPayload,
  OrcamentoWebhookTokenPort,
} from '../../../application/ports/output/OrcamentoWebhookTokenPort';
import { WebhookOrcamentoController } from './WebhookOrcamentoController';

class FakeOrcamentoWebhookTokenPort implements OrcamentoWebhookTokenPort {
  payload?: OrcamentoWebhookTokenPayload;
  deveFalhar = false;

  async gerarToken(): Promise<string> {
    return 'token';
  }

  async validarToken(): Promise<OrcamentoWebhookTokenPayload> {
    if (this.deveFalhar || !this.payload) {
      throw new Error('Token invalido');
    }
    return this.payload;
  }
}

describe('WebhookOrcamentoController', () => {
  function makeSut() {
    const aprovarOrcamento = {
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const recusarOrcamento = {
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const webhookTokens = new FakeOrcamentoWebhookTokenPort();
    const controller = new WebhookOrcamentoController(
      aprovarOrcamento as any,
      recusarOrcamento as any,
      webhookTokens,
    );

    return { aprovarOrcamento, recusarOrcamento, webhookTokens, controller };
  }

  it('deve aprovar orcamento com token valido', async () => {
    const { aprovarOrcamento, webhookTokens, controller } = makeSut();
    webhookTokens.payload = { osId: 'os-1', acao: 'aprovar' };

    const resposta = await controller.aprovar('token-valido');

    expect(aprovarOrcamento.execute).toHaveBeenCalledWith({ osId: 'os-1' });
    expect(resposta).toEqual({ mensagem: 'Orcamento aprovado com sucesso.' });
  });

  it('deve recusar orcamento com token valido', async () => {
    const { recusarOrcamento, webhookTokens, controller } = makeSut();
    webhookTokens.payload = { osId: 'os-1', acao: 'recusar' };

    const resposta = await controller.recusar('token-valido');

    expect(recusarOrcamento.execute).toHaveBeenCalledWith({ osId: 'os-1' });
    expect(resposta).toEqual({ mensagem: 'Orcamento recusado.' });
  });

  it('deve rejeitar token invalido', async () => {
    const { webhookTokens, controller } = makeSut();
    webhookTokens.deveFalhar = true;

    await expect(controller.aprovar('token-invalido')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('deve rejeitar token incompativel com a acao', async () => {
    const { webhookTokens, controller } = makeSut();
    webhookTokens.payload = { osId: 'os-1', acao: 'aprovar' };

    await expect(controller.recusar('token-aprovacao')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('deve rejeitar token de recusa na rota de aprovacao', async () => {
    const { webhookTokens, controller } = makeSut();
    webhookTokens.payload = { osId: 'os-1', acao: 'recusar' };

    await expect(controller.aprovar('token-recusa')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('deve rejeitar token ausente', async () => {
    const { controller } = makeSut();

    await expect(controller.aprovar(undefined as any)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
