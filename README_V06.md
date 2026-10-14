# Repost Studio V0.6

Arquitetura inicial hibrida:

- Vercel: interface Next.js e APIs privadas.
- Supabase: PostgreSQL + bucket privado `videos`.
- Agente local: Playwright + yt-dlp + upload por URL assinada.
- Render: nao utilizado nesta etapa.

## Variaveis de servidor

Ja existentes:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Adicionar:

- `REPOST_STUDIO_ACCESS_KEY`

A mesma `REPOST_STUDIO_ACCESS_KEY` e digitada uma vez no navegador e cadastrada no Agente Local. Ela NAO e uma chave do Supabase.

## Fluxo

1. No painel online, abra Origens e cadastre a URL do perfil.
2. Clique em Sincronizar.
3. O painel cria um registro `sync_jobs` com status `pending`.
4. O agente local detecta a tarefa.
5. Playwright abre o TikTok. Resolva CAPTCHA/idade caso apareca.
6. O agente coleta URLs publicas, baixa MP4 com yt-dlp e solicita URLs de upload temporarias a Vercel.
7. O arquivo vai diretamente do PC ao Supabase Storage.
8. A biblioteca online atualiza automaticamente.
9. Cadastre contas, dias e horarios e gere a agenda online.

## Seguranca

- `SUPABASE_SERVICE_ROLE_KEY` fica apenas em `.env.local` e nas variaveis protegidas da Vercel.
- O agente nao recebe a chave secreta do Supabase.
- O bucket `videos` continua privado.
- O navegador recebe apenas URLs assinadas temporarias para visualizar um video.
- O painel exige `REPOST_STUDIO_ACCESS_KEY` em todas as APIs V0.6.

## Estado da publicacao automatica

A V0.6 organiza as contas e a agenda, mas ainda nao publica automaticamente no TikTok. Essa etapa deve ser conectada depois por autorizacao adequada das contas.
