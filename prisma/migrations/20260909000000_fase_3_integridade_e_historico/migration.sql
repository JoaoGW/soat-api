-- Additive migration for Fase 3. It intentionally performs no data cleanup.
-- Existing orphan rows, duplicated normalized documents, or invalid references
-- must be corrected explicitly before this migration is applied.

-- CreateTable
CREATE TABLE "HistoricoStatusOS" (
    "id" TEXT NOT NULL,
    "osId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricoStatusOS_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Veiculo_clienteId_idx" ON "Veiculo"("clienteId");

-- CreateIndex
CREATE INDEX "OrdemDeServico_clienteId_idx" ON "OrdemDeServico"("clienteId");

-- CreateIndex
CREATE INDEX "OrdemDeServico_status_idx" ON "OrdemDeServico"("status");

-- CreateIndex
CREATE INDEX "OrdemDeServico_veiculoId_idx" ON "OrdemDeServico"("veiculoId");

-- CreateIndex
CREATE INDEX "ItemOS_osId_idx" ON "ItemOS"("osId");

-- CreateIndex
CREATE INDEX "ItemOS_pecaId_idx" ON "ItemOS"("pecaId");

-- CreateIndex
CREATE INDEX "ItemServicoOS_osId_idx" ON "ItemServicoOS"("osId");

-- CreateIndex
CREATE INDEX "ItemServicoOS_servicoId_idx" ON "ItemServicoOS"("servicoId");

-- CreateIndex
CREATE INDEX "HistoricoStatusOS_osId_ocorridoEm_idx" ON "HistoricoStatusOS"("osId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "HistoricoStatusOS_status_idx" ON "HistoricoStatusOS"("status");

-- AddForeignKey
ALTER TABLE "OrdemDeServico" ADD CONSTRAINT "OrdemDeServico_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdemDeServico" ADD CONSTRAINT "OrdemDeServico_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "Veiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemOS" ADD CONSTRAINT "ItemOS_pecaId_fkey" FOREIGN KEY ("pecaId") REFERENCES "Peca"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemServicoOS" ADD CONSTRAINT "ItemServicoOS_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "Servico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoStatusOS" ADD CONSTRAINT "HistoricoStatusOS_osId_fkey" FOREIGN KEY ("osId") REFERENCES "OrdemDeServico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
