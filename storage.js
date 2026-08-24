const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const COUPONS_FILE = path.join(DATA_DIR, 'coupons.json');
const PARTNERS_FILE = path.join(DATA_DIR, 'partners.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const MATERIAL_FACTORS_FILE = path.join(DATA_DIR, 'material-factors.json');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');

let sql = null;
let cloud = false;
let state = {
  db: { users: [], sessions: [], scans: [], redemptions: [], rides: [], preferences: [] },
  coupons: [], partners: [], products: [], materialFactors: {},
  admins: [], adminSessions: []
};
let persistChain = Promise.resolve();

function readFileJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function localState() {
  const db = readFileJson(DB_FILE, state.db);
  const adminsRaw = readFileJson(ADMINS_FILE, { admins: [], sessions: [] });
  return {
    db: {
      users: Array.isArray(db.users) ? db.users : [],
      sessions: Array.isArray(db.sessions) ? db.sessions : [],
      scans: Array.isArray(db.scans) ? db.scans : [],
      redemptions: Array.isArray(db.redemptions) ? db.redemptions : [],
      rides: Array.isArray(db.rides) ? db.rides : [],
      preferences: Array.isArray(db.preferences) ? db.preferences : []
    },
    coupons: readFileJson(COUPONS_FILE, []),
    partners: readFileJson(PARTNERS_FILE, []),
    products: readFileJson(PRODUCTS_FILE, []),
    materialFactors: readFileJson(MATERIAL_FACTORS_FILE, {}),
    admins: Array.isArray(adminsRaw.admins) ? adminsRaw.admins : [],
    adminSessions: Array.isArray(adminsRaw.sessions) ? adminsRaw.sessions : []
  };
}

function localWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

async function initStorage() {
  if (!process.env.DATABASE_URL) {
    cloud = false;
    state = localState();
    return { cloud: false };
  }

  sql = postgres(process.env.DATABASE_URL, {
    max: Number(process.env.DB_POOL_MAX || 5),
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    ssl: process.env.DATABASE_SSL === 'false' ? false : 'require'
  });

  await sql`
    CREATE TABLE IF NOT EXISTS ecoviva_state (
      id SMALLINT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const rows = await sql`SELECT payload FROM ecoviva_state WHERE id = 1`;
  if (rows.length) {
    const p = rows[0].payload || {};
    state = {
      db: p.db || state.db,
      coupons: p.coupons || [],
      partners: p.partners || [],
      products: p.products || [],
      materialFactors: p.materialFactors || {},
      admins: p.admins || [],
      adminSessions: p.adminSessions || []
    };
  } else {
    state = localState();
    // Never upload local users/sessions/admins from the development machine.
    // Production starts clean, while the environmental methodology can be seeded.
    state.db.users = [];
    state.db.sessions = [];
    state.db.scans = [];
    state.db.redemptions = [];
    state.db.rides = [];
    state.db.preferences = [];
    state.admins = [];
    state.adminSessions = [];
    state.partners = [];
    state.coupons = [];
    state.products = [];
    if (!state.materialFactors || !Object.keys(state.materialFactors).length) {
      state.materialFactors = localState().materialFactors;
    }
    await sql`
      INSERT INTO ecoviva_state (id, payload) VALUES (1, ${sql.json(state)}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
  }
  cloud = true;
  return { cloud: true };
}

function getState() { return state; }
function isCloud() { return cloud; }

function persist() {
  if (!cloud) return Promise.resolve();
  const snapshot = JSON.parse(JSON.stringify(state));
  persistChain = persistChain.then(() => sql`
    UPDATE ecoviva_state SET payload = ${sql.json(snapshot)}::jsonb, updated_at = NOW() WHERE id = 1
  `).catch(err => console.error('Erro ao persistir estado no PostgreSQL:', err));
  return persistChain;
}

function markChanged() {
  return persist();
}

async function close() {
  await persist();
  if (sql) await sql.end({ timeout: 5 });
}

module.exports = { initStorage, getState, isCloud, markChanged, close };
