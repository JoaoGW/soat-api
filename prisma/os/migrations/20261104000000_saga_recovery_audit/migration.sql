CREATE TABLE "SagaRecoveryAudit" (
  "id" TEXT NOT NULL,
  "sagaId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SagaRecoveryAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SagaRecoveryAudit_sagaId_createdAt_idx" ON "SagaRecoveryAudit"("sagaId", "createdAt");
