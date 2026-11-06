import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailAdapter } from './EmailAdapter';
import { ObservabilityService } from '../../observability/ObservabilityService';

it('monta o e-mail com os links codificados usando o transporte Nodemailer', async () => {
  const config = new ConfigService({
    MAIL_HOST: 'smtp.invalid',
    MAIL_PORT: '587',
    MAIL_USER: 'local@example.test',
    MAIL_PASS: 'local-fixture',
    MAIL_FROM: 'oficina@example.test',
    APP_URL: 'https://oficina.example.test/',
  });
  const observability = { registrarErroIntegracao: jest.fn() };
  const adapter = new EmailAdapter(
    config,
    observability as unknown as ObservabilityService,
  );
  const transporter = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });
  const send = jest.spyOn(transporter, 'sendMail');
  (adapter as unknown as { transporter: typeof transporter }).transporter =
    transporter;
  await adapter.enviarNotificacaoOrcamento({
    destinatario: 'cliente@example.test',
    osId: 'os-1',
    codigoAcompanhamento: 'OS-123',
    tokenAprovacao: 'a+b',
    tokenRecusa: 'c/d',
  });
  const result = (await send.mock.results[0].value) as { message: Buffer };
  const message = result.message.toString('utf8');
  expect(message).toContain('OS-123');
  expect(message).toContain('token=3Da%2Bb');
  expect(message).toContain('token=3Dc%2Fd');
  expect(observability.registrarErroIntegracao).not.toHaveBeenCalled();
});
