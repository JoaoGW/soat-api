import { CriarOrdemDeServicoUseCase } from '../CriarOrdemDeServicoUseCase';
import { InMemoryClienteRepository } from '../fakes/InMemoryClienteRepository';
import { InMemoryOrdemDeServicoRepository } from '../fakes/InMemoryOrdemDeServicoRepository';
import { InMemoryPecaRepository } from '../fakes/InMemoryPecaRepository';
import { InMemoryServicoRepository } from '../fakes/InMemoryServicoRepository';
import { InMemoryVeiculoRepository } from '../fakes/InMemoryVeiculoRepository';
import { ClienteNaoEncontradoError } from '../../../domain/errors/ClienteNaoEncontradoError';
import { EstoqueInsuficienteError } from '../../../domain/errors/EstoqueInsuficienteError';
import { PecaNaoEncontradaError } from '../../../domain/errors/PecaNaoEncontradaError';
import { ServicoNaoEncontradoError } from '../../../domain/errors/ServicoNaoEncontradoError';
import { VeiculoNaoEncontradoError } from '../../../domain/errors/VeiculoNaoEncontradoError';
import { VeiculoNaoPertenceAoClienteError } from '../../../domain/errors/VeiculoNaoPertenceAoClienteError';
import { makeCliente, makePeca, makeServico, makeVeiculo } from './_helpers';
import { Documento } from '../../../domain/value-objects/Documento';
import { Cliente } from '../../../domain/entities/Cliente';

describe('CriarOrdemDeServicoUseCase', () => {
  function makeSut() {
    const osRepo = new InMemoryOrdemDeServicoRepository();
    const clienteRepo = new InMemoryClienteRepository();
    const veiculoRepo = new InMemoryVeiculoRepository();
    const servicoRepo = new InMemoryServicoRepository();
    const pecaRepo = new InMemoryPecaRepository();
    const useCase = new CriarOrdemDeServicoUseCase(
      osRepo,
      clienteRepo,
      veiculoRepo,
      servicoRepo,
      pecaRepo,
    );

    return { osRepo, clienteRepo, veiculoRepo, servicoRepo, pecaRepo, useCase };
  }

  it('deve falhar se cliente nao existir', async () => {
    const { veiculoRepo, useCase } = makeSut();

    const cliente = makeCliente();
    const veiculo = makeVeiculo(cliente.getId());
    await veiculoRepo.save(veiculo);

    await expect(
      useCase.execute({
        clienteId: cliente.getId(),
        veiculoId: veiculo.getId(),
      }),
    ).rejects.toBeInstanceOf(ClienteNaoEncontradoError);
  });

  it('deve falhar se veiculo nao existir', async () => {
    const { clienteRepo, useCase } = makeSut();

    const cliente = makeCliente();
    await clienteRepo.save(cliente);

    await expect(
      useCase.execute({
        clienteId: cliente.getId(),
        veiculoId: 'veiculo-inexistente',
      }),
    ).rejects.toBeInstanceOf(VeiculoNaoEncontradoError);
  });

  it('deve falhar se veiculo nao pertencer ao cliente', async () => {
    const { clienteRepo, veiculoRepo, useCase } = makeSut();

    const clienteA = makeCliente();
    const clienteB = Cliente.criar(
      'Cliente B',
      new Documento('11144477735'),
      'PF',
    );
    await clienteRepo.save(clienteA);
    await clienteRepo.save(clienteB);

    const veiculo = makeVeiculo(clienteB.getId());
    await veiculoRepo.save(veiculo);

    await expect(
      useCase.execute({
        clienteId: clienteA.getId(),
        veiculoId: veiculo.getId(),
      }),
    ).rejects.toBeInstanceOf(VeiculoNaoPertenceAoClienteError);
  });

  it('deve criar OS valida com status inicial RECEBIDA', async () => {
    const { osRepo, clienteRepo, veiculoRepo, useCase } = makeSut();

    const cliente = makeCliente();
    const veiculo = makeVeiculo(cliente.getId());
    await clienteRepo.save(cliente);
    await veiculoRepo.save(veiculo);

    const output = await useCase.execute({
      clienteId: cliente.getId(),
      veiculoId: veiculo.getId(),
    });

    expect(output.id).toBeDefined();
    expect(output.codigoAcompanhamento).toMatch(/^OS-\d{4}-[A-Z0-9]{6}$/);
    expect(output.status).toBe('RECEBIDA');
    expect(output.dataCriacao).toBeInstanceOf(Date);
    expect(osRepo.items).toHaveLength(1);
  });

  it('deve criar OS com servicos e pecas opcionais', async () => {
    const { osRepo, clienteRepo, veiculoRepo, servicoRepo, pecaRepo, useCase } =
      makeSut();
    const cliente = makeCliente();
    const veiculo = makeVeiculo(cliente.getId());
    const servico = makeServico('Troca de oleo', 12000);
    const peca = makePeca('Filtro de oleo', 5000, 3);
    await clienteRepo.save(cliente);
    await veiculoRepo.save(veiculo);
    await servicoRepo.save(servico);
    await pecaRepo.save(peca);

    const output = await useCase.execute({
      clienteId: cliente.getId(),
      veiculoId: veiculo.getId(),
      servicos: [{ servicoId: servico.getId() }],
      pecas: [{ pecaId: peca.getId(), quantidade: 2 }],
    });

    const os = await osRepo.findById(output.id);
    expect(os?.servicos).toHaveLength(1);
    expect(os?.servicos[0].preco.centavos).toBe(12000);
    expect(os?.itens).toHaveLength(1);
    expect(os?.itens[0].quantidade.valor).toBe(2);
    expect(os?.itens[0].precoUnitario.centavos).toBe(5000);
  });

  it('deve falhar se servico inicial nao existir', async () => {
    const { clienteRepo, veiculoRepo, useCase } = makeSut();
    const cliente = makeCliente();
    const veiculo = makeVeiculo(cliente.getId());
    await clienteRepo.save(cliente);
    await veiculoRepo.save(veiculo);

    await expect(
      useCase.execute({
        clienteId: cliente.getId(),
        veiculoId: veiculo.getId(),
        servicos: [{ servicoId: 'servico-inexistente' }],
      }),
    ).rejects.toBeInstanceOf(ServicoNaoEncontradoError);
  });

  it('deve falhar se peca inicial nao existir', async () => {
    const { clienteRepo, veiculoRepo, useCase } = makeSut();
    const cliente = makeCliente();
    const veiculo = makeVeiculo(cliente.getId());
    await clienteRepo.save(cliente);
    await veiculoRepo.save(veiculo);

    await expect(
      useCase.execute({
        clienteId: cliente.getId(),
        veiculoId: veiculo.getId(),
        pecas: [{ pecaId: 'peca-inexistente', quantidade: 1 }],
      }),
    ).rejects.toBeInstanceOf(PecaNaoEncontradaError);
  });

  it('deve falhar se peca inicial nao tiver estoque suficiente', async () => {
    const { clienteRepo, veiculoRepo, pecaRepo, useCase } = makeSut();
    const cliente = makeCliente();
    const veiculo = makeVeiculo(cliente.getId());
    const peca = makePeca('Pastilha de freio', 9000, 1);
    await clienteRepo.save(cliente);
    await veiculoRepo.save(veiculo);
    await pecaRepo.save(peca);

    await expect(
      useCase.execute({
        clienteId: cliente.getId(),
        veiculoId: veiculo.getId(),
        pecas: [{ pecaId: peca.getId(), quantidade: 2 }],
      }),
    ).rejects.toBeInstanceOf(EstoqueInsuficienteError);
  });
});
