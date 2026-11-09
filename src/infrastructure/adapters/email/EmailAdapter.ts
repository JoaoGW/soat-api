import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { NotificacaoPort } from '../../../application/ports/output/NotificacaoPort';
import { ObservabilityService } from '../../observability/ObservabilityService';

@Injectable()
export class EmailAdapter implements NotificacaoPort {
  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly config: ConfigService,
    private readonly observability: ObservabilityService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.getOrThrow<string>('MAIL_HOST'),
      port: Number(this.config.getOrThrow<string>('MAIL_PORT')),
      auth: {
        user: this.config.getOrThrow<string>('MAIL_USER'),
        pass: this.config.getOrThrow<string>('MAIL_PASS'),
      },
    });
  }

  async enviarNotificacaoOrcamento(params: {
    destinatario: string;
    osId: string;
    codigoAcompanhamento: string;
    tokenAprovacao: string;
    tokenRecusa: string;
  }): Promise<void> {
    const appUrl = this.config.getOrThrow<string>('APP_URL').replace(/\/$/, '');

    try {
      await this.transporter.sendMail({
        from: this.config.getOrThrow<string>('MAIL_FROM'),
        to: params.destinatario,
        subject: `Orcamento aguardando aprovacao - OS ${params.codigoAcompanhamento}`,
        html: `
        <h2>Seu orcamento esta pronto</h2>
        <p>OS: <strong>${params.codigoAcompanhamento}</strong></p>
        <p>
          <a href="${appUrl}/webhook/orcamento/aprovar?token=${encodeURIComponent(
            params.tokenAprovacao,
          )}">
            Aprovar orcamento
          </a>
        </p>
        <p>
          <a href="${appUrl}/webhook/orcamento/recusar?token=${encodeURIComponent(
            params.tokenRecusa,
          )}">
            Recusar orcamento
          </a>
        </p>
      `,
      });
    } catch (error) {
      this.observability.registrarErroIntegracao('email');
      throw error;
    }
  }
}
