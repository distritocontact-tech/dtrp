const db = require('../../lib/db');
const { preChecagem, exigirAuth, lerBody } = require('../../lib/http');

// GET  /api/admin/config-servidor -> público (o launcher usa pra montar a tela de conectando/carregamento)
// POST /api/admin/config-servidor -> exige login de staff com cargo CEO (4) ou superior
module.exports = async (req, res) => {
  if (preChecagem(req, res, ['GET', 'POST'])) return;
  try {
    if (req.method === 'GET') {
      const config = await db.getConfigServidor();
      return res.status(200).json({ ok: true, ...config });
    }

    const staffPayload = await exigirAuth(req, res); if (!staffPayload) return;
    if ((staffPayload.cargo || 0) < 4) {
      return res.status(403).json({ ok: false, erro: 'Só o cargo CEO pode alterar o banner, ícone e nome do servidor.' });
    }

    const body = await lerBody(req);
    const patch = {};
    if (typeof body.nome === 'string') patch.nome = body.nome.slice(0, 60);
    if (typeof body.icone === 'string') patch.icone = body.icone.slice(0, 500);
    if (typeof body.banner === 'string') patch.banner = body.banner.slice(0, 500);

    // IP/porta do servidor SA-MP — validados antes de ir pro banco, porque
    // isso vai direto pra linha de comando do samp.exe no PC de cada player.
    if (typeof body.ip === 'string') {
      const ip = body.ip.trim();
      const ipValido = /^[a-zA-Z0-9.-]{1,255}$/.test(ip); // aceita IP ou domínio
      if (!ipValido) return res.status(400).json({ ok: false, erro: 'IP/domínio inválido.' });
      patch.ip = ip;
    }
    if (body.porta !== undefined) {
      const porta = Number(body.porta);
      if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
        return res.status(400).json({ ok: false, erro: 'Porta inválida (use um número entre 1 e 65535).' });
      }
      patch.porta = porta;
    }

    // Magnet link do torrent da data — o launcher busca esse valor aqui
    // antes de CADA download, então trocar isso não exige rebuildar nem
    // republicar o launcher. Deixar vazio ('') desativa a fonte torrent
    // (o launcher cai automaticamente pras outras fontes configuradas).
    if (typeof body.magnetLink === 'string') {
      const magnet = body.magnetLink.trim();
      if (magnet && !magnet.startsWith('magnet:?')) {
        return res.status(400).json({ ok: false, erro: 'Isso não parece um magnet link válido (precisa começar com "magnet:?").' });
      }
      patch.magnetLink = magnet.slice(0, 2000);
    }

    const config = await db.setConfigServidor(patch);
    res.status(200).json({ ok: true, ...config });
  } catch (err) {
    console.error('[config-servidor]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
