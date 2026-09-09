import { VeiculoNaoEncontradoError } from '../../../domain/errors/VeiculoNaoEncontradoError';
import { VeiculoRepository } from '../../../domain/repositories/VeiculoRepository';

interface Input {
  id: string;
}

export class RemoverVeiculoUseCase {
  constructor(private readonly veiculoRepo: VeiculoRepository) {}

  async execute(input: Input): Promise<void> {
    const veiculo = await this.veiculoRepo.findById(input.id);
    if (!veiculo) throw new VeiculoNaoEncontradoError();

    veiculo.desativar();
    await this.veiculoRepo.save(veiculo);
  }
}
