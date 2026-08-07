// ============================================================
// Acesso ao banco (Neon Postgres) via driver HTTP serverless.
// Não precisa de servidor rodando 24/7 — cada função aqui faz
// uma chamada HTTPS pontual pro Neon.
// ============================================================
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada (connection string do Neon).');
}

const sql = neon(process.env.DATABASE_URL);

const ADMIN_USER = (process.env.ADMIN_USER || 'mitz7').toLowerCase();

// ------------------------------------------------------------
// Cria as tabelas na primeira execução (idempotente).
// ------------------------------------------------------------
let schemaPronto = null;
async function garantirSchema() {
  if (schemaPronto) return schemaPronto;
  schemaPronto = criarSchema().catch((err) => {
    // Corrida entre invocações simultâneas: cada função da Vercel roda
    // isolada (sem estado compartilhado), então duas podem tentar criar a
    // MESMA tabela ao mesmo tempo com "CREATE TABLE IF NOT EXISTS". O
    // Postgres deixa passar essa corrida internamente na hora de registrar
    // o tipo da tabela em pg_type, e gera esse erro específico. Nesse caso
    // é seguro ignorar: significa que a outra invocação já criou tudo.
    const corridaBenigna = err && err.code === '23505'
      && /pg_type_typname_nsp_index|pg_class/i.test(err.message || '');
    if (corridaBenigna) return;
    // Erro genuíno: limpa o cache pra próxima chamada tentar de novo.
    schemaPronto = null;
    throw err;
  });
  return schemaPronto;
}

