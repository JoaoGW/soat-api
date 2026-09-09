import { VeiculoNaoEncontradoError } from '../../../domain/errors/VeiculoNaoEncontradoError';
import { VeiculoRepository } from '../../../domain/repositories/VeiculoRepository';

export class BuscarVeiculoPorIdUseCase {
  constructor(private readonly veiculoRepo: VeiculoRepository) {}

  async execute(id: string) {
    const veiculo = await this.veiculoRepo.findById(id);
    if (!veiculo) throw new VeiculoNaoEncontradoError();
    return veiculo;
  }
}
