-- This migration is intentionally separate from the Phase 3 base migration.
-- A migration that may already have reached an environment is never rewritten.

-- Pre-flight validation: application writes normalize CPF/CNPJ, but legacy
-- rows may have been inserted outside the domain layer. Do not alter them
-- automatically: stop the deployment so they can be corrected explicitly.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Cliente"
        WHERE NOT (
            ("tipo" = 'PF' AND "documento" ~ '^[0-9]{11}$')
            OR
            ("tipo" = 'PJ' AND "documento" ~ '^[0-9]{14}$')
        )
    ) THEN
        RAISE EXCEPTION
            'Migration aborted: Cliente.documento must be normalized (11 digits for PF or 14 digits for PJ). Correct legacy data manually before deploying.';
    END IF;
END $$;

-- Existing Cliente_documento_key guarantees uniqueness once every value is
-- normalized. This constraint prevents future writes outside the application
-- from reintroducing formatted or malformed documents.
ALTER TABLE "Cliente"
    ADD CONSTRAINT "Cliente_documento_normalizado_formato_check"
    CHECK (
        ("tipo" = 'PF' AND "documento" ~ '^[0-9]{11}$')
        OR
        ("tipo" = 'PJ' AND "documento" ~ '^[0-9]{14}$')
    );

-- Status history is an audit trail. It may receive new entries, but events
-- already recorded cannot be modified or removed through ordinary DML.
CREATE OR REPLACE FUNCTION "bloquear_alteracao_historico_status_os"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'HistoricoStatusOS is append-only; UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HistoricoStatusOS_append_only"
BEFORE UPDATE OR DELETE ON "HistoricoStatusOS"
FOR EACH ROW
EXECUTE FUNCTION "bloquear_alteracao_historico_status_os"();
