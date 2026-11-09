import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Documento } from '../../domain/value-objects/Documento';
import { PlacaVeiculo } from '../../domain/value-objects/PlacaVeiculo';

type ClientInput = { nome: string; documento: string; contato: string };
type VehicleInput = {
  clienteId: string;
  placa: string;
  marca: string;
  modelo: string;
  ano: number;
};
const idOk = (x: unknown): x is string =>
  typeof x === 'string' && /^[a-z0-9_-]{1,128}$/i.test(x);
const textOk = (x: unknown): x is string =>
  typeof x === 'string' && x.trim().length > 0 && x.length <= 200;
const objectHasOnly = (
  value: unknown,
  allowed: string[],
): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => allowed.includes(key));
function document(value: unknown): Documento {
  if (typeof value !== 'string' || value.length > 32)
    throw new BadRequestException('Documento inválido');
  try {
    return new Documento(value);
  } catch {
    throw new BadRequestException('Documento inválido');
  }
}
function plate(value: unknown): string {
  if (typeof value !== 'string' || value.length > 16)
    throw new BadRequestException('Placa inválida');
  try {
    return new PlacaVeiculo(value).valor;
  } catch {
    throw new BadRequestException('Placa inválida');
  }
}
function pagination(page: number, limit: number) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new BadRequestException('Paginação inválida');
  return { limit, offset: (page - 1) * limit };
}
function identifier(value: string) {
  if (!idOk(value)) throw new BadRequestException('Identificador inválido');
}

