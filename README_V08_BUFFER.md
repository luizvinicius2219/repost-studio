# Repost Studio V0.8 - Buffer
A publicacao no TikTok sera feita pelo Buffer. O PC so precisa ficar ligado para coletar novos videos.

## Configuracao
1. No Supabase SQL Editor, execute SUPABASE_V08.sql. Nao apaga contas ou videos.
2. No Buffer, conecte sua conta TikTok e obtenha uma Personal API Key com acesso a canais e posts.
3. Na Vercel, configure as variaveis privadas `BUFFER_API_KEY` e `PUBLISH_PROVIDER=buffer`. Nunca coloque valores reais no GitHub.
4. Faca Redeploy na Vercel. Abra Contas > Integracao Buffer > Buscar canais e vincule o canal TikTok correto.
5. Na Agenda, selecione UM video para teste, em um horario ao menos 5 minutos no futuro e ate 27 dias, e clique Enviar ao Buffer.
6. No Buffer, confirme que apareceu como Automatic (se aparecer Notification, a publicacao exige uma acao manual). O TikTok/Buffer pode limitar musicas/efeitos.
7. Consulte o status pelo botao Atualizar status do Buffer. Somente apos Buffer retornar sent o MP4 pode ser limpo.
8. O cron antigo da V0.7 pode chamar o endpoint /api/publish/cron com PUBLISH_CRON_SECRET configurado; com PUBLISH_PROVIDER=buffer esse endpoint so consulta status.

## Cuidados
- Nao envie todos os videos antes de validar 1 postagem real.
- Para prevenir duplicidades, erros incertos nao fazem retry automatico: confira no Buffer.
- O bucket do Supabase fica privado, com URL assinada de acesso ao video.
- Se faltarem os campos da migracao, o modo Buffer retornara erro ate que o SQL seja aplicado.
- Nao marque como publicada uma postagem por conta propria, antes do status confirmado.
- Use somente materiais que voce possui ou tem autorizacao para publicar.
