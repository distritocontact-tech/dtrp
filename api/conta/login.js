const db = require('../../lib/db');
const { hashSenha, verificarSenha, gerarToken } = require('../../lib/auth');
const { preChecagem, lerBody } = require('../../lib/http');

const ADMIN_USER = process.env.ADMIN_USER || 'mitz7';
const ADMIN_PASS = process.env.ADMIN_PASS || '05022014';

module.exports = async (req, res) => {
  if (preChecagem(req, res, ['POST'])) return;
  try {
    const { nick, senha } = await lerBody(req);
    if (!nick || !senha) return res.status(400).json({ ok: false, erro: 'Informe usuário e senha.' });
    const nickTrim = nick.trim();

    // Bootstrap: admin principal (do .env) sempre consegue entrar com essas
    // credenciais, mesmo sem ter "cadastrado" a conta formalmente ainda.
    const ehBootstrapAdmin = nickTrim.toLowerCase() === ADMIN_USER.toLowerCase() && senha === ADMIN_PASS;
    if (ehBootstrapAdmin) {
      const existente = await db.buscarContaLogin(ADMIN_USER);
      if (!existente) {
        const { hash, salt } = hashSenha(senha);
        await db.criarContaLogin(ADMIN_USER, hash, salt);
      }
      const token = gerarToken({ nome: ADMIN_USER, superAdmin: true });
      return res.status(200).json({ ok: true, token, nick: ADMIN_USER, cargo: 5, superAdmin: true });
    }

    const conta = await db.buscarContaLogin(nickTrim);
    if (!conta) return res.status(404).json({ ok: false, erro: 'Conta não encontrada. Crie uma conta primeiro.' });
    if (!verificarSenha(senha, conta.hash, conta.salt)) {
      return res.status(401).json({ ok: false, erro: 'Senha incorreta.' });
    }
    const token = gerarToken({ nome: conta.nick, superAdmin: false });
    const cargo = await db.getCargo(conta.nick);
    res.status(200).json({ ok: true, token, nick: conta.nick, cargo, superAdmin: false });
  } catch (err) {
    console.error('[conta/login]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
