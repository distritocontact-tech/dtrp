const { gerarToken } = require('../../lib/auth');
const { preChecagem, lerBody } = require('../../lib/http');

const ADMIN_USER = process.env.ADMIN_USER || 'mitz7';
const ADMIN_PASS = process.env.ADMIN_PASS || '05022014';

module.exports = async (req, res) => {
  if (preChecagem(req, res, ['POST'])) return;
  try {
    const { usuario, senha } = await lerBody(req);
    if (usuario === ADMIN_USER && senha === ADMIN_PASS) {
      const token = gerarToken({ nome: ADMIN_USER, superAdmin: true });
      return res.status(200).json({ ok: true, token, nome: ADMIN_USER, superAdmin: true, cargo: 5 });
    }
    res.status(401).json({ ok: false, erro: 'Usuário ou senha inválidos.' });
  } catch (err) {
    console.error('[admin/login]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
