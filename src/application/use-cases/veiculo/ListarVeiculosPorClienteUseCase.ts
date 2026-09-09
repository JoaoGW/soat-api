import { VeiculoRepository } from '../../../domain/repositories/VeiculoRepository';

interface Input {
  clienteId: string;
  ativo?: boolean;
}

export class ListarVeiculosPorClienteUseCase {
  constructor(private readonly veiculoRepo: VeiculoRepository) {}

  async execute(input: Input) {
    return this.veiculoRepo.findByClienteId(input.clienteId, {
      ativo: input.ativo ?? true,
    });
  }
}
