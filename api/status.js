const db = require('../lib/db');
const { preChecagem, exigirAuth, lerBody } = require('../lib/http');

// GET  /api/status         -> público, qualquer um pode consultar
// POST /api/status         -> exige login de staff, define aberto/fechado
module.exports = async (req, res) => {
  if (preChecagem(req, res, ['GET', 'POST'])) return;
  try {
    if (req.method === 'GET') {
      const status = await db.getStatus();
      return res.status(200).json({ ok: true, ...status });
    }
    const staffPayload = await exigirAuth(req, res); if (!staffPayload) return;
    const body = await lerBody(req);
    const status = await db.setStatus(!!body.fechado, (body.motivo || '').slice(0, 200));
    res.status(200).json({ ok: true, ...status });
  } catch (err) {
    console.error('[status]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
