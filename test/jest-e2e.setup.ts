import * as dotenv from 'dotenv';

dotenv.config({
  path: '.env.test',
  quiet: true,
});

// Os e2e das Fases 1–3 exercitam as rotas legadas, desligadas por padrão na Fase 4.
process.env.ENABLE_LEGACY_OFICINA ??= 'true';
