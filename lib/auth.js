const crypto = require('crypto');

const TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || 'troque-essa-chave';

// ---------- Senhas (scrypt + salt) ----------
function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return { hash, salt };
}

function verificarSenha(senha, hash, salt) {
  const tentativa = crypto.scryptSync(senha, salt, 64);
  const esperado = Buffer.from(hash, 'hex');
  if (tentativa.length !== esperado.length) return false;
  return crypto.timingSafeEqual(tentativa, esperado);
}

// ---------- Token de sessão (HMAC simples) ----------
function gerarToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const assinatura = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${assinatura}`;
}

function validarToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, assinatura] = token.split('.');
  const esperada = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  if (assinatura !== esperada) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

module.exports = { hashSenha, verificarSenha, gerarToken, validarToken };
