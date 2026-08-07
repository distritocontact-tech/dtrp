const db = require('../../lib/db');
const { hashSenha, gerarToken } = require('../../lib/auth');
const { preChecagem, lerBody } = require('../../lib/http');

module.exports = async (req, res) => {
  if (preChecagem(req, res, ['POST'])) return;
  try {
    const { nick, senha } = await lerBody(req);
    if (!nick || !nick.trim() || !senha || senha.length < 4) {
      return res.status(400).json({ ok: false, erro: 'Informe um nickname e uma senha com pelo menos 4 caracteres.' });
    }
    const nickTrim = nick.trim();
    const existente = await db.buscarContaLogin(nickTrim);
    if (existente) return res.status(409).json({ ok: false, erro: 'Esse nickname já tem uma conta cadastrada.' });

    const { hash, salt } = hashSenha(senha);
    const criada = await db.criarContaLogin(nickTrim, hash, salt);
    const token = gerarToken({ nome: nickTrim, superAdmin: false });
    const cargo = await db.getCargo(nickTrim);
    res.status(200).json({ ok: true, token, nick: nickTrim, cargo, superAdmin: false, criadoEm: criada?.criado_em });
  } catch (err) {
    console.error('[conta/registrar]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
