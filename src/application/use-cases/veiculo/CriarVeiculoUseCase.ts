import { Veiculo } from '../../../domain/entities/Veiculo';
import { ClienteNaoEncontradoError } from '../../../domain/errors/ClienteNaoEncontradoError';
import { PlacaJaCadastradaError } from '../../../domain/errors/PlacaJaCadastradaError';
import { ClienteRepository } from '../../../domain/repositories/ClienteRepository';
import { VeiculoRepository } from '../../../domain/repositories/VeiculoRepository';
import { PlacaVeiculo } from '../../../domain/value-objects/PlacaVeiculo';

interface Input {
  clienteId: string;
  placa: string;
  marca: string;
  modelo: string;
  ano: number;
}

interface Output {
  id: string;
}

export class CriarVeiculoUseCase {
  constructor(
    private readonly veiculoRepo: VeiculoRepository,
    private readonly clienteRepo: ClienteRepository,
  ) {}

  async execute(input: Input): Promise<Output> {
    const cliente = await this.clienteRepo.findById(input.clienteId);
    if (!cliente) throw new ClienteNaoEncontradoError();

    const placa = new PlacaVeiculo(input.placa);
    const existente = await this.veiculoRepo.findByPlaca(placa.valor);
    if (existente) throw new PlacaJaCadastradaError();

    const veiculo = Veiculo.criar(
      input.clienteId,
      placa,
      input.marca,
      input.modelo,
      input.ano,
    );

    await this.veiculoRepo.save(veiculo);
    return { id: veiculo.getId() };
  }
}
