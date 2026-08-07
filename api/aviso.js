const db = require('../lib/db');
const { preChecagem, exigirAuth, lerBody } = require('../lib/http');

// GET    /api/aviso -> público
// POST   /api/aviso -> exige login de staff, atualiza o texto do aviso
// DELETE /api/aviso -> exige login de staff, limpa o aviso
module.exports = async (req, res) => {
  if (preChecagem(req, res, ['GET', 'POST', 'DELETE'])) return;
  try {
    if (req.method === 'GET') {
      const texto = await db.getAviso();
      return res.status(200).json({ ok: true, texto });
    }
    const staffPayload = await exigirAuth(req, res); if (!staffPayload) return;
    if (req.method === 'DELETE') {
      const texto = await db.setAviso('');
      return res.status(200).json({ ok: true, texto });
    }
    const body = await lerBody(req);
    const texto = await db.setAviso((body.texto || '').slice(0, 500));
    res.status(200).json({ ok: true, texto });
  } catch (err) {
    console.error('[aviso]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
