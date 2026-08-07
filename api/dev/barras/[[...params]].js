const db = require('../../../lib/db');
const { preChecagem, exigirAuth, ehCeoPrincipal, lerBody } = require('../../../lib/http');

// Função única cuidando de todas as rotas de /api/dev/barras (junta os 2
// arquivos antigos num só pra caber no limite de 12 Serverless Functions
// do plano Hobby da Vercel):
//   GET    /api/dev/barras     -> público, lista todas
//   POST   /api/dev/barras     -> exige CEO principal (mitz7), cria uma nova
//   PUT    /api/dev/barras/:id -> exige CEO principal, edita nome/emoji/porcentagem
//   DELETE /api/dev/barras/:id -> exige CEO principal, remove
module.exports = async (req, res) => {
  const partes = Array.isArray(req.query.params) ? req.query.params : [];

  try {
    // PUT / DELETE /api/dev/barras/:id
    if (partes.length === 1) {
      if (preChecagem(req, res, ['PUT', 'DELETE'])) return;
      const staffPayload = await exigirAuth(req, res); if (!staffPayload) return;
      if (!ehCeoPrincipal(staffPayload)) return res.status(403).json({ ok: false, erro: 'Somente o CEO (mitz7) pode gerenciar as barras de desenvolvimento.' });
      const id = parseInt(partes[0], 10);

      if (req.method === 'DELETE') {
        await db.removeBarraDev(id);
        return res.status(200).json({ ok: true });
      }

      const body = await lerBody(req);
      const dados = {};
      if (body.nome !== undefined) dados.nome = String(body.nome).trim().slice(0, 60);
      if (body.emoji !== undefined) dados.emoji = String(body.emoji).trim().slice(0, 8) || '🛠';
      if (body.porcentagem !== undefined) dados.porcentagem = Math.max(0, Math.min(100, parseInt(body.porcentagem, 10) || 0));

      const barra = await db.updateBarraDev(id, dados);
      if (!barra) return res.status(404).json({ ok: false, erro: 'Barra não encontrada.' });
      return res.status(200).json({ ok: true, barra });
    }

    // GET / POST /api/dev/barras
    if (preChecagem(req, res, ['GET', 'POST'])) return;
    if (req.method === 'GET') {
      const barras = await db.getBarrasDev();
      return res.status(200).json({ ok: true, barras });
    }
    const staffPayload = await exigirAuth(req, res); if (!staffPayload) return;
    if (!ehCeoPrincipal(staffPayload)) return res.status(403).json({ ok: false, erro: 'Somente o CEO (mitz7) pode gerenciar as barras de desenvolvimento.' });
    const body = await lerBody(req);
    if (!body.nome || !body.nome.trim()) return res.status(400).json({ ok: false, erro: 'Informe o nome da barra.' });
    const porcentagem = Math.max(0, Math.min(100, parseInt(body.porcentagem, 10) || 0));
    const barra = await db.addBarraDev({
      nome: body.nome.trim().slice(0, 60),
      emoji: (body.emoji || '🛠').toString().trim().slice(0, 8) || '🛠',
      porcentagem,
    });
    res.status(200).json({ ok: true, barra });
  } catch (err) {
    console.error('[dev/barras]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
