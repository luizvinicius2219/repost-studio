# Repost Studio v0.3 - MVP de uso pessoal

Atualizacao incrementa o front-end Next.js ja existente em `C:\repost-studio\frontend`.
Nao contem credenciais, banco de dados nem alteracoes em `package.json`.

## Entregue nesta versao

- Cadastro de perfil TikTok por URL, com persistencia no navegador (`localStorage`).
- Tentativa de catalogacao real de metadados visiveis em pagina publica, com status parcial/bloqueado e historico.
- Adicao de links de videos individuais via TikTok oEmbed (com fallback nao verificado).
- Importacao de pastas e de multiplos arquivos MP4 no navegador (`IndexedDB`).
- Deteccao de duplicidade de arquivos por SHA-256, limite de 250 MB por arquivo.
- Pre-visualizacao de MP4, download local e remocao.
- Geracao de agenda local por data, horarios e quantidade; cancelamento de itens.
- Dashboard com contagens reais e exportacao de metadados JSON.

## Limites importantes

- **Sem postagem automatica.** Agendamentos sao apenas um planejamento de fila, mesmo apos o horario passar.
- **Sem varredura completa garantida.** O TikTok pode bloquear a pagina ou omitir a lista de videos. O scanner examina apenas o HTML publico acessivel no momento, sem paginacao e sem baixar MP4.
- **Sem backup de MP4 pela opcao Exportar.** O JSON contem somente os metadados; mantenha os originais dos arquivos em sua pasta.
- **Dados nao sincronizados.** Cada navegador/dispositivo tem sua propria biblioteca e agenda. Alterar de computador nao transfere os arquivos.
- **Nao e SaaS ainda.** Faltam autenticacao, persistencia central por usuario, upload em nuvem e aprovacao da API oficial para posts.
- **Nao use com acesso publico irrestrito em ambiente de producao.** Ligue Deployment Protection na Vercel enquanto nao houver login; o endpoint de consulta tem apenas um controle de frequencia por instancia, insuficiente contra abuso distribuido.
- Use somente arquivos e conteudos que voce pode legalmente republicar.

## Instalacao sem edicao manual

1. Confirme que sua pasta atual e `C:\repost-studio\frontend` e esta versionada pelo Git.
2. Faca backup dos arquivos locais nao commitados, se houver.
3. Baixe `Repost-Studio-V03.zip` para a pasta Downloads.
4. No PowerShell, feche quaisquer comandos executados fora da pasta de projeto e rode:

```powershell
cd C:\repost-studio\frontend
Expand-Archive -LiteralPath "$HOME\Downloads\Repost-Studio-V03.zip" -DestinationPath . -Force
npm run build
```

5. Se a compilacao tiver sucesso, envie ao GitHub:

```powershell
git status
git add src README_V03.md
git commit -m "Repost Studio v0.3 - scanner catalogo biblioteca e agenda"
git push origin main
```

O arquivo `.env.local` nao e necessario para estas telas; ele nao sera sobrescrito pelo ZIP.

## Primeiro teste na Vercel

1. Abra `/` e adicione um perfil em **Perfis**.
2. Clique **Varrer**. Se TikTok bloquear, confira o status em **Varreduras**. Isso **nao e erro do dashboard**.
3. Em **Varreduras**, tente adicionar uma URL individual de video.
4. Em **Biblioteca**, clique **Selecionar pasta** e importe MP4 de sua autoria ou com permissao. Abra um MP4 e recarregue a pagina para verificar a persistencia.
5. Em **Agendamentos**, informe `09:00,18:00` e gere uma fila. Ela nao publicara automaticamente.
6. Em **Configuracoes**, baixe o backup JSON e mantenha sua pasta original de arquivos MP4.

## Banco e futuras etapas

O Supabase existente **nao e acessado por este MVP**, para evitar liberar operacoes anonimas de escrita em um site publico. A tabela `public.profiles` pode permanecer com RLS habilitado sem policies. Na futura fase SaaS: login, `owner_id` em todas tabelas, politicas RLS, storage privado, APIs autenticadas e fila server-side com workers.
