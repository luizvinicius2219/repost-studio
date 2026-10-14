# Repost Studio V0.5

Versao focada na organizacao editorial antes da publicacao.

## Novidades

- Contas de publicacao separadas dos perfis de origem.
- Regras por conta com dias da semana e multiplos horarios.
- Distribuicao automatica de MP4 nos proximos slots livres.
- O mesmo video pode ser usado em contas diferentes, sem repetir na mesma conta.
- Calendario semanal consolidado.
- Reagendamento individual.
- Status: rascunho, agendado, publicado, erro e cancelado.
- Historico e indicadores por conta.
- Biblioteca mostra quantas contas/uso cada video possui.
- Migracao automatica dos metadados da V0.3 para V0.5.

## Importante

- O motor local V0.4 de coleta/download continua separado.
- Depois de baixar videos, importe a pasta `downloads` na aba Biblioteca.
- A V0.5 nao publica automaticamente no TikTok.
- Dados ficam no navegador: localStorage + IndexedDB.

## Arquivos do pacote

Extraia o ZIP por cima de `C:\repost-studio\frontend`.
O pacote altera apenas arquivos da aplicacao e nao inclui `node_modules`.

Depois rode:

```powershell
cd C:\repost-studio\frontend
npm run build
```

Somente se o build finalizar com sucesso:

```powershell
git add .
git commit -m "Repost Studio V0.5 - contas e agenda editorial"
git push origin main
```
