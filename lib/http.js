const { validarToken } = require('./auth');
const db = require('./db');

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
}

// Retorna true se já tratou a requisição (preflight / método errado)
function preChecagem(req, res, metodosPermitidos) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  if (!metodosPermitidos.includes(req.method)) {
    res.status(405).json({ ok: false, erro: 'Método não permitido.' });
    return true;
  }
  return false;
}

async function lerBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
  });
}

// Valida o token do header Authorization e devolve o payload com o cargo
// atualizado (busca no banco, exceto pro superAdmin que é sempre 5).
async function exigirAuth(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const payload = validarToken(token);
  if (!payload) { res.status(401).json({ ok: false, erro: 'Sessão expirada. Faça login novamente.' }); return null; }
  const cargoAtual = payload.superAdmin ? 5 : await db.getCargo(payload.nome);
  return { ...payload, cargo: cargoAtual };
}

function temCargo(staffPayload, minimo) {
  return (staffPayload?.cargo || 0) >= minimo;
}

// Só permite pro CEO/dono principal (conta "mitz7", definida via ADMIN_USER),
// usada nas ações que só ele pode fazer (ex: editar barras de desenvolvimento).
function ehCeoPrincipal(staffPayload) {
  if (!staffPayload) return false;
  if (staffPayload.superAdmin) return true;
  const nome = (staffPayload.nome || '').toLowerCase();
  return nome === db.ADMIN_USER;
}

// IP público de quem fez a requisição. Na Vercel, o request chega atrás de
// proxy, então o IP real vem no header x-forwarded-for (o primeiro da lista
// é o do cliente original). req.socket.remoteAddress é só fallback local.
function ipDoRequest(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

module.exports = { cors, preChecagem, lerBody, exigirAuth, temCargo, ehCeoPrincipal, ipDoRequest };
