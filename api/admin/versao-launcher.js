const db = require('../../lib/db');
const { preChecagem, exigirAuth, lerBody } = require('../../lib/http');

// GET  /api/admin/versao-launcher            -> versão do LAUNCHER (público)
// GET  /api/admin/versao-launcher?alvo=data  -> versão da DATA / patch (público)
// POST (idem, com ?alvo=data pra publicar patch) -> exige staff CEO (4)+
//
// Os dois tipos de versão dividem o mesmo arquivo/endpoint de propósito: o
// plano grátis da Vercel tem um limite de 12 serverless functions, então em
// vez de criar um arquivo novo só pra isso, a versão da data usa o parâmetro
// `alvo` pra cair na mesma function.
module.exports = async (req, res) => {
  if (preChecagem(req, res, ['GET', 'POST'])) return;
  try {
    const alvoData = req.query && req.query.alvo === 'data';

    if (req.method === 'GET') {
      if (alvoData) {
        // Modo histórico: devolve TODOS os patches com versão maior que
        // `desde` — é o que o launcher usa pra baixar tudo que um player
        // (novo ou desatualizado há tempo) ainda não tem, de uma vez.
        if (req.query.historico !== undefined) {
          const desde = parseInt(req.query.desde, 10) || 0;
          const patches = await db.getPatchesDataDesde(desde);
          return res.status(200).json({ ok: true, patches });
        }
        const versao = await db.getVersaoData();
        return res.status(200).json({ ok: true, ...versao });
      }
      const versao = await db.getVersaoLauncher();
      return res.status(200).json({ ok: true, ...versao });
    }

    const staffPayload = await exigirAuth(req, res); if (!staffPayload) return;
    if ((staffPayload.cargo || 0) < 4) {
      return res.status(403).json({ ok: false, erro: alvoData
        ? 'Só o cargo CEO pode publicar uma nova versão da data.'
        : 'Só o cargo CEO pode publicar uma nova versão do launcher.' });
    }

    const body = await lerBody(req);
    const patch = {};

    if (alvoData) {
      // Cada publicação vira um patch NOVO no histórico (não edita um
      // existente) — por isso versão e link são sempre obrigatórios aqui.
      const versao = parseInt(body.versao, 10);
      if (!Number.isInteger(versao) || versao <= 0) {
        return res.status(400).json({ ok: false, erro: 'Versão da data inválida. Use um número inteiro maior que 0 (ex: 1, 2, 3...).' });
      }
      const url = typeof body.url === 'string' ? body.url.slice(0, 500) : '';
      if (!url) {
        return res.status(400).json({ ok: false, erro: 'Cole o link direto do .zip com a modificação.' });
      }
      const notas = typeof body.notas === 'string' ? body.notas.slice(0, 1000) : '';

      try {
        const versaoPublicada = await db.setVersaoData({ versao, url, notas });
        return res.status(200).json({ ok: true, ...versaoPublicada });
      } catch (errPatch) {
        return res.status(400).json({ ok: false, erro: errPatch.message });
      }
    }

    if (typeof body.versao === 'string') {
      const versao = body.versao.trim();
      // Formato simples "x.y.z" (números separados por ponto) — o mesmo
      // usado no version do package.json e comparado pelo launcher.
      if (!/^\d+\.\d+\.\d+$/.test(versao)) {
        return res.status(400).json({ ok: false, erro: 'Versão inválida. Use o formato x.y.z (ex: 1.2.0).' });
      }

      // Guarda contra clique duplo / envio repetido no painel: se a versão
      // publicada já é EXATAMENTE essa, não faz nada — só devolve o que já
      // está no banco. Isso evita que um segundo clique acidental sobrescreva
      // com um valor diferente (ou publique de novo o mesmo patch) e deixe o
      // banco apontando pra uma versão que nenhum instalador realmente tem.
      const atual = await db.getVersaoLauncher();
      if (versao === atual.versao) {
        return res.status(200).json({ ok: true, ...atual, aviso: 'Essa já era a versão publicada — nada foi alterado.' });
      }

      patch.versao = versao;
    }
    if (typeof body.url === 'string') patch.url = body.url.slice(0, 500);
    if (typeof body.notas === 'string') patch.notas = body.notas.slice(0, 1000);

    const versao = await db.setVersaoLauncher(patch);
    res.status(200).json({ ok: true, ...versao });
  } catch (err) {
    console.error('[versao-launcher]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
