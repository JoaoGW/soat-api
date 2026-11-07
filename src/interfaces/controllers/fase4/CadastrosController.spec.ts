import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  Phase4ClientController,
  Phase4InternalClientController,
  Phase4RegistryRuntime,
  Phase4VehicleController,
  Phase4AdminOrderQueryController,
  Phase4CustomerOrderQueryController,
} from './CadastrosController';
import { JwtAuthGuard } from '../../guards/JwtAuthGuard';
import { JwtClienteAuthGuard } from '../../guards/JwtClienteAuthGuard';

describe('cadastros isolados da Fase 4', () => {
  const original = process.env;
  const token = 'segredo-integracao-independente-32-bytes';
  const registry = { lookupCpf: jest.fn() };
  const runtime = { registry: jest.fn(() => registry) };
  const internal = new Phase4InternalClientController(
    runtime as unknown as Phase4RegistryRuntime,
  );
  beforeEach(() => {
    process.env = {
      ...original,
      INTERNAL_CLIENT_LOOKUP_TOKEN: token,
      JWT_SECRET: 'admin-secret',
      JWT_CLIENT_SECRET: 'client-secret',
    };
    jest.clearAllMocks();
  });
  afterEach(() => {
    process.env = original;
  });
  it('protege CRUD de clientes e veículos com JWT administrativo', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, Phase4ClientController),
    ).toContain(JwtAuthGuard);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, Phase4VehicleController),
    ).toContain(JwtAuthGuard);
  });
  it('restringe as consultas de OS ao perfil e ao cliente autenticado', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, Phase4AdminOrderQueryController),
    ).toContain(JwtAuthGuard);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, Phase4CustomerOrderQueryController),
    ).toContain(JwtClienteAuthGuard);
    const get = jest.fn();
    const queries = {
      orders: () => ({ get }),
    } as unknown as Phase4RegistryRuntime;
    const controller = new Phase4CustomerOrderQueryController(queries);
    controller.get('ordem-1', { user: { clienteId: 'cliente-1' } });
    expect(get).toHaveBeenCalledWith('ordem-1', 'cliente-1');
    expect(() => controller.get('ordem-1', {})).toThrow();
  });
  it('rejeita JWT e só consulta CPF com segredo exclusivo', async () => {
    expect(() =>
      internal.lookup('Bearer jwt-cliente', { cpf: '52998224725' }),
    ).toThrow();
    expect(() =>
      internal.lookup(`Bearer ${token}`, { cpf: '529.982.247-25' }),
    ).toThrow();
    registry.lookupCpf.mockResolvedValue({
      cliente: { id: 'client', ativo: true },
    });
    await expect(
      internal.lookup(`Bearer ${token}`, { cpf: '52998224725' }),
    ).resolves.toEqual({ cliente: { id: 'client', ativo: true } });
    expect(registry.lookupCpf).toHaveBeenCalledTimes(1);
  });
  it('mantém cadastros desativados por padrão', () => {
    delete process.env.ENABLE_FASE4_REGISTRY;
    expect(() => new Phase4RegistryRuntime().registry()).toThrow(
      'indisponíveis',
    );
  });
});
