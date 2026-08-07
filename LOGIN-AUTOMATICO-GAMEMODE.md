# Login automático (launcher → servidor), estilo FiveM

## Como funciona

1. O player faz login/cadastro **no launcher** (`/api/conta/login` ou
   `/api/conta/registrar`), que já existia.
2. Quando o player clica **"Jogar"**, e um instante antes de abrir o
   `samp.exe`, o launcher chama `POST /api/conta/sessao-jogo` com
   `{ "acao": "iniciar", "token": "<token da conta>" }`. O backend grava
   `nick + IP público do launcher` numa tabela com validade de 3 minutos.
3. Quando o player conecta de verdade no servidor SA-MP, a **gamemode**
   (Pawn) chama o mesmo endpoint com
   `{ "acao": "verificar", "nick": "...", "ip": "..." }`, usando o IP real
   do player dentro do jogo (`GetPlayerIp`). Se bater com o que foi gravado
   no passo 2 (mesmo nick, mesmo IP, dentro da validade, ainda não usado):
   `autoLogin: true` → loga o player direto, sem dialog.
4. Se **não bater** (player abriu o `samp.exe` direto, sem passar pelo
   launcher, ou demorou demais pra conectar) → `autoLogin: false` → a
   gamemode mostra o dialog de login/cadastro normal, chamando
   `/api/conta/login` ou `/api/conta/registrar` com usuário/senha.

Isso é o mesmo princípio do FiveM (o launcher é quem autentica; o server
confia nisso), adaptado pro SA-MP, que não tem um handshake nativo pra
carregar token — por isso a confirmação usa nick + IP do player com uma
janela de tempo curta, em vez de um token dentro do próprio protocolo do
jogo.

## Variáveis de ambiente novas

Adicione na Vercel (Settings → Environment Variables), além das que já
existiam:

- `GAMEMODE_SECRET` → um texto aleatório longo, IGUAL ao que você vai
  colocar na config da gamemode. Só quem manda esse header consegue chamar
  a ação `verificar` (protege pra ninguém tentar "roubar" sessão de outro
  nick só adivinhando).

## Lado da gamemode (Pawn)

O SA-MP tem uma native HTTP built-in desde a 0.3.7 (`HTTP()`), sem precisar
de plugin extra. Exemplo mínimo pro `OnPlayerConnect`:

```pawn
#define BACKEND_URL "dtrp.vercel.app"
#define GAMEMODE_SECRET "COLOQUE_O_MESMO_VALOR_DA_VERCEL_AQUI"

forward OnPlayerConnect(playerid);
public OnPlayerConnect(playerid)
{
    new nome[MAX_PLAYER_NAME];
    GetPlayerName(playerid, nome, sizeof(nome));

    new ip[16];
    GetPlayerIp(playerid, ip, sizeof(ip));

    new corpo[256];
    format(corpo, sizeof(corpo),
        "{\"acao\":\"verificar\",\"nick\":\"%s\",\"ip\":\"%s\"}",
        nome, ip);

    // playerid vai junto no index pra sabermos, na resposta, de quem é.
    HTTP(playerid, HTTP_POST, "https://"BACKEND_URL"/api/conta/sessao-jogo",
        corpo, "OnRespostaSessaoJogo");

    // Enquanto a resposta não chega, trava o player num estado "verificando"
    // (congelado / sem HUD) pra ele não jogar antes de saber se logou.
    TogglePlayerControllable(playerid, false);
    return 1;
}

// OBS: pra mandar o header "x-gamemode-secret" e "Content-Type: application/json"
// a native HTTP() padrão do SA-MP não deixa customizar headers — nesse caso
// dá pra:
//   a) usar um plugin de HTTP mais completo (ex: pawn-requests / YSF), que
//      permite headers customizados, OU
//   b) mandar o segredo como parte do corpo/JSON (menos ideal, mas funciona:
//      inclua "segredo":"..." no corpo e valide isso na API em vez do
//      header — troque req.headers['x-gamemode-secret'] por body.segredo
//      no server/api/conta/sessao-jogo.js se optar por esse caminho).

forward OnRespostaSessaoJogo(playerid, response_code, data[]);
public OnRespostaSessaoJogo(playerid, response_code, data[])
{
    if (!IsPlayerConnected(playerid)) return 1;

    // Parse simples de JSON pra pegar "autoLogin":true — troque por uma lib
    // de JSON de verdade (ex: json.inc do Y_Less) num projeto real.
    if (response_code == 200 && strfind(data, "\"autoLogin\":true") != -1)
    {
        TogglePlayerControllable(playerid, true);
        // Player veio do launcher já autenticado -> pula reto pro spawn,
        // já com o cargo/staff que também vem no JSON de resposta.
        LogarPlayerAutomaticamente(playerid); // sua função existente de login
    }
    else
    {
        TogglePlayerControllable(playerid, true);
        // Não veio do launcher (ou demorou demais) -> dialog normal.
        MostrarDialogLogin(playerid); // seu dialog existente de login/cadastro
    }
    return 1;
}
```

### Sobre o login/cadastro manual dentro do servidor

O dialog de login/cadastro que aparece pra quem conecta direto (sem
launcher) deve chamar os **mesmos** endpoints que o launcher já usa —
`/api/conta/login` e `/api/conta/registrar` — assim a conta é sempre a
mesma em qualquer lugar (launcher ou servidor direto), sem duplicar base de
usuários. É só repetir a mesma lógica de `HTTP()` acima, apontando pra
essas duas rotas em vez de `sessao-jogo`.

### Limitação (seja honesto com os players sobre isso)

Essa amarração é por **nick + IP + tempo**, não por um token criptográfico
dentro do protocolo do jogo (o SA-MP não suporta isso nativamente). Na
prática, pra alguém "roubar" um auto-login teria que: saber o nick exato
de alguém, estar atrás do MESMO IP público que essa pessoa (ex: mesma rede
Wi-Fi/NAT), E conseguir fazer isso dentro da janela de ~3 minutos logo
depois da pessoa clicar "Jogar" no launcher. É segurança de nível
"suficiente pra um servidor de RP", não infraestrutura de conta bancária —
se precisar de algo mais forte, dá pra reduzir a validade (`validadeSegundos`
em `criarSessaoJogo`/`consumirSessaoJogo`, hoje 180s) ou exigir 2FA no
dialog manual.
