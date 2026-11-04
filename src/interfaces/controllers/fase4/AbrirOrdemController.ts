import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Injectable,
  OnApplicationShutdown,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JwtAuthGuard } from '../../guards/JwtAuthGuard';
import { OpenOrderWithSaga } from '../../../infrastructure/saga/AbrirOrdem';
import { StartCompensation } from '../../../infrastructure/saga/IniciarCompensacao';
import { DeliverOrder } from '../../../infrastructure/saga/EntregarOrdem';
import { RetryFailedCommand } from '../../../infrastructure/saga/ReprocessarComando';
import { RecoverLatePayment } from '../../../infrastructure/saga/RecuperarPagamentoTardio';
import { RecoverCompletedRepair } from '../../../infrastructure/saga/RecuperarReparoConcluido';

type BodyInput = {
  clienteId: string;
  veiculoId: string;
  filialId: string;
  solicitacoes?: string[];
};
@Injectable()
export class OpenOrderRuntime implements OnApplicationShutdown {
  private db?: PrismaClient;
  async execute(actorId: string, key: string, input: BodyInput) {
    const url = process.env.SAGA_DATABASE_URL;
    if (process.env.ENABLE_FASE4_OPEN !== 'true' || !url)
      throw new ServiceUnavailableException('Abertura Fase 4 indisponível');
    if (!this.db) this.db = new PrismaClient({ datasources: { db: { url } } });
    return new OpenOrderWithSaga(this.db).execute({ actorId, key, ...input });
  }
  async onApplicationShutdown() {
    await this.db?.$disconnect();
  }
  async compensate(sagaId: string, reason: string) {
    const url = process.env.SAGA_DATABASE_URL;
    if (process.env.ENABLE_FASE4_COMPENSATION !== 'true' || !url)
      throw new ServiceUnavailableException('Compensação indisponível');
    if (!this.db) this.db = new PrismaClient({ datasources: { db: { url } } });
    return new StartCompensation(this.db).execute(sagaId, reason);
  }
  async deliver(osId: string) {
    const url = process.env.SAGA_DATABASE_URL;
    if (process.env.ENABLE_FASE4_DELIVERY !== 'true' || !url)
      throw new ServiceUnavailableException('Entrega indisponível');
    if (!this.db) this.db = new PrismaClient({ datasources: { db: { url } } });
    return new DeliverOrder(this.db).execute(osId);
  }
  async retry(input: {
    sagaId: string;
    messageId: string;
    actorId: string;
    reason: string;
  }) {
    const url = process.env.SAGA_DATABASE_URL;
    if (process.env.ENABLE_FASE4_RECOVERY !== 'true' || !url)
      throw new ServiceUnavailableException('Recuperação indisponível');
    if (!this.db) this.db = new PrismaClient({ datasources: { db: { url } } });
    await new RetryFailedCommand(this.db).execute(input);
  }
  async recoverLatePayment(input: {
    sagaId: string;
    actorId: string;
    reason: string;
  }) {
    const url = process.env.SAGA_DATABASE_URL;
    if (process.env.ENABLE_FASE4_RECOVERY !== 'true' || !url)
      throw new ServiceUnavailableException('Recuperação indisponível');
    if (!this.db) this.db = new PrismaClient({ datasources: { db: { url } } });
    return new RecoverLatePayment(this.db).execute(input);
  }
  async recoverCompletedRepair(input: {
    sagaId: string;
    actorId: string;
    reason: string;
  }) {
    const url = process.env.SAGA_DATABASE_URL;
    if (process.env.ENABLE_FASE4_RECOVERY !== 'true' || !url)
      throw new ServiceUnavailableException('Recuperação indisponível');
    if (!this.db) this.db = new PrismaClient({ datasources: { db: { url } } });
    return new RecoverCompletedRepair(this.db).execute(input);
  }
}
@Controller('fase4/ordens-servico')
@UseGuards(JwtAuthGuard)
export class OpenOrderController {
  constructor(private readonly runtime: OpenOrderRuntime) {}
  @Post()
  async open(
    @Req() request: { user?: { username?: unknown } },
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: BodyInput,
  ) {
    if (
      typeof request.user?.username !== 'string' ||
      !key ||
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (field) =>
          !['clienteId', 'veiculoId', 'filialId', 'solicitacoes'].includes(
            field,
          ),
      )
    )
      throw new BadRequestException('Dados inválidos');
    return this.runtime.execute(request.user.username, key, body);
  }
  @Post(':sagaId/compensar')
  async compensate(
    @Param('sagaId') sagaId: string,
    @Body() body: { reason: string },
  ) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((field) => field !== 'reason') ||
      typeof body.reason !== 'string' ||
      !/^[a-z0-9_-]{1,128}$/i.test(body.reason) ||
      !/^[a-z0-9_-]{1,128}$/i.test(sagaId)
    )
      throw new BadRequestException('Dados inválidos');
    return { status: await this.runtime.compensate(sagaId, body.reason) };
  }
  @Post(':osId/entregar')
  async deliver(@Param('osId') osId: string) {
    if (!/^[a-z0-9_-]{1,128}$/i.test(osId))
      throw new BadRequestException('Dados inválidos');
    return { status: await this.runtime.deliver(osId) };
  }
  @Post(':sagaId/comandos/:messageId/reprocessar')
  async retry(
    @Req() request: { user?: { username?: unknown } },
    @Param('sagaId') sagaId: string,
    @Param('messageId') messageId: string,
    @Body() body: { reason: string },
  ) {
    if (
      typeof request.user?.username !== 'string' ||
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((field) => field !== 'reason') ||
      ![sagaId, messageId, request.user.username, body.reason].every(
        (value) =>
          typeof value === 'string' && /^[a-z0-9_@.-]{1,128}$/i.test(value),
      )
    )
      throw new BadRequestException('Dados inválidos');
    await this.runtime.retry({
      sagaId,
      messageId,
      actorId: request.user.username,
      reason: body.reason,
    });
    return { status: 'PENDING', messageId };
  }
  @Post(':sagaId/reconciliar-pagamento')
  async recoverLatePayment(
    @Req() request: { user?: { username?: unknown } },
    @Param('sagaId') sagaId: string,
    @Body() body: { reason: string },
  ) {
    if (
      typeof request.user?.username !== 'string' ||
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((field) => field !== 'reason') ||
      !/^[a-z0-9_@.-]{1,128}$/i.test(request.user.username) ||
      ![sagaId, body.reason].every(
        (value) =>
          typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value),
      )
    )
      throw new BadRequestException('Dados inválidos');
    return {
      status: await this.runtime.recoverLatePayment({
        sagaId,
        actorId: request.user.username,
        reason: body.reason,
      }),
    };
  }
  @Post(':sagaId/reconciliar-reparo')
  async recoverCompletedRepair(
    @Req() request: { user?: { username?: unknown } },
    @Param('sagaId') sagaId: string,
    @Body() body: { reason: string },
  ) {
    if (
      typeof request.user?.username !== 'string' ||
      !/^[a-z0-9_@.-]{1,128}$/i.test(request.user.username) ||
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((field) => field !== 'reason') ||
      ![sagaId, body.reason].every(
        (value) =>
          typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value),
      )
    )
      throw new BadRequestException('Dados inválidos');
    return {
      status: await this.runtime.recoverCompletedRepair({
        sagaId,
        actorId: request.user.username,
        reason: body.reason,
      }),
    };
  }
}
