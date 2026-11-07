import { ClienteIntegracaoController } from './ClienteIntegracaoController';
import { PrismaClienteRepository } from '../../../infrastructure/repositories/PrismaClienteRepository';

describe('ClienteIntegracaoController', () => {
  const token = 'integracao-exclusiva-com-32-bytes-ou-mais';
  const repo = { findByDocumento: jest.fn() };
  const controller = new ClienteIntegracaoController(
    repo as unknown as PrismaClienteRepository,
  );
  beforeEach(() => {
    process.env.INTERNAL_CLIENT_LOOKUP_TOKEN = token;
    repo.findByDocumento.mockReset();
  });
  afterEach(() => {
    delete process.env.INTERNAL_CLIENT_LOOKUP_TOKEN;
  });
  it('retorna somente identidade e situação do cliente', async () => {
    repo.findByDocumento.mockResolvedValue({
      getId: () => 'id-1',
      ativo: false,
      nome: 'privado',
    });
    await expect(
      controller.validarCpf(`Bearer ${token}`, { cpf: '52998224725' }),
    ).resolves.toEqual({ cliente: { id: 'id-1', ativo: false } });
  });
  it('retorna null quando não existe', async () => {
    repo.findByDocumento.mockResolvedValue(null);
    await expect(
      controller.validarCpf(`Bearer ${token}`, { cpf: '52998224725' }),
    ).resolves.toEqual({ cliente: null });
  });
  it.each([undefined, 'Bearer errado', 'Bearer cliente.jwt.assinado'])(
    'rejeita credencial inválida',
    async (auth) => {
      await expect(
        controller.validarCpf(auth, { cpf: '52998224725' }),
      ).rejects.toMatchObject({ status: 401 });
      expect(repo.findByDocumento).not.toHaveBeenCalled();
    },
  );
  it('rejeita CPF não normalizado', async () => {
    await expect(
      controller.validarCpf(`Bearer ${token}`, { cpf: '529.982.247-25' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
