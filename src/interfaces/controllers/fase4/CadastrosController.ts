import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Injectable,
  OnApplicationShutdown,
  Param,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Phase4Registry } from '../../../infrastructure/saga/CadastrosFase4';
import { JwtAuthGuard } from '../../guards/JwtAuthGuard';
import { JwtClienteAuthGuard } from '../../guards/JwtClienteAuthGuard';
import { Phase4OrderQueries } from '../../../infrastructure/saga/ConsultarOrdemFase4';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Injectable()
export class Phase4RegistryRuntime implements OnApplicationShutdown {
  private db?: PrismaClient;
  private database(): PrismaClient {
    const url = process.env.SAGA_DATABASE_URL;
    if (process.env.ENABLE_FASE4_REGISTRY !== 'true' || !url)
      throw new ServiceUnavailableException('Cadastros Fase 4 indisponíveis');
    if (!this.db) this.db = new PrismaClient({ datasources: { db: { url } } });
    return this.db;
  }
  registry(): Phase4Registry {
    return new Phase4Registry(this.database());
  }
  orders(): Phase4OrderQueries {
    return new Phase4OrderQueries(this.database());
  }
  async onApplicationShutdown() {
    await this.db?.$disconnect();
  }
}
function page(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,5}$/.test(value))
    throw new BadRequestException('Paginação inválida');
  return Number(value);
}

@Controller('fase4/ordens-servico')
@ApiTags('Fase 4 - Ordens administrativas')
@ApiBearerAuth('JWT_ADMIN')
@UseGuards(JwtAuthGuard)
export class Phase4AdminOrderQueryController {
  constructor(private readonly runtime: Phase4RegistryRuntime) {}
  @Get('fila-operacional') queue(
    @Query('page') p?: string,
    @Query('limit') l?: string,
    @Query('filialId') filialId?: string,
    @Query('status') status?: string,
  ) {
    return this.runtime.orders().operationalQueue({
      page: page(p, 1),
      limit: page(l, 20),
      ...(filialId === undefined ? {} : { filialId }),
      ...(status === undefined ? {} : { status }),
    });
  }
  @Get() list(
    @Query('page') p?: string,
    @Query('limit') l?: string,
    @Query('filialId') filialId?: string,
    @Query('status') status?: string,
  ) {
    return this.runtime.orders().list({
      page: page(p, 1),
      limit: page(l, 20),
      ...(filialId === undefined ? {} : { filialId }),
      ...(status === undefined ? {} : { status }),
    });
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.runtime.orders().get(id);
  }
  @Get(':id/historico') history(@Param('id') id: string) {
    return this.runtime.orders().history(id);
  }
  @Get(':id/saga') saga(@Param('id') id: string) {
    return this.runtime.orders().saga(id);
  }
}

@Controller('fase4/cliente/ordens-servico')
@ApiTags('Fase 4 - Ordens do cliente')
@ApiBearerAuth('JWT_CLIENTE')
@UseGuards(JwtClienteAuthGuard)
export class Phase4CustomerOrderQueryController {
  constructor(private readonly runtime: Phase4RegistryRuntime) {}
  private owner(request: { user?: { clienteId?: unknown } }): string {
    if (
      typeof request.user?.clienteId !== 'string' ||
      !/^[a-z0-9_-]{1,128}$/i.test(request.user.clienteId)
    )
      throw new UnauthorizedException();
    return request.user.clienteId;
  }
  @Get() list(
    @Req() request: { user?: { clienteId?: unknown } },
    @Query('page') p?: string,
    @Query('limit') l?: string,
  ) {
    return this.runtime.orders().list({
      page: page(p, 1),
      limit: page(l, 20),
      clienteId: this.owner(request),
    });
  }
  @Get(':id') get(
    @Param('id') id: string,
    @Req() request: { user?: { clienteId?: unknown } },
  ) {
    return this.runtime.orders().get(id, this.owner(request));
  }
  @Get(':id/historico') history(
    @Param('id') id: string,
    @Req() request: { user?: { clienteId?: unknown } },
  ) {
    return this.runtime.orders().history(id, this.owner(request));
  }
}

@Controller('fase4/relatorios')
@ApiTags('Fase 4 - Relatórios')
@ApiBearerAuth('JWT_ADMIN')
@UseGuards(JwtAuthGuard)
export class Phase4ReportController {
  constructor(private readonly runtime: Phase4RegistryRuntime) {}
  @Get('tempo-medio-execucao') report() {
    return this.runtime.orders().report();
  }
}

