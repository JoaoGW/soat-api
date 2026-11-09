#!/bin/sh
set -eu
# O banco da Saga (Fase 4) é separado do banco legado do OS.
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE DATABASE os_saga"
