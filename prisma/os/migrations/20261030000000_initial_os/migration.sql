-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "contato" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Veiculo" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Veiculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdemDeServico" (
    "id" TEXT NOT NULL,
    "codigoAcompanhamento" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "quoteId" TEXT,
    "quoteVersion" INTEGER,
    "executionId" TEXT,
    "dataInicioExecucao" TIMESTAMP(3),
    "dataFinalizacao" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrdemDeServico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricoStatusOS" (
    "id" TEXT NOT NULL,
    "osId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricoStatusOS_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SagaInstance" (
    "id" TEXT NOT NULL,
    "osId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "flowVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "quoteId" TEXT,
    "quoteVersion" INTEGER,
    "reservationId" TEXT,
    "chargeId" TEXT,
    "executionId" TEXT,
    "deadlineAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "lastError" TEXT,
    "requiresAttention" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SagaInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SagaOperation" (
    "operationId" TEXT NOT NULL,
    "sagaId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "businessAttempt" INTEGER NOT NULL,
    "commandType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "compensation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SagaOperation_pkey" PRIMARY KEY ("operationId")
);

-- CreateTable
CREATE TABLE "Inbox" (
    "consumer" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "Inbox_pkey" PRIMARY KEY ("consumer","messageId")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimUntil" TIMESTAMP(3),
    "claimOwner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("messageId")
);

-- CreateTable
CREATE TABLE "IdempotencyRequest" (
    "actorId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRequest_pkey" PRIMARY KEY ("actorId","route","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_documento_key" ON "Cliente"("documento");

-- CreateIndex
CREATE UNIQUE INDEX "Veiculo_placa_key" ON "Veiculo"("placa");

-- CreateIndex
CREATE INDEX "Veiculo_clienteId_idx" ON "Veiculo"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "OrdemDeServico_codigoAcompanhamento_key" ON "OrdemDeServico"("codigoAcompanhamento");

-- CreateIndex
CREATE INDEX "OrdemDeServico_clienteId_idx" ON "OrdemDeServico"("clienteId");

-- CreateIndex
CREATE INDEX "OrdemDeServico_filialId_status_idx" ON "OrdemDeServico"("filialId", "status");

-- CreateIndex
CREATE INDEX "OrdemDeServico_veiculoId_idx" ON "OrdemDeServico"("veiculoId");

-- CreateIndex
CREATE INDEX "HistoricoStatusOS_osId_ocorridoEm_idx" ON "HistoricoStatusOS"("osId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "HistoricoStatusOS_status_idx" ON "HistoricoStatusOS"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SagaInstance_osId_key" ON "SagaInstance"("osId");

-- CreateIndex
CREATE INDEX "SagaInstance_status_deadlineAt_idx" ON "SagaInstance"("status", "deadlineAt");

-- CreateIndex
CREATE INDEX "SagaInstance_leaseUntil_idx" ON "SagaInstance"("leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "SagaOperation_sagaId_step_businessAttempt_key" ON "SagaOperation"("sagaId", "step", "businessAttempt");

-- CreateIndex
CREATE INDEX "Inbox_status_receivedAt_idx" ON "Inbox"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "Inbox_operationId_idx" ON "Inbox"("operationId");

-- CreateIndex
CREATE INDEX "Outbox_status_nextAttemptAt_idx" ON "Outbox"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "Veiculo" ADD CONSTRAINT "Veiculo_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdemDeServico" ADD CONSTRAINT "OrdemDeServico_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdemDeServico" ADD CONSTRAINT "OrdemDeServico_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "Veiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoStatusOS" ADD CONSTRAINT "HistoricoStatusOS_osId_fkey" FOREIGN KEY ("osId") REFERENCES "OrdemDeServico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SagaInstance" ADD CONSTRAINT "SagaInstance_osId_fkey" FOREIGN KEY ("osId") REFERENCES "OrdemDeServico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SagaOperation" ADD CONSTRAINT "SagaOperation_sagaId_fkey" FOREIGN KEY ("sagaId") REFERENCES "SagaInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_documento_normalizado_formato_check"
CHECK (("tipo" = 'PF' AND "documento" ~ '^[0-9]{11}$') OR ("tipo" = 'PJ' AND "documento" ~ '^[0-9]{14}$'));

CREATE FUNCTION "bloquear_alteracao_historico_status_os"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'HistoricoStatusOS is append-only; UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HistoricoStatusOS_append_only"
BEFORE UPDATE OR DELETE ON "HistoricoStatusOS"
FOR EACH ROW EXECUTE FUNCTION "bloquear_alteracao_historico_status_os"();

