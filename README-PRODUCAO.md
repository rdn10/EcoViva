# Eco Viva — preparação para produção

Esta versão mantém o modo local por compatibilidade, mas foi preparada para usar PostgreSQL em produção.

## Desenvolvimento local

```bash
npm install
npm start
```

Sem `DATABASE_URL`, o projeto continua usando `data/*.json`.

## Produção

1. Crie um projeto PostgreSQL (recomendado: Supabase).
2. Copie a connection string do painel do banco.
3. No Render, crie um Web Service ligado ao repositório GitHub.
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Health Check Path: `/health`
7. Configure:
   - `DATABASE_URL` = connection string do PostgreSQL
   - `DATABASE_SSL` = `require`
   - `NODE_ENV` = `production`
   - `ADMIN_SETUP_KEY` = uma chave forte, caso queira controlar manualmente o primeiro setup
8. Faça o deploy.

Ao primeiro boot com `DATABASE_URL`, o aplicativo cria a tabela `ecoviva_state`. A produção começa sem usuários, sessões, parceiros, cupons ou produtos. Os fatores ambientais existentes em `data/material-factors.json` podem ser usados como seed inicial.

## Importante

- Nunca publique `.env` com segredos.
- Nunca coloque `DATABASE_URL` no JavaScript do navegador.
- O banco de produção deve ser separado do desenvolvimento.
- Antes de abrir o site ao público, configure domínio e HTTPS no Render.
