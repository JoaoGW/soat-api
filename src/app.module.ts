import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './infrastructure/config/env.validation';
import {
  NOTIFICACAO_PORT,
  ORCAMENTO_WEBHOOK_TOKEN_PORT,
} from './application/ports/output/PortTokens';
import { BuscarOrdemDeServicoPorIdUseCase } from './application/use-cases/ordem-servico/BuscarOrdemDeServicoPorIdUseCase';
import { ListarOrdensDeServicoUseCase } from './application/use-cases/ordem-servico/ListarOrdensDeServicoUseCase';
import { CriarOrdemDeServicoUseCase } from './application/use-cases/CriarOrdemDeServicoUseCase';
import { IniciarDiagnosticoUseCase } from './application/use-cases/IniciarDiagnosticoUseCase';
import { AdicionarServicoOSUseCase } from './application/use-cases/AdicionarServicoOSUseCase';
import { AdicionarPecaOSUseCase } from './application/use-cases/AdicionarPecaOSUseCase';
import { GerarOrcamentoUseCase } from './application/use-cases/GerarOrcamentoUseCase';
import { EnviarOrcamentoParaAprovacaoUseCase } from './application/use-cases/EnviarOrcamentoParaAprovacaoUseCase';
import { AprovarOrcamentoUseCase } from './application/use-cases/AprovarOrcamentoUseCase';
import { RecusarOrcamentoUseCase } from './application/use-cases/RecusarOrcamentoUseCase';
import { IniciarExecucaoUseCase } from './application/use-cases/IniciarExecucaoUseCase';
import { FinalizarServicoUseCase } from './application/use-cases/FinalizarServicoUseCase';
import { EntregarVeiculoUseCase } from './application/use-cases/EntregarVeiculoUseCase';
import { AjustarEstoqueUseCase } from './application/use-cases/peca/AjustarEstoqueUseCase';
import { AtualizarPecaUseCase } from './application/use-cases/peca/AtualizarPecaUseCase';
import { BuscarPecaPorIdUseCase } from './application/use-cases/peca/BuscarPecaPorIdUseCase';
import { CriarPecaUseCase } from './application/use-cases/peca/CriarPecaUseCase';
import { ListarPecasUseCase } from './application/use-cases/peca/ListarPecasUseCase';
import { RemoverPecaUseCase } from './application/use-cases/peca/RemoverPecaUseCase';
import { AtualizarServicoUseCase } from './application/use-cases/servico/AtualizarServicoUseCase';
import { BuscarServicoPorIdUseCase } from './application/use-cases/servico/BuscarServicoPorIdUseCase';
import { CriarServicoUseCase } from './application/use-cases/servico/CriarServicoUseCase';
import { ListarServicosUseCase } from './application/use-cases/servico/ListarServicosUseCase';
import { RemoverServicoUseCase } from './application/use-cases/servico/RemoverServicoUseCase';
import { AtualizarVeiculoUseCase } from './application/use-cases/veiculo/AtualizarVeiculoUseCase';
import { BuscarVeiculoPorIdUseCase } from './application/use-cases/veiculo/BuscarVeiculoPorIdUseCase';
import { CriarVeiculoUseCase } from './application/use-cases/veiculo/CriarVeiculoUseCase';
import { ListarVeiculosPorClienteUseCase } from './application/use-cases/veiculo/ListarVeiculosPorClienteUseCase';
import { ListarVeiculosUseCase } from './application/use-cases/veiculo/ListarVeiculosUseCase';
import { RemoverVeiculoUseCase } from './application/use-cases/veiculo/RemoverVeiculoUseCase';
import { AtualizarClienteUseCase } from './application/use-cases/cliente/AtualizarClienteUseCase';
import { BuscarClientePorDocumentoUseCase } from './application/use-cases/cliente/BuscarClientePorDocumentoUseCase';
import { BuscarClientePorIdUseCase } from './application/use-cases/cliente/BuscarClientePorIdUseCase';
import { CriarClienteUseCase } from './application/use-cases/cliente/CriarClienteUseCase';
import { ListarClientesUseCase } from './application/use-cases/cliente/ListarClientesUseCase';
import { RemoverClienteUseCase } from './application/use-cases/cliente/RemoverClienteUseCase';
import { PrismaClienteRepository } from './infrastructure/repositories/PrismaClienteRepository';
import { PrismaOrdemDeServicoRepository } from './infrastructure/repositories/PrismaOrdemDeServicoRepository';
import { PrismaPecaRepository } from './infrastructure/repositories/PrismaPecaRepository';
import { PrismaServicoRepository } from './infrastructure/repositories/PrismaServicoRepository';
import { PrismaVeiculoRepository } from './infrastructure/repositories/PrismaVeiculoRepository';
import { EmailAdapter } from './infrastructure/adapters/email/EmailAdapter';
import { JwtOrcamentoWebhookTokenAdapter } from './infrastructure/adapters/webhook/JwtOrcamentoWebhookTokenAdapter';
import { ClienteController } from './interfaces/controllers/admin/ClienteController';
import { OrdemDeServicoController } from './interfaces/controllers/admin/OrdemDeServicoController';
import { PecaController } from './interfaces/controllers/admin/PecaController';
import { ServicoController } from './interfaces/controllers/admin/ServicoController';
import { VeiculoController } from './interfaces/controllers/admin/VeiculoController';
import { JwtAuthGuard } from './interfaces/guards/JwtAuthGuard';
import { AuthModule } from './modules/auth.module';
import { PublicoModule } from './modules/publico.module';
import { RelatorioModule } from './modules/relatorio.module';
import { RepositoryModule } from './modules/repository.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    RepositoryModule,
    AuthModule,
    PublicoModule,
    RelatorioModule,
  ],
  controllers: [
    AppController,
    ClienteController,
    VeiculoController,
    ServicoController,
    PecaController,
    OrdemDeServicoController,
  ],
  providers: [
    AppService,
    JwtAuthGuard,
    EmailAdapter,
    JwtOrcamentoWebhookTokenAdapter,
    {
      provide: NOTIFICACAO_PORT,
      useExisting: EmailAdapter,
    },
    {
      provide: ORCAMENTO_WEBHOOK_TOKEN_PORT,
      useExisting: JwtOrcamentoWebhookTokenAdapter,
    },
    {
      provide: CriarClienteUseCase,
      useFactory: (repo: PrismaClienteRepository) =>
        new CriarClienteUseCase(repo),
      inject: [PrismaClienteRepository],
    },
    {
      provide: BuscarClientePorIdUseCase,
      useFactory: (repo: PrismaClienteRepository) =>
        new BuscarClientePorIdUseCase(repo),
      inject: [PrismaClienteRepository],
    },
    {
      provide: BuscarClientePorDocumentoUseCase,
      useFactory: (repo: PrismaClienteRepository) =>
        new BuscarClientePorDocumentoUseCase(repo),
      inject: [PrismaClienteRepository],
    },
    {
      provide: ListarClientesUseCase,
      useFactory: (repo: PrismaClienteRepository) =>
        new ListarClientesUseCase(repo),
      inject: [PrismaClienteRepository],
    },
    {
      provide: AtualizarClienteUseCase,
      useFactory: (repo: PrismaClienteRepository) =>
        new AtualizarClienteUseCase(repo),
      inject: [PrismaClienteRepository],
    },
    {
      provide: RemoverClienteUseCase,
      useFactory: (repo: PrismaClienteRepository) =>
        new RemoverClienteUseCase(repo),
      inject: [PrismaClienteRepository],
    },
    {
      provide: CriarVeiculoUseCase,
      useFactory: (
        veiculoRepo: PrismaVeiculoRepository,
        clienteRepo: PrismaClienteRepository,
      ) => new CriarVeiculoUseCase(veiculoRepo, clienteRepo),
      inject: [PrismaVeiculoRepository, PrismaClienteRepository],
    },
    {
      provide: BuscarVeiculoPorIdUseCase,
      useFactory: (repo: PrismaVeiculoRepository) =>
        new BuscarVeiculoPorIdUseCase(repo),
      inject: [PrismaVeiculoRepository],
    },
    {
      provide: ListarVeiculosUseCase,
      useFactory: (repo: PrismaVeiculoRepository) =>
        new ListarVeiculosUseCase(repo),
      inject: [PrismaVeiculoRepository],
    },
    {
      provide: ListarVeiculosPorClienteUseCase,
      useFactory: (repo: PrismaVeiculoRepository) =>
        new ListarVeiculosPorClienteUseCase(repo),
      inject: [PrismaVeiculoRepository],
    },
    {
      provide: AtualizarVeiculoUseCase,
      useFactory: (repo: PrismaVeiculoRepository) =>
        new AtualizarVeiculoUseCase(repo),
      inject: [PrismaVeiculoRepository],
    },
    {
      provide: RemoverVeiculoUseCase,
      useFactory: (repo: PrismaVeiculoRepository) =>
        new RemoverVeiculoUseCase(repo),
      inject: [PrismaVeiculoRepository],
    },
    {
      provide: CriarServicoUseCase,
      useFactory: (repo: PrismaServicoRepository) =>
        new CriarServicoUseCase(repo),
      inject: [PrismaServicoRepository],
    },
    {
      provide: BuscarServicoPorIdUseCase,
      useFactory: (repo: PrismaServicoRepository) =>
        new BuscarServicoPorIdUseCase(repo),
      inject: [PrismaServicoRepository],
    },
    {
      provide: ListarServicosUseCase,
      useFactory: (repo: PrismaServicoRepository) =>
        new ListarServicosUseCase(repo),
      inject: [PrismaServicoRepository],
    },
    {
      provide: AtualizarServicoUseCase,
      useFactory: (repo: PrismaServicoRepository) =>
        new AtualizarServicoUseCase(repo),
      inject: [PrismaServicoRepository],
    },
    {
      provide: RemoverServicoUseCase,
      useFactory: (
        servicoRepo: PrismaServicoRepository,
        osRepo: PrismaOrdemDeServicoRepository,
      ) => new RemoverServicoUseCase(servicoRepo, osRepo),
      inject: [PrismaServicoRepository, PrismaOrdemDeServicoRepository],
    },
    {
      provide: CriarPecaUseCase,
      useFactory: (repo: PrismaPecaRepository) => new CriarPecaUseCase(repo),
      inject: [PrismaPecaRepository],
    },
    {
      provide: BuscarPecaPorIdUseCase,
      useFactory: (repo: PrismaPecaRepository) =>
        new BuscarPecaPorIdUseCase(repo),
      inject: [PrismaPecaRepository],
    },
    {
      provide: ListarPecasUseCase,
      useFactory: (repo: PrismaPecaRepository) => new ListarPecasUseCase(repo),
      inject: [PrismaPecaRepository],
    },
    {
      provide: AtualizarPecaUseCase,
      useFactory: (repo: PrismaPecaRepository) =>
        new AtualizarPecaUseCase(repo),
      inject: [PrismaPecaRepository],
    },
    {
      provide: AjustarEstoqueUseCase,
      useFactory: (repo: PrismaPecaRepository) =>
        new AjustarEstoqueUseCase(repo),
      inject: [PrismaPecaRepository],
    },
    {
      provide: RemoverPecaUseCase,
      useFactory: (
        pecaRepo: PrismaPecaRepository,
        osRepo: PrismaOrdemDeServicoRepository,
      ) => new RemoverPecaUseCase(pecaRepo, osRepo),
      inject: [PrismaPecaRepository, PrismaOrdemDeServicoRepository],
    },
    {
      provide: ListarOrdensDeServicoUseCase,
      useFactory: (repo: PrismaOrdemDeServicoRepository) =>
        new ListarOrdensDeServicoUseCase(repo),
      inject: [PrismaOrdemDeServicoRepository],
    },
    {
      provide: BuscarOrdemDeServicoPorIdUseCase,
      useFactory: (repo: PrismaOrdemDeServicoRepository) =>
        new BuscarOrdemDeServicoPorIdUseCase(repo),
      inject: [PrismaOrdemDeServicoRepository],
    },
    {
      provide: CriarOrdemDeServicoUseCase,
      useFactory: (
        osRepo: PrismaOrdemDeServicoRepository,
        clienteRepo: PrismaClienteRepository,
        veiculoRepo: PrismaVeiculoRepository,
        servicoRepo: PrismaServicoRepository,
        pecaRepo: PrismaPecaRepository,
      ) =>
        new CriarOrdemDeServicoUseCase(
          osRepo,
          clienteRepo,
          veiculoRepo,
          servicoRepo,
          pecaRepo,
        ),
      inject: [
        PrismaOrdemDeServicoRepository,
        PrismaClienteRepository,
        PrismaVeiculoRepository,
        PrismaServicoRepository,
        PrismaPecaRepository,
      ],
    },
    {
      provide: IniciarDiagnosticoUseCase,
      useFactory: (osRepo: PrismaOrdemDeServicoRepository) =>
        new IniciarDiagnosticoUseCase(osRepo),
      inject: [PrismaOrdemDeServicoRepository],
    },
    {
      provide: AdicionarServicoOSUseCase,
      useFactory: (
        osRepo: PrismaOrdemDeServicoRepository,
        servicoRepo: PrismaServicoRepository,
      ) => new AdicionarServicoOSUseCase(osRepo, servicoRepo),
      inject: [PrismaOrdemDeServicoRepository, PrismaServicoRepository],
    },
    {
      provide: AdicionarPecaOSUseCase,
      useFactory: (
        osRepo: PrismaOrdemDeServicoRepository,
        pecaRepo: PrismaPecaRepository,
      ) => new AdicionarPecaOSUseCase(osRepo, pecaRepo),
      inject: [PrismaOrdemDeServicoRepository, PrismaPecaRepository],
    },
    {
      provide: GerarOrcamentoUseCase,
      useFactory: (osRepo: PrismaOrdemDeServicoRepository) =>
        new GerarOrcamentoUseCase(osRepo),
      inject: [PrismaOrdemDeServicoRepository],
    },
    {
      provide: EnviarOrcamentoParaAprovacaoUseCase,
      useFactory: (
        osRepo: PrismaOrdemDeServicoRepository,
        clienteRepo: PrismaClienteRepository,
        notificacao: EmailAdapter,
        webhookTokens: JwtOrcamentoWebhookTokenAdapter,
      ) =>
        new EnviarOrcamentoParaAprovacaoUseCase(
          osRepo,
          clienteRepo,
          notificacao,
          webhookTokens,
        ),
      inject: [
        PrismaOrdemDeServicoRepository,
        PrismaClienteRepository,
        NOTIFICACAO_PORT,
        ORCAMENTO_WEBHOOK_TOKEN_PORT,
      ],
    },
    {
      provide: AprovarOrcamentoUseCase,
      useFactory: (osRepo: PrismaOrdemDeServicoRepository) =>
        new AprovarOrcamentoUseCase(osRepo),
      inject: [PrismaOrdemDeServicoRepository],
    },
    {
      provide: RecusarOrcamentoUseCase,
      useFactory: (osRepo: PrismaOrdemDeServicoRepository) =>
        new RecusarOrcamentoUseCase(osRepo),
      inject: [PrismaOrdemDeServicoRepository],
    },
    {
      provide: IniciarExecucaoUseCase,
      useFactory: (
        osRepo: PrismaOrdemDeServicoRepository,
        pecaRepo: PrismaPecaRepository,
      ) => new IniciarExecucaoUseCase(osRepo, pecaRepo),
      inject: [PrismaOrdemDeServicoRepository, PrismaPecaRepository],
    },
    {
      provide: FinalizarServicoUseCase,
      useFactory: (osRepo: PrismaOrdemDeServicoRepository) =>
        new FinalizarServicoUseCase(osRepo),
      inject: [PrismaOrdemDeServicoRepository],
    },
    {
      provide: EntregarVeiculoUseCase,
      useFactory: (osRepo: PrismaOrdemDeServicoRepository) =>
        new EntregarVeiculoUseCase(osRepo),
      inject: [PrismaOrdemDeServicoRepository],
    },
  ],
})
export class AppModule {}
