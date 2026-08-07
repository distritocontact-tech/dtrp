# Backend do Launcher — Vercel Functions + Neon (grátis, sem servidor 24/7)

Essa pasta substitui o antigo `backend/` (Express + discord.js). Agora:

- Não tem processo Node rodando o tempo todo — são **funções serverless**
  (Vercel Functions, plano Hobby grátis) que só "acordam" quando o launcher
  chama.
- O banco é o **Neon Postgres** (plano grátis), acessado via
  `@neondatabase/serverless` (driver HTTP, sem precisar manter conexão aberta).
- **A vinculação de conta Discord foi removida** (não tem mais bot, OAuth2 nem
  DM de código). O launcher usa só o **Discord Rich Presence** local
  (`discord-rpc`, configurado direto em `src/main.js`), que não depende
  desse backend.

## 1. Banco (Neon)

Você já tem o projeto Neon criado. Só precisa da **connection string**:

1. No dashboard do Neon, abra seu projeto → **Connection Details**.
2. Copie a string no formato `postgresql://usuario:senha@ep-xxxx-pooler.regiao.aws.neon.tech/neondb?sslmode=require`
   (use a versão **pooled**, com `-pooler` no host — é a recomendada pra
   funções serverless, que abrem/fecham conexão a cada chamada).
3. Guarde essa string, você vai colar ela na Vercel no próximo passo.

As tabelas (`status`, `aviso`, `novidades`, `staff`, `contas_login`) são
criadas automaticamente na primeira chamada — não precisa rodar nenhuma
migração manual.

## 2. Deploy (Vercel)

1. Crie uma conta grátis em https://vercel.com (dá pra logar com GitHub).
2. Suba essa pasta `server/` para um repositório Git (GitHub/GitLab/Bitbucket),
   **ou** instale a CLI da Vercel e rode direto daqui:
   ```
   npm i -g vercel
   cd server
   vercel
   ```
3. Se for pelo site: **New Project → Import** o repositório, selecione a
   pasta `server/` como raiz do projeto quando perguntado ("Root Directory").
4. Em **Settings → Environment Variables**, adicione:
   - `DATABASE_URL` → a connection string do Neon (passo 1)
   - `ADMIN_USER` → `mitz7` (ou o que preferir)
   - `ADMIN_PASS` → troque pela senha que quiser
   - `ADMIN_TOKEN_SECRET` → qualquer texto aleatório longo
5. Clique em **Deploy**. Ao terminar, a Vercel te dá uma URL tipo:
   `https://distrito-launcher-server.vercel.app`

## 3. Apontando o launcher pra essa URL

Em `src/main.js`, edite a constante:

```js
const BACKEND_URL = 'https://distrito-launcher-server.vercel.app';
```

(troque pela URL que a Vercel te deu, sem barra no final)

## Painel de Staff

- Login inicial: usuário/senha definidos em `ADMIN_USER`/`ADMIN_PASS`.
- Depois de logado, esse usuário pode **promover qualquer nickname** a
  Estagiário / Moderador / Administrador / CEO / Dono direto pelo painel do
  launcher — sem precisar mexer no backend.
- Só quem está logado como o admin principal (ou tem cargo Dono) pode
  promover outra pessoa a Dono.
- Abrir/fechar o servidor e publicar avisos/novidades feitos pelo painel
  valem pra **todos os jogadores**, pois ficam salvos no Neon.

## Sobre bloquear o IP do servidor

O botão "Fechar servidor" no painel impede a **conexão pelo próprio
launcher** (ele verifica o status antes de abrir o SA-MP). Isso **não**
troca o comportamento do servidor SA-MP em si — quem tiver o IP e conectar
direto pelo cliente SA-MP (sem passar pelo launcher) ainda consegue entrar,
a menos que você também bloqueie isso no `server.cfg`/firewall do servidor
SA-MP.

## Por que não conectar o launcher direto no Neon (sem essa camada)?

O launcher roda na máquina de cada jogador. Se ele guardasse a
`DATABASE_URL` (ou qualquer credencial de escrita no banco) dentro do
próprio app, qualquer pessoa poderia extrair o instalador e conseguir
acesso de leitura/escrita direto no banco — inclusive na tabela de staff e
nas senhas com hash. Por isso a `DATABASE_URL` fica só aqui, nas variáveis
de ambiente da Vercel, e o launcher só fala com essas funções via HTTPS,
nunca com o Neon diretamente.

## Estrutura de rotas

O plano gratuito (Hobby) da Vercel permite **no máximo 12 serverless
functions por deploy** — por isso as rotas GET (públicas) e POST/DELETE
(admin) do mesmo recurso ficam no **mesmo arquivo**, diferenciando por
método HTTP:

