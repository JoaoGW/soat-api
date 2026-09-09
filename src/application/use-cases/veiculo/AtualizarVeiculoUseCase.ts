import { VeiculoNaoEncontradoError } from '../../../domain/errors/VeiculoNaoEncontradoError';
import { VeiculoRepository } from '../../../domain/repositories/VeiculoRepository';

interface Input {
  id: string;
  marca?: string;
  modelo?: string;
  ano?: number;
}

export class AtualizarVeiculoUseCase {
  constructor(private readonly veiculoRepo: VeiculoRepository) {}

  async execute(input: Input): Promise<void> {
    const veiculo = await this.veiculoRepo.findById(input.id);
    if (!veiculo) throw new VeiculoNaoEncontradoError();

    if (input.marca !== undefined) veiculo.atualizarMarca(input.marca);
    if (input.modelo !== undefined) veiculo.atualizarModelo(input.modelo);
    if (input.ano !== undefined) veiculo.atualizarAno(input.ano);

    await this.veiculoRepo.save(veiculo);
  }
}