/** Cadastros isolados no banco do OS; o legado não é alterado. */
export class Phase4Registry {
  constructor(private readonly db: PrismaClient) {}
  async createClient(input: ClientInput) {
    if (
      !objectHasOnly(input, ['nome', 'documento', 'contato']) ||
      !textOk(input.nome) ||
      !textOk(input.contato)
    )
      throw new BadRequestException('Dados inválidos');
    const value = document(input.documento),
      id = randomUUID(),
      type = value.tipo === 'CPF' ? 'PF' : 'PJ';
    const rows = await this.db.$queryRaw<
      Array<{ id: string }>
    >`INSERT INTO "Cliente" ("id","nome","documento","tipo","contato","updatedAt") VALUES (${id},${input.nome.trim()},${value.valor},${type},${input.contato.trim()},NOW()) ON CONFLICT ("documento") DO NOTHING RETURNING "id"`;
    if (!rows.length) throw new ConflictException('Documento já cadastrado');
    return rows[0];
  }
  async client(id: string) {
    identifier(id);
    const rows = await this.db.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT "id","nome","documento","tipo","contato","ativo","createdAt","updatedAt" FROM "Cliente" WHERE "id"=${id}`;
    if (!rows.length) throw new NotFoundException('Cliente não encontrado');
    return rows[0];
  }
  async clients(page = 1, limit = 20) {
    const p = pagination(page, limit);
    const items = await this.db.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT "id","nome","documento","tipo","contato","ativo","createdAt","updatedAt" FROM "Cliente" WHERE "ativo"=true ORDER BY "createdAt","id" LIMIT ${p.limit} OFFSET ${p.offset}`;
    return { items, page, limit };
  }
  async clientByDocument(value: string) {
    const normalized = document(value).valor;
    const rows = await this.db.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT "id","nome","documento","tipo","contato","ativo","createdAt","updatedAt" FROM "Cliente" WHERE "documento"=${normalized}`;
    if (!rows.length) throw new NotFoundException('Cliente não encontrado');
    return rows[0];
  }
  async updateClient(id: string, input: { nome?: string; contato?: string }) {
    identifier(id);
    if (
      !objectHasOnly(input, ['nome', 'contato']) ||
      !Object.keys(input).length ||
      (input.nome !== undefined && !textOk(input.nome)) ||
      (input.contato !== undefined && !textOk(input.contato))
    )
      throw new BadRequestException('Dados inválidos');
    const name = input.nome?.trim() ?? null,
      contact = input.contato?.trim() ?? null;
    const count = await this.db
      .$executeRaw`UPDATE "Cliente" SET "nome"=COALESCE(${name},"nome"),"contato"=COALESCE(${contact},"contato"),"updatedAt"=NOW() WHERE "id"=${id} AND "ativo"=true`;
    if (!count) throw new NotFoundException('Cliente não encontrado');
    return this.client(id);
  }
  async deactivateClient(id: string) {
    identifier(id);
    const count = await this.db
      .$executeRaw`UPDATE "Cliente" SET "ativo"=false,"updatedAt"=NOW() WHERE "id"=${id} AND "ativo"=true`;
    if (!count) throw new NotFoundException('Cliente não encontrado');
    return { id, ativo: false };
  }
  async createVehicle(input: VehicleInput) {
    if (
      !objectHasOnly(input, ['clienteId', 'placa', 'marca', 'modelo', 'ano']) ||
      !idOk(input.clienteId) ||
      !textOk(input.marca) ||
      !textOk(input.modelo) ||
      !Number.isSafeInteger(input.ano) ||
      input.ano < 1900 ||
      input.ano > 9999
    )
      throw new BadRequestException('Dados inválidos');
    const normalized = plate(input.placa),
      id = randomUUID();
    return this.db.$transaction(async (tx) => {
      const clients = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "Cliente" WHERE "id"=${input.clienteId} AND "ativo"=true FOR SHARE`;
      if (!clients.length)
        throw new NotFoundException('Cliente não encontrado');
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`INSERT INTO "Veiculo" ("id","clienteId","placa","marca","modelo","ano","updatedAt") VALUES (${id},${input.clienteId},${normalized},${input.marca.trim()},${input.modelo.trim()},${input.ano},NOW()) ON CONFLICT ("placa") DO NOTHING RETURNING "id"`;
      if (!rows.length) throw new ConflictException('Placa já cadastrada');
      return rows[0];
    });
  }
  async vehicle(id: string) {
    identifier(id);
    const rows = await this.db.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT "id","clienteId","placa","marca","modelo","ano","ativo","createdAt","updatedAt" FROM "Veiculo" WHERE "id"=${id}`;
    if (!rows.length) throw new NotFoundException('Veículo não encontrado');
    return rows[0];
  }
  async vehicles(page = 1, limit = 20, clienteId?: string) {
    const p = pagination(page, limit);
    if (clienteId !== undefined) identifier(clienteId);
    const client = clienteId ?? null;
    const items = await this.db.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT "id","clienteId","placa","marca","modelo","ano","ativo","createdAt","updatedAt" FROM "Veiculo" WHERE "ativo"=true AND (${client}::text IS NULL OR "clienteId"=${client}) ORDER BY "createdAt","id" LIMIT ${p.limit} OFFSET ${p.offset}`;
    return { items, page, limit };
  }
  async updateVehicle(
    id: string,
    input: { marca?: string; modelo?: string; ano?: number },
  ) {
    identifier(id);
    if (
      !objectHasOnly(input, ['marca', 'modelo', 'ano']) ||
      !Object.keys(input).length ||
      (input.marca !== undefined && !textOk(input.marca)) ||
      (input.modelo !== undefined && !textOk(input.modelo)) ||
      (input.ano !== undefined &&
        (!Number.isSafeInteger(input.ano) ||
          input.ano < 1900 ||
          input.ano > 9999))
    )
      throw new BadRequestException('Dados inválidos');
    const brand = input.marca?.trim() ?? null,
      model = input.modelo?.trim() ?? null,
      year = input.ano ?? null;
    const count = await this.db
      .$executeRaw`UPDATE "Veiculo" SET "marca"=COALESCE(${brand},"marca"),"modelo"=COALESCE(${model},"modelo"),"ano"=COALESCE(${year}::integer,"ano"),"updatedAt"=NOW() WHERE "id"=${id} AND "ativo"=true`;
    if (!count) throw new NotFoundException('Veículo não encontrado');
    return this.vehicle(id);
  }
  async deactivateVehicle(id: string) {
    identifier(id);
    const count = await this.db
      .$executeRaw`UPDATE "Veiculo" SET "ativo"=false,"updatedAt"=NOW() WHERE "id"=${id} AND "ativo"=true`;
    if (!count) throw new NotFoundException('Veículo não encontrado');
    return { id, ativo: false };
  }
  async lookupCpf(cpf: string) {
    if (!/^\d{11}$/.test(cpf)) throw new BadRequestException('CPF inválido');
    const rows = await this.db.$queryRaw<
      Array<{ id: string; ativo: boolean }>
    >`SELECT "id","ativo" FROM "Cliente" WHERE "documento"=${cpf} LIMIT 1`;
    return { cliente: rows[0] ?? null };
  }
}
