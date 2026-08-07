const db = require('../../../lib/db');
const { preChecagem, exigirAuth, temCargo, lerBody } = require('../../../lib/http');

// Função única cuidando de todas as rotas de /api/admin/staff (junta os 2
// arquivos antigos num só pra caber no limite de 12 Serverless Functions
// do plano Hobby da Vercel):
//   GET    /api/admin/staff       -> exige staff (cargo >= 1), lista
//   POST   /api/admin/staff       -> exige staff (cargo >= 3), promove/atualiza cargo
//   DELETE /api/admin/staff/:nick -> exige staff (cargo >= 3), remove
module.exports = async (req, res) => {
  const partes = Array.isArray(req.query.params) ? req.query.params : [];

  try {
    // DELETE /api/admin/staff/:nick
    if (partes.length === 1) {
      if (preChecagem(req, res, ['DELETE'])) return;
      const staffPayload = await exigirAuth(req, res); if (!staffPayload) return;
      if (!temCargo(staffPayload, 3)) return res.status(403).json({ ok: false, erro: 'Seu cargo não tem permissão para essa ação.' });
      const nick = decodeURIComponent(partes[0] || '');
      const staff = await db.removerStaff(nick);
      return res.status(200).json({ ok: true, staff });
    }

    // GET / POST /api/admin/staff
    if (preChecagem(req, res, ['GET', 'POST'])) return;
    const staffPayload = await exigirAuth(req, res); if (!staffPayload) return;
    if (!temCargo(staffPayload, 1)) return res.status(403).json({ ok: false, erro: 'Seu cargo não tem permissão para essa ação.' });

    if (req.method === 'GET') {
      const staff = await db.getStaffLista();
      return res.status(200).json({ ok: true, staff });
    }

    // POST — promover/atualizar cargo (exige cargo >= 3)
    if (!temCargo(staffPayload, 3)) return res.status(403).json({ ok: false, erro: 'Seu cargo não tem permissão para essa ação.' });
    const { nick, cargo } = await lerBody(req);
    if (!nick || !nick.trim()) return res.status(400).json({ ok: false, erro: 'Informe o nickname.' });
    const cargoNum = Math.max(0, Math.min(5, parseInt(cargo, 10) || 0));
    if (cargoNum >= 5 && !staffPayload.superAdmin) {
      return res.status(403).json({ ok: false, erro: 'Só o administrador principal pode promover alguém a Dono.' });
    }
    const staff = await db.setCargo(nick, cargoNum);
    res.status(200).json({ ok: true, staff });
  } catch (err) {
    console.error('[admin/staff]', err);
    res.status(500).json({ ok: false, erro: 'Erro interno: ' + err.message });
  }
};
