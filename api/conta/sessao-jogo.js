// Uma rota só (POST /api/conta/sessao-jogo) com duas ações, diferenciadas
// pelo campo "acao" no corpo — junto num arquivo só porque o plano grátis
// da Vercel permite no máximo 12 serverless functions (ver README).
//
// acao "iniciar": chamada pelo LAUNCHER, no momento em que o player clica
//   "Jogar" e o launcher já validou o login (token de /api/conta/login).
//   Grava esse nick + o IP público de quem chamou, com validade curta.
//
// acao "verificar": chamada pela GAMEMODE (processo SA-MP do servidor), em
//   OnPlayerConnect, com o nick e o GetPlayerIp(playerid) do player que
//   acabou de conectar. Se bater com uma sessão "iniciar" recente pro mesmo
//   nick + IP, devolve autoLogin:true e a gamemode loga o player sem pedir
//   usuário/senha. Quem conecta direto pelo samp.exe (sem passar pelo
//   launcher) nunca tem sessão pendente, então cai no dialog de login
//   normal (que a gamemode implementa chamando /api/conta/login).
//   Protegida por GAMEMODE_SECRET pra só o processo do servidor conseguir
//   chamar essa ação.
const db = require('../../lib/db');
const { validarToken } = require('../../lib/auth');
const { preChecagem, lerBody, ipDoRequest } = require('../../lib/http');

const GAMEMODE_SECRET = process.env.GAMEMODE_SECRET || '';

module.exports = async (req, res) => {
  if (preChecagem(req, res, ['POST'])) return;
  try {
    const body = await lerBody(req);

    if (body.acao === 'verificar') {
      // A native HTTP() do SA-MP não permite mandar headers customizados,
      // então a gamemode manda o segredo dentro do corpo JSON ("segredo").
      // Aceitamos tanto o header (pra quem usa um plugin HTTP mais completo,
      // tipo pawn-requests/YSF) quanto o campo no corpo.
      const segredoRecebido = req.headers['x-gamemode-secret'] || body.segredo;
      if (!GAMEMODE_SECRET || segredoRecebido !== GAMEMODE_SECRET) {
        return res.status(401).json({ ok: false, erro: 'Não autorizado.' });
      }
      const { nick, ip } = body;
      if (!nick || !ip) return res.status(400).json({ ok: false, erro: 'Informe nick e ip.' });

      const bateu = await db.consumirSessaoJogo(nick, ip);
      if (!bateu) return res.status(200).json({ ok: true, autoLogin: false });

      const cargo = await db.getCargo(nick);
      return res.status(200).json({ ok: true, autoLogin: true, nick, cargo });
    }

    if (body.acao === 'iniciar') {
      const payload = validarToken(body.token);
      if (!payload) return res.status(401).json({ ok: false, erro: 'Sessão expirada. Faça login novamente no launcher.' });

      const ip = ipDoRequest(req);
      if (!ip) return res.status(400).json({ ok: false, erro: 'Não consegui identificar seu IP.' });

      await db.criarSessaoJogo(payload.nome, ip);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, erro: 'acao inválida (use "iniciar" ou "verificar").' });
  } catch (err) {
    console.error('[conta/sessao-jogo]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
