# Repost Studio V0.7

## O que esta versao adiciona

A V0.7 mantem a coleta local da V0.6 e adiciona a camada de publicacao online:

- conexao de cada conta de publicacao ao TikTok por OAuth;
- tokens TikTok criptografados antes de serem gravados no Supabase;
- tela de revisao obrigatoria antes de cada postagem;
- escolha manual de privacidade;
- comentarios, dueto e stitch desligados por padrao;
- declaracao de conteudo comercial e conteudo gerado por IA;
- confirmacao de direitos/permissao e consentimento antes do envio;
- verificacao da duracao do MP4 contra o limite retornado pelo TikTok;
- publicador online chamado pelo Supabase Cron a cada minuto;
- consulta automatica do status da publicacao;
- exclusao do MP4 do Storage quando nao houver mais nenhum uso pendente/falho desse video;
- indicador de uso de Storage no Dashboard;
- bloqueio de nova sincronizacao a partir de 85% do limite configurado e bloqueio de upload ao atingir o limite.

O agente local continua sendo necessario somente para coletar os perfis e enviar os MP4 para a nuvem. Depois disso, o computador pode ficar desligado.

## 1. Banco de dados

Antes de instalar o codigo, execute no SQL Editor do Supabase:

`SUPABASE_V07.sql`

Os agendamentos que ja existiam na V0.6 continuam no banco, mas voltam a exigir revisao/autorizacao antes de poderem ser publicados.

## 2. Variaveis novas na Vercel

As variaveis da V0.6 continuam:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REPOST_STUDIO_ACCESS_KEY`

Adicione tambem:

- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `TIKTOK_REDIRECT_URI=https://repost-studio.vercel.app/api/tiktok/callback`
- `TIKTOK_TOKEN_ENCRYPTION_KEY` - 64 caracteres hexadecimais
- `TIKTOK_MEDIA_BASE_URL=https://repost-studio.vercel.app/api/tiktok/media`
- `PUBLISH_CRON_SECRET`
- `SUPABASE_STORAGE_SOFT_LIMIT_BYTES=1000000000`
- `TIKTOK_CLIENT_AUDITED=false`

Depois da verificacao de URL do TikTok, adicione tambem:

- `TIKTOK_URL_VERIFY_FILENAME`
- `TIKTOK_URL_VERIFY_CONTENT`

Nao use `NEXT_PUBLIC_` em nenhuma chave secreta.

### Gerar os dois segredos no PowerShell

Chave de criptografia dos tokens:

```powershell
([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
```

Segredo do Cron:

```powershell
[guid]::NewGuid().ToString("N")
```

Nao envie os valores para chat e nao coloque no GitHub.

## 3. Aplicativo no TikTok for Developers

Para o botao `Conectar TikTok` funcionar, e necessario criar/configurar um aplicativo no TikTok for Developers.

Configure o aplicativo Web com:

- Login Kit / autorizacao Web;
- Content Posting API;
- Direct Post habilitado;
- escopo `video.publish` solicitado/aprovado;
- Redirect URI exatamente igual a:
  `https://repost-studio.vercel.app/api/tiktok/callback`

Use o Client Key e Client Secret fornecidos pelo TikTok nas variaveis da Vercel.

## 4. Verificar o prefixo dos videos

A V0.7 usa `PULL_FROM_URL`, porque os MP4 ja estao no servidor. O TikTok exige que o dominio ou prefixo usado para os videos seja verificado.

No TikTok for Developers, em URL Properties, verifique este prefixo:

`https://repost-studio.vercel.app/api/tiktok/media/`

O TikTok fornecera um arquivo de assinatura. Pegue:

- o nome exato do arquivo -> `TIKTOK_URL_VERIFY_FILENAME`
- o conteudo exato do arquivo -> `TIKTOK_URL_VERIFY_CONTENT`

Depois de cadastrar essas duas variaveis na Vercel e fazer Redeploy, o Repost Studio passa a servir automaticamente esse arquivo em:

`https://repost-studio.vercel.app/api/tiktok/media/NOME_DO_ARQUIVO`

Conclua a verificacao no painel do TikTok.

## 5. Cron do publicador

Depois de publicar a V0.7 na Vercel e cadastrar `PUBLISH_CRON_SECRET`, abra `CONFIGURAR_CRON_V07.sql`.

Substitua somente:

`COLE_AQUI_A_PUBLISH_CRON_SECRET`

pelo mesmo segredo cadastrado na Vercel e execute o SQL uma unica vez no Supabase.

O Supabase chamara `/api/publish/cron` a cada minuto. O endpoint:

1. procura agendamentos vencidos e autorizados;
2. busca informacoes atuais da conta no TikTok;
3. inicia o Direct Post usando o MP4 online;
4. acompanha o `publish_id`;
5. marca Publicado ou Erro;
6. apaga o MP4 quando ele nao for mais necessario em nenhuma conta/agendamento pendente ou com erro.

## 6. Fluxo no Repost Studio

1. Sincronize os videos normalmente pelo agente local.
2. Cadastre a conta em `Contas`.
3. Clique `Conectar TikTok` e autorize o aplicativo.
4. Gere a agenda.
5. Na fila, abra `Revisar` em cada item.
6. Assista/valide o video, edite a legenda, escolha a privacidade e as interacoes.
7. Declare conteudo comercial/IA quando aplicavel.
8. Confirme direitos/permissao e consentimento.
9. Clique `Autorizar publicacao agendada`.
10. No horario, o Cron online cuida do envio mesmo com o PC desligado.

## Restricao importante do TikTok

Clientes Direct Post ainda nao auditados ficam limitados a testes privados (`SELF_ONLY`) e contas privadas. A V0.7 bloqueia outras privacidades enquanto `TIKTOK_CLIENT_AUDITED=false`.

Depois de uma auditoria aprovada pelo TikTok, mude na Vercel:

`TIKTOK_CLIENT_AUDITED=true`

O TikTok tambem declara nas diretrizes de Direct Post que o produto deve ser voltado a criadores autenticos/publico amplo e que ferramentas privadas apenas para contas da propria equipe, assim como copiar conteudo arbitrario, nao sao casos de uso aceitos para auditoria. Portanto, a publicacao publica totalmente automatica depende da aprovacao do aplicativo pelo TikTok e do uso de conteudo que voce tenha direito/permissao para publicar.

## Storage

O valor padrao de `SUPABASE_STORAGE_SOFT_LIMIT_BYTES` e 1.000.000.000 bytes.

- com 85% ou mais, o painel bloqueia novas sincronizacoes;
- se um novo MP4 ultrapassaria o limite, o agente nao recebe autorizacao de upload;
- depois da publicacao concluida, o arquivo e apagado quando nao houver outros usos pendentes ou com erro.

Isso faz o bucket funcionar como uma fila temporaria, em vez de um arquivo permanente.
