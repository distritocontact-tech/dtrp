const db = require('../../lib/db');
const { preChecagem, exigirAuth, temCargo, lerBody } = require('../../lib/http');

// Função única cuidando de todas as rotas de /api/novidades (junta os 3
// arquivos antigos num só pra caber no limite de 12 Serverless Functions
// do plano Hobby da Vercel):
//   GET    /api/novidades            -> público, lista todas
//   POST   /api/novidades            -> exige staff (cargo >= 1), cria uma nova
//   DELETE /api/novidades/:id        -> exige staff (cargo >= 1), remove
//   POST   /api/novidades/:id/curtir -> público, incrementa curtida
module.exports = async (req, res) => {
  const partes = Array.isArray(req.query.params) ? req.query.params : [];

  try {
    // POST /api/novidades/:id/curtir
    if (partes.length === 2 && partes[1] === 'curtir') {
      if (preChecagem(req, res, ['POST'])) return;
      const id = parseInt(partes[0], 10);
      if (!id) return res.status(400).json({ ok: false, erro: 'Id inválido.' });
      const row = await db.curtirNovidade(id);
      if (!row) return res.status(404).json({ ok: false, erro: 'Novidade não encontrada.' });
      return res.status(200).json({ ok: true, id: row.id, curtidas: row.curtidas });
    }

    // DELETE /api/novidades/:id
    if (partes.length === 1) {
      if (preChecagem(req, res, ['DELETE'])) return;
      const staffPayload = await exigirAuth(req, res); if (!staffPayload) return;
      if (!temCargo(staffPayload, 1)) return res.status(403).json({ ok: false, erro: 'Seu cargo não tem permissão para essa ação.' });
      const id = parseInt(partes[0], 10);
      await db.removeNovidade(id);
      return res.status(200).json({ ok: true });
    }

    // GET / POST /api/novidades
    if (preChecagem(req, res, ['GET', 'POST'])) return;
    if (req.method === 'GET') {
      const novidades = await db.getNovidades();
      return res.status(200).json({ ok: true, novidades });
    }
    const staffPayload = await exigirAuth(req, res); if (!staffPayload) return;
    if (!temCargo(staffPayload, 1)) return res.status(403).json({ ok: false, erro: 'Seu cargo não tem permissão para essa ação.' });
    const body = await lerBody(req);
    if (!body.texto || !body.texto.trim()) return res.status(400).json({ ok: false, erro: 'Informe o texto da novidade.' });
    if (!body.titulo || !body.titulo.trim()) return res.status(400).json({ ok: false, erro: 'Informe o título da novidade.' });
    const novidade = await db.addNovidade({
      texto: body.texto.trim().slice(0, 4000),
      titulo: body.titulo.trim().slice(0, 200),
      tipo: ['novo', 'sistema', 'aviso', 'evento', 'atualizacao'].includes(body.tipo) ? body.tipo : 'novo',
      imagem: body.imagem ? String(body.imagem).slice(0, 600) : null,
      gif: body.gif ? String(body.gif).slice(0, 600) : null,
      banner: !!body.banner,
      categoria: (body.categoria || 'geral').toString().slice(0, 40),
      fixado: !!body.fixado,
      destaque: !!body.destaque,
      autor: staffPayload.nome || 'Distrito RolePlay',
    });
    res.status(200).json({ ok: true, novidade });
  } catch (err) {
    console.error('[novidades]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