async function criarSchema() {
    await sql`
      CREATE TABLE IF NOT EXISTS sessoes_jogo (
        nick_lower TEXT PRIMARY KEY,
        nick TEXT NOT NULL,
        ip TEXT NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        usado BOOLEAN NOT NULL DEFAULT false
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS status (
        id SMALLINT PRIMARY KEY DEFAULT 1,
        fechado BOOLEAN NOT NULL DEFAULT false,
        motivo TEXT NOT NULL DEFAULT ''
      )
    `;
    await sql`INSERT INTO status (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;

    await sql`
      CREATE TABLE IF NOT EXISTS aviso (
        id SMALLINT PRIMARY KEY DEFAULT 1,
        texto TEXT NOT NULL DEFAULT ''
      )
    `;
    await sql`INSERT INTO aviso (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;

    await sql`
      CREATE TABLE IF NOT EXISTS config_servidor (
        id SMALLINT PRIMARY KEY DEFAULT 1,
        nome TEXT NOT NULL DEFAULT 'Distrito RolePlay',
        icone TEXT NOT NULL DEFAULT '',
        banner TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '181.215.45.74',
        porta INTEGER NOT NULL DEFAULT 7005
      )
    `;
    await sql`INSERT INTO config_servidor (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
    // Colunas novas (ip/porta) — ADD COLUMN IF NOT EXISTS pra não quebrar bancos já existentes.
    await sql`ALTER TABLE config_servidor ADD COLUMN IF NOT EXISTS ip TEXT NOT NULL DEFAULT '181.215.45.74'`;
    await sql`ALTER TABLE config_servidor ADD COLUMN IF NOT EXISTS porta INTEGER NOT NULL DEFAULT 7005`;
    await sql`ALTER TABLE config_servidor ADD COLUMN IF NOT EXISTS magnet_link TEXT NOT NULL DEFAULT ''`;

    // ---------- Versão do launcher (sistema de atualização obrigatória) ----------
    await sql`
      CREATE TABLE IF NOT EXISTS launcher_versao (
        id SMALLINT PRIMARY KEY DEFAULT 1,
        versao TEXT NOT NULL DEFAULT '1.0.0',
        url TEXT NOT NULL DEFAULT '',
        notas TEXT NOT NULL DEFAULT ''
      )
    `;
    await sql`INSERT INTO launcher_versao (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;

    // ---------- Versão da DATA (patches incrementais: arquivo novo ou sobrescrito) ----------
    // Tabela antiga (uma linha só, sobrescrita a cada publicação). Mantida só
    // pra migração do histórico abaixo — o sistema atual não escreve mais aqui.
    await sql`
      CREATE TABLE IF NOT EXISTS data_versao (
        id SMALLINT PRIMARY KEY DEFAULT 1,
        versao INTEGER NOT NULL DEFAULT 0,
        url TEXT NOT NULL DEFAULT '',
        notas TEXT NOT NULL DEFAULT ''
      )
    `;
    await sql`INSERT INTO data_versao (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;

    // ---------- HISTÓRICO de patches da data ----------
    // Cada publicação de patch vira uma LINHA NOVA aqui, em vez de
    // sobrescrever uma linha única. Isso é o que permite um player que está
    // instalando pela primeira vez (ou que ficou várias versões pra trás)
    // baixar e aplicar TODOS os patches que faltam, em ordem, de uma vez —
    // e não só o último publicado.
    await sql`
      CREATE TABLE IF NOT EXISTS data_patches (
        id SERIAL PRIMARY KEY,
        versao INTEGER NOT NULL UNIQUE,
        url TEXT NOT NULL,
        notas TEXT NOT NULL DEFAULT '',
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    // Migração única: se existia um patch no sistema antigo (linha única em
    // data_versao) e o histórico novo ainda está vazio, traz ele pra cá.
    const [{ total: totalPatches }] = await sql`SELECT COUNT(*)::int AS total FROM data_patches`;
    if (totalPatches === 0) {
      const [antigo] = await sql`SELECT versao, url, notas FROM data_versao WHERE id = 1`;
      const versaoAntigaLimpa = sanitizarVersaoData(antigo && antigo.versao);
      if (antigo && versaoAntigaLimpa > 0 && antigo.url) {
        await sql`
          INSERT INTO data_patches (versao, url, notas)
          VALUES (${versaoAntigaLimpa}, ${antigo.url}, ${antigo.notas || ''})
          ON CONFLICT (versao) DO NOTHING
        `;
      }
    }

    await sql`
      CREATE TABLE IF NOT EXISTS novidades (
        id SERIAL PRIMARY KEY,
        texto TEXT NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    // Colunas novas do sistema de notícias (cards, banner, imagens, gifs,
    // markdown, destaques, fixar, categorias, curtidas). Uso de ADD COLUMN
    // IF NOT EXISTS pra não quebrar bancos já existentes.
    await sql`ALTER TABLE novidades ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'novo'`;
    await sql`ALTER TABLE novidades ADD COLUMN IF NOT EXISTS titulo TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE novidades ADD COLUMN IF NOT EXISTS imagem TEXT`;
    await sql`ALTER TABLE novidades ADD COLUMN IF NOT EXISTS gif TEXT`;
    await sql`ALTER TABLE novidades ADD COLUMN IF NOT EXISTS banner BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE novidades ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'geral'`;
    await sql`ALTER TABLE novidades ADD COLUMN IF NOT EXISTS fixado BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE novidades ADD COLUMN IF NOT EXISTS destaque BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE novidades ADD COLUMN IF NOT EXISTS curtidas INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE novidades ADD COLUMN IF NOT EXISTS autor TEXT NOT NULL DEFAULT 'Distrito RolePlay'`;

    await sql`
      CREATE TABLE IF NOT EXISTS staff (
        nick_lower TEXT PRIMARY KEY,
        nick TEXT NOT NULL,
        cargo SMALLINT NOT NULL DEFAULT 0
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS contas_login (
        nick_lower TEXT PRIMARY KEY,
        nick TEXT NOT NULL,
        hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    // Garante que o admin principal (definido no .env) sempre exista como
    // Dono (cargo 5) na tabela de staff.
    await sql`
      INSERT INTO staff (nick_lower, nick, cargo)
      VALUES (${ADMIN_USER}, ${process.env.ADMIN_USER || 'mitz7'}, 5)
      ON CONFLICT (nick_lower) DO NOTHING
    `;

    // ---------- DEV: barras de progresso do desenvolvimento ----------
    await sql`
      CREATE TABLE IF NOT EXISTS dev_barras (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '🛠',
        porcentagem SMALLINT NOT NULL DEFAULT 0,
        ordem INTEGER NOT NULL DEFAULT 0,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM dev_barras`;
    if (total === 0) {
      const seed = [
        ['Mapa', '🗺', 93],
        ['Interiores', '🏠', 67],
        ['Organizações', '🏛', 20],
        ['Empregos', '💼', 12],
        ['Launchers', '💻', 100],
      ];
      for (let i = 0; i < seed.length; i++) {
        const [nome, emoji, porcentagem] = seed[i];
        await sql`
          INSERT INTO dev_barras (nome, emoji, porcentagem, ordem)
          VALUES (${nome}, ${emoji}, ${porcentagem}, ${i})
        `;
      }
    }
}

// ---------- STATUS ----------
async function getStatus() {
  await garantirSchema();
  const [row] = await sql`SELECT fechado, motivo FROM status WHERE id = 1`;
  return row || { fechado: false, motivo: '' };
}

async function setStatus(fechado, motivo) {
  await garantirSchema();
  await sql`
    UPDATE status SET fechado = ${fechado}, motivo = ${motivo} WHERE id = 1
  `;
  return { fechado, motivo };
}

// ---------- AVISO ----------
async function getAviso() {
  await garantirSchema();
  const [row] = await sql`SELECT texto FROM aviso WHERE id = 1`;
  return row?.texto || '';
}

async function setAviso(texto) {
  await garantirSchema();
  await sql`UPDATE aviso SET texto = ${texto} WHERE id = 1`;
  return texto;
}

// ---------- CONFIG DO SERVIDOR (nome, ícone, banner) ----------
// Só o cargo CEO (4) pode alterar — ver server/api/admin/config-servidor.js
async function getConfigServidor() {
  await garantirSchema();
  const [row] = await sql`SELECT nome, icone, banner, ip, porta, magnet_link FROM config_servidor WHERE id = 1`;
  return row
    ? { ...row, magnetLink: row.magnet_link }
    : { nome: 'Distrito RolePlay', icone: '', banner: '', ip: '181.215.45.74', porta: 7005, magnetLink: '' };
}

async function setConfigServidor({ nome, icone, banner, ip, porta, magnetLink }) {
  await garantirSchema();
  const atual = await getConfigServidor();
  const novo = {
    nome: nome !== undefined ? nome : atual.nome,
    icone: icone !== undefined ? icone : atual.icone,
    banner: banner !== undefined ? banner : atual.banner,
    ip: ip !== undefined ? ip : atual.ip,
    porta: porta !== undefined ? porta : atual.porta,
    magnetLink: magnetLink !== undefined ? magnetLink : atual.magnetLink,
  };
  await sql`
    UPDATE config_servidor
    SET nome = ${novo.nome}, icone = ${novo.icone}, banner = ${novo.banner}, ip = ${novo.ip}, porta = ${novo.porta}, magnet_link = ${novo.magnetLink}
    WHERE id = 1
  `;
  return novo;
}

// ---------- VERSÃO DO LAUNCHER (sistema de atualização obrigatória) ----------
// Só o cargo CEO (4) pode alterar — ver server/api/admin/versao-launcher.js
async function getVersaoLauncher() {
  await garantirSchema();
  const [row] = await sql`SELECT versao, url, notas FROM launcher_versao WHERE id = 1`;
  return row || { versao: '1.0.0', url: '', notas: '' };
}

async function setVersaoLauncher({ versao, url, notas }) {
  await garantirSchema();
  const atual = await getVersaoLauncher();
  const novo = {
    versao: versao !== undefined ? versao : atual.versao,
    url: url !== undefined ? url : atual.url,
    notas: notas !== undefined ? notas : atual.notas,
  };
  await sql`
    UPDATE launcher_versao SET versao = ${novo.versao}, url = ${novo.url}, notas = ${novo.notas} WHERE id = 1
  `;
  return novo;
}

// ---------- VERSÃO DA DATA (histórico de patches) ----------
// `versao` aqui é um número inteiro que só sobe (1, 2, 3...) — bem mais
// simples que o "x.y.z" do launcher, já que patch de data não tem a
// necessidade de versionamento semântico, só "isso é mais novo que aquilo".
// Cada publicação vira uma LINHA NOVA em data_patches (nunca sobrescreve uma
// anterior) — é isso que permite um player recuperar TODO o histórico de
// patches de uma vez, não só o mais recente.

// Garante um inteiro >= 0 a partir de qualquer valor. Existe pra lidar com
// entradas sujas (ex: um valor antigo tipo "1.0.1" salvo antes dessa
// validação existir) — sem essa limpeza, Number("1.0.1") vira NaN e as
// comparações de "tem patch novo?" falham silenciosamente.
function sanitizarVersaoData(valor) {
  if (Number.isInteger(valor) && valor >= 0) return valor;
  const digitos = String(valor ?? '').replace(/[^0-9]/g, '');
  const n = parseInt(digitos, 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

// Resumo: só a versão mais recente publicada — usado no painel admin pra
// mostrar "versão atual" e sugerir a próxima.
async function getVersaoData() {
  await garantirSchema();
  const [row] = await sql`SELECT versao, url, notas FROM data_patches ORDER BY versao DESC LIMIT 1`;
  return row || { versao: 0, url: '', notas: '' };
}

// Publica um patch novo. Se a mesma versão for enviada de novo (ex: CEO
// corrigindo um link quebrado), atualiza o link/notas em vez de duplicar.
async function setVersaoData({ versao, url, notas }) {
  await garantirSchema();
  const versaoLimpa = sanitizarVersaoData(versao);
  if (versaoLimpa <= 0 || !url) {
    throw new Error('Versão (inteiro > 0) e link são obrigatórios pra publicar um patch.');
  }
  const notasLimpas = notas || '';
  const [row] = await sql`
    INSERT INTO data_patches (versao, url, notas)
    VALUES (${versaoLimpa}, ${url}, ${notasLimpas})
    ON CONFLICT (versao) DO UPDATE SET url = ${url}, notas = ${notasLimpas}
    RETURNING versao, url, notas
  `;
  return row;
}

// Todos os patches com versão MAIOR que `desde`, em ordem crescente — é essa
// lista que o launcher baixa e aplica de uma vez (player novo pegando tudo
// desde o zero, ou alguém que ficou várias versões pra trás).
async function getPatchesDataDesde(desde) {
  await garantirSchema();
  const desdeLimpo = sanitizarVersaoData(desde);
  const rows = await sql`
    SELECT versao, url, notas FROM data_patches
    WHERE versao > ${desdeLimpo}
    ORDER BY versao ASC
  `;
  return rows;
}

// ---------- NOVIDADES ----------
const NOV_COLS = sql => sql`id, tipo, titulo, texto, imagem, gif, banner, categoria, fixado, destaque, curtidas, autor, criado_em`;

async function getNovidades() {
  await garantirSchema();
  const rows = await sql`
    SELECT id, tipo, titulo, texto, imagem, gif, banner, categoria, fixado, destaque, curtidas, autor, criado_em
    FROM novidades
    ORDER BY fixado DESC, destaque DESC, criado_em DESC
  `;
  return rows;
}

async function addNovidade(dados) {
  await garantirSchema();
  const {
    texto = '', tipo = 'novo', titulo = '', imagem = null, gif = null,
    banner = false, categoria = 'geral', fixado = false, destaque = false,
    autor = 'Distrito RolePlay',
  } = dados || {};
  const [row] = await sql`
    INSERT INTO novidades (texto, tipo, titulo, imagem, gif, banner, categoria, fixado, destaque, autor)
    VALUES (${texto}, ${tipo}, ${titulo}, ${imagem}, ${gif}, ${banner}, ${categoria}, ${fixado}, ${destaque}, ${autor})
    RETURNING id, tipo, titulo, texto, imagem, gif, banner, categoria, fixado, destaque, curtidas, autor, criado_em
  `;
  return row;
}

async function removeNovidade(id) {
  await garantirSchema();
  await sql`DELETE FROM novidades WHERE id = ${id}`;
}

async function curtirNovidade(id) {
  await garantirSchema();
  const [row] = await sql`
    UPDATE novidades SET curtidas = curtidas + 1 WHERE id = ${id}
    RETURNING id, curtidas
  `;
  return row;
}

// ---------- STAFF ----------
async function getStaffLista() {
  await garantirSchema();
  const rows = await sql`SELECT nick, cargo FROM staff ORDER BY cargo DESC, nick ASC`;
  return rows;
}

async function getCargo(nick) {
  await garantirSchema();
  const nickLower = (nick || '').toLowerCase();
  const [row] = await sql`SELECT cargo FROM staff WHERE nick_lower = ${nickLower}`;
  return row ? row.cargo : 0;
}

async function setCargo(nick, cargo) {
  await garantirSchema();
  const nickLower = nick.trim().toLowerCase();
  await sql`
    INSERT INTO staff (nick_lower, nick, cargo)
    VALUES (${nickLower}, ${nick.trim()}, ${cargo})
    ON CONFLICT (nick_lower) DO UPDATE SET cargo = ${cargo}, nick = ${nick.trim()}
  `;
  return getStaffLista();
}

async function removerStaff(nick) {
  await garantirSchema();
  const nickLower = nick.toLowerCase();
  await sql`DELETE FROM staff WHERE nick_lower = ${nickLower}`;
  return getStaffLista();
}

// ---------- CONTAS (login usuário/senha) ----------
async function buscarContaLogin(nick) {
  await garantirSchema();
  const nickLower = nick.toLowerCase();
  const [row] = await sql`SELECT nick, hash, salt, criado_em FROM contas_login WHERE nick_lower = ${nickLower}`;
  return row || null;
}

async function criarContaLogin(nick, hash, salt) {
  await garantirSchema();
  const nickLower = nick.trim().toLowerCase();
  const [row] = await sql`
    INSERT INTO contas_login (nick_lower, nick, hash, salt)
    VALUES (${nickLower}, ${nick.trim()}, ${hash}, ${salt})
    ON CONFLICT (nick_lower) DO NOTHING
    RETURNING nick, criado_em
  `;
  return row;
}

// ---------- SESSÕES DE JOGO (login automático launcher -> servidor) ----------
// Fluxo: o launcher já autenticou o player (conta_login). Antes de abrir o
// samp.exe, ele chama /api/conta/iniciar-sessao-jogo com o token da conta.
// Isso grava aqui (nick + IP público de quem chamou, com validade curta).
// Quando o player conecta no servidor SA-MP, a gamemode chama
// /api/conta/verificar-sessao-jogo com o nick e o IP com que o player
// conectou. Se bater com uma sessão pendente (mesmo nick, mesmo IP, ainda
// dentro da validade, ainda não usada), a gamemode loga o player direto,
// sem pedir usuário/senha de novo. Quem conectar direto pelo samp.exe (sem
// passar pelo launcher) nunca vai ter uma sessão pendente batendo, então a
// gamemode cai no dialog de login normal.
async function criarSessaoJogo(nick, ip) {
  await garantirSchema();
  const nickLower = nick.trim().toLowerCase();
  // Uma sessão pendente por nick — se o player clicar "Jogar" de novo antes
  // de conectar, a mais nova substitui a anterior.
  await sql`
    INSERT INTO sessoes_jogo (nick_lower, nick, ip, criado_em, usado)
    VALUES (${nickLower}, ${nick.trim()}, ${ip}, now(), false)
    ON CONFLICT (nick_lower) DO UPDATE
      SET nick = EXCLUDED.nick, ip = EXCLUDED.ip, criado_em = now(), usado = false
  `;
}

// validadeSegundos: tempo máximo entre "iniciar-sessao-jogo" (clicou Jogar
// no launcher) e o player realmente conectar no servidor SA-MP.
async function consumirSessaoJogo(nick, ip, validadeSegundos = 180) {
  await garantirSchema();
  const nickLower = nick.trim().toLowerCase();
  const [row] = await sql`
    UPDATE sessoes_jogo
    SET usado = true
    WHERE nick_lower = ${nickLower}
      AND ip = ${ip}
      AND usado = false
      AND criado_em > now() - (${validadeSegundos} || ' seconds')::interval
    RETURNING nick
  `;
  return !!row;
}

// ---------- DEV: barras de progresso do desenvolvimento ----------
async function getBarrasDev() {
  await garantirSchema();
  const rows = await sql`
    SELECT id, nome, emoji, porcentagem, ordem, atualizado_em
    FROM dev_barras
    ORDER BY ordem ASC, id ASC
  `;
  return rows;
}

async function addBarraDev(dados) {
  await garantirSchema();
  const { nome, emoji = '🛠', porcentagem = 0 } = dados || {};
  const [{ max_ordem }] = await sql`SELECT COALESCE(MAX(ordem), -1) AS max_ordem FROM dev_barras`;
  const [row] = await sql`
    INSERT INTO dev_barras (nome, emoji, porcentagem, ordem)
    VALUES (${nome}, ${emoji}, ${porcentagem}, ${max_ordem + 1})
    RETURNING id, nome, emoji, porcentagem, ordem, atualizado_em
  `;
  return row;
}

async function updateBarraDev(id, dados) {
  await garantirSchema();
  const atual = (await sql`SELECT id, nome, emoji, porcentagem FROM dev_barras WHERE id = ${id}`)[0];
  if (!atual) return null;
  const nome = dados.nome !== undefined ? dados.nome : atual.nome;
  const emoji = dados.emoji !== undefined ? dados.emoji : atual.emoji;
  const porcentagem = dados.porcentagem !== undefined ? dados.porcentagem : atual.porcentagem;
  const [row] = await sql`
    UPDATE dev_barras
    SET nome = ${nome}, emoji = ${emoji}, porcentagem = ${porcentagem}, atualizado_em = now()
    WHERE id = ${id}
    RETURNING id, nome, emoji, porcentagem, ordem, atualizado_em
  `;
  return row;
}

async function removeBarraDev(id) {
  await garantirSchema();
  await sql`DELETE FROM dev_barras WHERE id = ${id}`;
}

module.exports = {
  ADMIN_USER,
  getStatus, setStatus,
  getAviso, setAviso,
  getConfigServidor, setConfigServidor,
  getVersaoLauncher, setVersaoLauncher,
  getVersaoData, setVersaoData, getPatchesDataDesde,
  getNovidades, addNovidade, removeNovidade, curtirNovidade,
  getStaffLista, getCargo, setCargo, removerStaff,
  buscarContaLogin, criarContaLogin,
  criarSessaoJogo, consumirSessaoJogo,
  getBarrasDev, addBarraDev, updateBarraDev, removeBarraDev,
};