@Controller('fase4/clientes')
@ApiTags('Fase 4 - Clientes')
@ApiBearerAuth('JWT_ADMIN')
@UseGuards(JwtAuthGuard)
export class Phase4ClientController {
  constructor(private readonly runtime: Phase4RegistryRuntime) {}
  @Post()
  @ApiBody({
    schema: {
      type: 'object',
      required: ['nome', 'documento', 'contato'],
      properties: {
        nome: { type: 'string' },
        documento: { type: 'string' },
        contato: { type: 'string' },
      },
    },
  })
  create(@Body() body: { nome: string; documento: string; contato: string }) {
    return this.runtime.registry().createClient(body);
  }
  @Get() list(
    @Query('page') p?: string,
    @Query('limit') l?: string,
    @Query('documento') documento?: string,
  ) {
    if (documento !== undefined)
      return this.runtime.registry().clientByDocument(documento);
    return this.runtime.registry().clients(page(p, 1), page(l, 20));
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.runtime.registry().client(id);
  }
  @Put(':id')
  @ApiBody({
    schema: {
      type: 'object',
      minProperties: 1,
      additionalProperties: false,
      properties: {
        nome: { type: 'string', minLength: 1, maxLength: 200 },
        contato: { type: 'string', minLength: 1, maxLength: 200 },
      },
    },
  })
  update(
    @Param('id') id: string,
    @Body() body: { nome?: string; contato?: string },
  ) {
    return this.runtime.registry().updateClient(id, body);
  }
  @Delete(':id') remove(@Param('id') id: string) {
    return this.runtime.registry().deactivateClient(id);
  }
}

@Controller('fase4/veiculos')
@ApiTags('Fase 4 - Veículos')
@ApiBearerAuth('JWT_ADMIN')
@UseGuards(JwtAuthGuard)
export class Phase4VehicleController {
  constructor(private readonly runtime: Phase4RegistryRuntime) {}
  @Post()
  @ApiBody({
    schema: {
      type: 'object',
      required: ['clienteId', 'placa', 'marca', 'modelo', 'ano'],
      properties: {
        clienteId: { type: 'string' },
        placa: { type: 'string' },
        marca: { type: 'string' },
        modelo: { type: 'string' },
        ano: { type: 'integer' },
      },
    },
  })
  create(
    @Body()
    body: {
      clienteId: string;
      placa: string;
      marca: string;
      modelo: string;
      ano: number;
    },
  ) {
    return this.runtime.registry().createVehicle(body);
  }
  @Get() list(
    @Query('page') p?: string,
    @Query('limit') l?: string,
    @Query('clienteId') clienteId?: string,
  ) {
    return this.runtime.registry().vehicles(page(p, 1), page(l, 20), clienteId);
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.runtime.registry().vehicle(id);
  }
  @Put(':id')
  @ApiBody({
    schema: {
      type: 'object',
      minProperties: 1,
      additionalProperties: false,
      properties: {
        marca: { type: 'string', minLength: 1, maxLength: 200 },
        modelo: { type: 'string', minLength: 1, maxLength: 200 },
        ano: { type: 'integer', minimum: 1900, maximum: 9999 },
      },
    },
  })
  update(
    @Param('id') id: string,
    @Body() body: { marca?: string; modelo?: string; ano?: number },
  ) {
    return this.runtime.registry().updateVehicle(id, body);
  }
  @Delete(':id') remove(@Param('id') id: string) {
    return this.runtime.registry().deactivateVehicle(id);
  }
}

/** Rota interna específica do novo banco, protegida por credencial de integração. */
@Controller('fase4/internal/clientes')
@ApiTags('Fase 4 - Integração interna')
@ApiBearerAuth('INTEGRACAO_INTERNA')
export class Phase4InternalClientController {
  constructor(private readonly runtime: Phase4RegistryRuntime) {}
  @Post('validar-cpf')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Consultar identificador e situação por CPF para integração autorizada',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['cpf'],
      additionalProperties: false,
      properties: { cpf: { type: 'string', pattern: '^\\d{11}$' } },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Cliente localizado ou null; retorna apenas ID e situação',
    schema: {
      type: 'object',
      required: ['cliente'],
      properties: {
        cliente: {
          type: 'object',
          nullable: true,
          required: ['id', 'ativo'],
          properties: { id: { type: 'string' }, ativo: { type: 'boolean' } },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'CPF ou corpo inválido' })
  @ApiResponse({
    status: 401,
    description: 'Credencial de integração inválida',
  })
  @ApiResponse({ status: 503, description: 'Consulta indisponível' })
  lookup(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const secret = process.env.INTERNAL_CLIENT_LOOKUP_TOKEN;
    const supplied = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';
    const expected = Buffer.from(secret ?? '', 'utf8'),
      candidate = Buffer.from(supplied, 'utf8');
    if (
      expected.length < 32 ||
      expected.length !== candidate.length ||
      !timingSafeEqual(expected, candidate) ||
      secret === process.env.JWT_SECRET ||
      secret === process.env.JWT_CLIENT_SECRET
    )
      throw new UnauthorizedException();
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'cpf') ||
      !('cpf' in body) ||
      typeof body.cpf !== 'string' ||
      !/^\d{11}$/.test(body.cpf)
    )
      throw new BadRequestException();
    return this.runtime.registry().lookupCpf(body.cpf);
  }
}
