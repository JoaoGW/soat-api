import { OrdemDeServico } from '../../src/domain/entities/OrdemDeServico';
import { PrismaService } from '../../src/infrastructure/database/PrismaService';

export async function limparBancoDeTeste(prisma: PrismaService) {
  // TRUNCATE is deliberately used instead of DELETE because HistoricoStatusOS
  // is protected by an append-only trigger in PostgreSQL.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "HistoricoStatusOS",
      "ItemOS",
      "ItemServicoOS",
      "OrdemDeServico",
      "Veiculo",
      "Cliente",
      "Servico",
      "Peca"
    RESTART IDENTITY;
  `);
}

export async function criarDependenciasParaOS(
  prisma: PrismaService,
  ordens: OrdemDeServico[],
): Promise<void> {
  const documentosPorCliente = new Map<string, string>();
  let proximoDocumento = 1;

  for (const os of ordens) {
    let documento = documentosPorCliente.get(os.clienteId);
    if (!documento) {
      documento = String(proximoDocumento++).padStart(11, '0');
      documentosPorCliente.set(os.clienteId, documento);
    }

    await prisma.cliente.upsert({
      where: { id: os.clienteId },
      create: {
        id: os.clienteId,
        nome: `Cliente ${os.clienteId}`,
        documento,
        tipo: 'PF',
        contato: 'teste@oficina.local',
      },
      update: {},
    });
    await prisma.veiculo.upsert({
      where: { id: os.veiculoId },
      create: {
        id: os.veiculoId,
        clienteId: os.clienteId,
        placa: `placa-${os.veiculoId}`,
        marca: 'Marca teste',
        modelo: 'Modelo teste',
        ano: 2026,
      },
      update: {},
    });
    for (const servico of os.servicos) {
      await prisma.servico.upsert({
        where: { id: servico.servicoId },
        create: {
          id: servico.servicoId,
          nome: `Servico ${servico.servicoId}`,
          descricao: 'Servico criado para fixture',
          preco: servico.preco.centavos,
        },
        update: {},
      });
    }
    for (const item of os.itens) {
      await prisma.peca.upsert({
        where: { id: item.pecaId },
        create: {
          id: item.pecaId,
          nome: `Peca ${item.pecaId}`,
          preco: item.precoUnitario.centavos,
          quantidadeEstoque: 100,
        },
        update: {},
      });
    }
  }
}
