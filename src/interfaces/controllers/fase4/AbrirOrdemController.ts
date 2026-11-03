import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Injectable,
  OnApplicationShutdown,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JwtAuthGuard } from '../../guards/JwtAuthGuard';
import { OpenOrderWithSaga } from '../../../infrastructure/saga/AbrirOrdem';

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
}
