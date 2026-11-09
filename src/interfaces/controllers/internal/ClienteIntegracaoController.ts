import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrismaClienteRepository } from '../../../infrastructure/repositories/PrismaClienteRepository';

@Controller('internal/clientes')
export class ClienteIntegracaoController {
  constructor(private readonly clientes: PrismaClienteRepository) {}

  @Post('validar-cpf')
  @HttpCode(200)
  async validarCpf(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const secret = process.env.INTERNAL_CLIENT_LOOKUP_TOKEN;
    const supplied = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';
    const expectedBytes = Buffer.from(secret ?? '', 'utf8');
    const suppliedBytes = Buffer.from(supplied, 'utf8');
    if (
      expectedBytes.length < 32 ||
      expectedBytes.length !== suppliedBytes.length ||
      !timingSafeEqual(expectedBytes, suppliedBytes) ||
      secret === process.env.JWT_SECRET ||
      secret === process.env.JWT_CLIENT_SECRET
    ) {
      throw new UnauthorizedException();
    }
    const cpf =
      typeof body === 'object' && body !== null && 'cpf' in body
        ? body.cpf
        : undefined;
    if (typeof cpf !== 'string' || !/^\d{11}$/.test(cpf))
      throw new BadRequestException();
    const cliente = await this.clientes.findByDocumento(cpf);
    return {
      cliente: cliente ? { id: cliente.getId(), ativo: cliente.ativo } : null,
    };
  }
}
