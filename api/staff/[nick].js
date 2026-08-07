const db = require('../../lib/db');
const { preChecagem } = require('../../lib/http');

module.exports = async (req, res) => {
  if (preChecagem(req, res, ['GET'])) return;
  try {
    const nick = decodeURIComponent(req.query.nick || '');
    const cargo = await db.getCargo(nick);
    res.status(200).json({ ok: true, cargo, nome: nick });
  } catch (err) {
    console.error('[staff/:nick]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
