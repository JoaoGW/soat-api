import { Cliente } from '../../../domain/entities/Cliente';
import { OrdemDeServico } from '../../../domain/entities/OrdemDeServico';
import { Peca } from '../../../domain/entities/Peca';
import { Servico } from '../../../domain/entities/Servico';
import { Veiculo } from '../../../domain/entities/Veiculo';
import { Documento } from '../../../domain/value-objects/Documento';
import { Dinheiro } from '../../../domain/value-objects/Dinheiro';
import { PlacaVeiculo } from '../../../domain/value-objects/PlacaVeiculo';
import { Quantidade } from '../../../domain/value-objects/Quantidade';

export function makeCliente(): Cliente {
  return Cliente.criar('Cliente Teste', new Documento('52998224725'), 'PF');
}

export function makeVeiculo(clienteId: string): Veiculo {
  return Veiculo.criar(
    clienteId,
    new PlacaVeiculo('ABC1D23'),
    'VW',
    'Gol',
    2020,
  );
}

export function makeServico(
  nome = 'Alinhamento',
  valorCentavos = 15000,
): Servico {
  return Servico.criar(nome, `${nome} completo`, new Dinheiro(valorCentavos));
}

export function makePeca(
  nome = 'Filtro de oleo',
  valorCentavos = 5000,
  estoque = 10,
): Peca {
  return Peca.criar(nome, new Dinheiro(valorCentavos), estoque);
}

export function makeOrdemDiagnostico(
  clienteId: string,
  veiculoId: string,
): OrdemDeServico {
  const os = OrdemDeServico.criar(clienteId, veiculoId);
  os.iniciarDiagnostico();
  return os;
}

export function prepararFluxoAteAguardandoAprovacao(
  os: OrdemDeServico,
  servicoId: string,
  precoServicoCentavos = 15000,
): void {
  os.iniciarDiagnostico();
  os.adicionarServico(servicoId, new Dinheiro(precoServicoCentavos));
  os.gerarOrcamento();
  os.enviarOrcamentoParaAprovacao();
}

export function adicionarPecaNaOs(
  os: OrdemDeServico,
  pecaId: string,
  quantidade: number,
  precoCentavos: number,
): void {
  os.adicionarPeca(
    pecaId,
    new Quantidade(quantidade),
    new Dinheiro(precoCentavos),
  );
}
