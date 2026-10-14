-- =========================================================
-- REPOST STUDIO V0.7 - CRON DO PUBLICADOR
-- Rode SOMENTE depois que a V0.7 estiver publicada na Vercel e
-- PUBLISH_CRON_SECRET estiver configurado nos dois lados.
--
-- IMPORTANTE: substitua SOMENTE o valor indicado abaixo antes de executar.
-- Nao envie essa chave para chats, GitHub ou arquivos versionados.
-- =========================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- URL publica do endpoint do publicador.
select vault.create_secret(
  'https://repost-studio.vercel.app/api/publish/cron',
  'repost_publish_url',
  'Endpoint Vercel do publicador Repost Studio'
);

-- TROQUE o texto abaixo pela MESMA PUBLISH_CRON_SECRET cadastrada na Vercel.
select vault.create_secret(
  'COLE_AQUI_A_PUBLISH_CRON_SECRET',
  'repost_publish_secret',
  'Segredo usado pelo Supabase Cron para chamar o publicador'
);

-- A cada minuto: verifica publicacoes em processamento e inicia itens vencidos.
select cron.schedule(
  'repost-studio-publisher-v07',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'repost_publish_url'
      order by created_at desc
      limit 1
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-publish-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'repost_publish_secret'
        order by created_at desc
        limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) as request_id;
  $$
);

-- Para conferir se foi criado:
select jobid, jobname, schedule, active
from cron.job
where jobname = 'repost-studio-publisher-v07';