```
api/status.js                 GET (público) / POST (admin, requer login)   /api/status
api/aviso.js                  GET (público) / POST / DELETE (admin)         /api/aviso
api/novidades.js               GET (público) / POST (admin)                 /api/novidades
api/novidades/[id].js          DELETE (admin)                                /api/novidades/:id
api/conta/registrar.js         POST                                          /api/conta/registrar
api/conta/login.js             POST                                          /api/conta/login
api/admin/login.js             POST (compatibilidade)                       /api/admin/login
api/staff/[nick].js            GET (público)                                 /api/staff/:nick
api/admin/staff.js             GET/POST (admin)                              /api/admin/staff
api/admin/staff/[nick].js      DELETE (admin)                                /api/admin/staff/:nick
api/admin/config-servidor.js   GET (público) / POST (admin, cargo CEO+)      /api/admin/config-servidor
api/admin/versao-launcher.js   GET (público) / POST (admin, cargo CEO+)      /api/admin/versao-launcher
```

Total: 11 funções (folga de 1 antes de bater no limite de 12 do plano grátis
— se precisar adicionar mais rotas, junte alguma no padrão `[[...params]].js`
usado em `admin/staff` e `dev/barras`).

## IP/porta do servidor (sem precisar recompilar o launcher)

`config_servidor` guarda também `ip` e `porta` do servidor SA-MP. O launcher
busca esses valores em `/api/admin/config-servidor` (com cache de 1 minuto)
toda vez que o player clica em "Jogar", em vez de usar um valor fixo
compilado no `.exe`. Só cargo CEO (4+) pode alterar, pelo painel do launcher
(aba Identidade do Servidor). Se o backend estiver fora do ar na hora de
conectar, o launcher usa o último valor bom que conseguiu buscar (ou o
fallback fixo em `src/main.js`, `SERVIDOR_IP_PADRAO`/`SERVIDOR_PORTA_PADRAO`,
se nunca conseguiu buscar nada ainda).

## Atualização obrigatória do launcher (baixa e instala sem sair do launcher)

`launcher_versao` guarda a versão mais recente publicada (`versao`, no
formato `x.y.z`), o `url` de download **direto** do instalador (`.exe`) novo
e `notas` (changelog opcional). Assim que o launcher termina de carregar,
ele confere essa versão contra `app.getVersion()` (do `package.json`); se a
publicada for maior, mostra um popup que só se fecha se o player clicar em
**"Sair do launcher"** ou em **"⬇ Atualizar agora"**.

Clicando em atualizar, o launcher baixa o `.exe` novo **dentro dele mesmo**
(sem abrir navegador — mesmo mecanismo já usado pra baixar a data do jogo,
com barra de progresso e retry automático), e assim que termina já executa o
instalador sozinho e fecha o launcher atual. **Só funciona no Windows** (é a
única plataforma que o build gera hoje).

### Onde hospedar o `.exe` novo (grátis, com link direto)

O `url` cadastrado no painel precisa ser um **link direto de download**
(que já manda os bytes do arquivo, sem passar por uma página HTML no meio —
diferente do link de compartilhamento do MediaFire, que o launcher não sabe
resolver sozinho pra esse fluxo). Duas opções gratuitas:

**1) GitHub Releases (recomendado)**
- Crie um repositório (pode ser privado) só pra guardar os builds, ex:
  `distrito-launcher-releases`.
- Vá em **Releases → Draft a new release**, dê uma tag (ex: `v1.1.0`) e
  **anexe o `.exe`** gerado pelo `npm run build` (fica em `dist/` depois do
  build do electron-builder) como asset da release.
- Publique a release. O link direto do asset é assim:
  `https://github.com/SEU_USUARIO/SEU_REPO/releases/download/v1.1.0/Distrito.RolePlay.Setup.1.1.0.exe`
  (o nome exato do arquivo é o que o electron-builder gerou em `dist/`).
- Sem limite de banda prático pra esse uso, sem precisar de conta paga.

**2) Pixeldrain**
- Mesma conta/serviço já usado pra hospedar a data do jogo
  (`DOWNLOAD_CONFIG.lite.url` em `src/main.js`).
- Suba o `.exe`, copie o link e troque `/u/` por `/api/file/` com `?download`
  no final, igual já é feito pra data — ex:
  `https://pixeldrain.com/api/file/SEUID?download`.

Evite Mediafire/Google Drive/Dropbox pra esse fluxo específico: eles não dão
um link direto estável sem passar por uma etapa extra de "confirmar
download", e o launcher (diferente do fluxo da data, que já tem um resolver
próprio de MediaFire) espera que o `url` sirva o arquivo direto.

Fluxo completo pra publicar uma atualização:
1. Suba a versão em `package.json` (`"version": "x.y.z"`) e rode
   `npm run build` — o instalador novo sai em `dist/`.
2. Suba esse `.exe` pro GitHub Releases (ou Pixeldrain) e pegue o link direto.
3. No painel do launcher (cargo CEO), aba **Atualização do Launcher**,
   preencha a mesma versão `x.y.z`, cole o link direto e publique.
4. Todo player que abrir uma versão antiga do launcher vê o popup na hora, e
   ao clicar em "Atualizar agora" o instalador baixa e abre sozinho.

## Estrutura de dados (Neon)

```
status           (id, fechado, motivo)
aviso            (id, texto)
novidades        (id, texto, criado_em, ...)
staff            (nick_lower, nick, cargo)        -- cargo: 0 a 5
contas_login     (nick_lower, nick, hash, salt, criado_em)
config_servidor  (id, nome, icone, banner, ip, porta)
launcher_versao  (id, versao, url, notas)
```
