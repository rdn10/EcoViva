require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { initStorage, getState, isCloud, markChanged, close: closeStorage } = require('./storage');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');

const COUPONS_FILE = path.join(DATA_DIR, 'coupons.json');
const PARTNERS_FILE = path.join(DATA_DIR, 'partners.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const MATERIAL_FACTORS_FILE = path.join(DATA_DIR, 'material-factors.json');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');

const ADMIN_SETUP_KEY_FILE = path.join(DATA_DIR, 'admin-setup-key.txt');const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = 7;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function readDb() { return getState().db; }
function writeDb(db) { getState().db = db; markChanged(); }
function readJsonFile(file, fallback=[]) {
  const state = getState();
  if (file.endsWith('coupons.json')) return state.coupons;
  if (file.endsWith('partners.json')) return state.partners;
  if (file.endsWith('products.json')) return state.products;
  if (file.endsWith('material-factors.json')) return state.materialFactors;
  if (file.endsWith('admins.json')) return {admins:state.admins,sessions:state.adminSessions};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonFile(file, data) {
  const state = getState();
  if (file.endsWith('coupons.json')) state.coupons = data;
  else if (file.endsWith('partners.json')) state.partners = data;
  else if (file.endsWith('products.json')) state.products = data;
  else if (file.endsWith('material-factors.json')) state.materialFactors = data;
  else if (file.endsWith('admins.json')) { state.admins = data.admins || []; state.adminSessions = data.sessions || []; }
  else {
    const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file);
  }
  markChanged();
}
function adminCatalog() { return {admins:getState().admins, sessions:getState().adminSessions}; }

function id(prefix) { return `${prefix}_${crypto.randomBytes(12).toString('hex')}`; }
function now() { return new Date().toISOString(); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, user) {
  const hash = crypto.scryptSync(password, user.passwordSalt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}
function cleanEmail(v) { return String(v || '').trim().toLowerCase(); }
function cleanName(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionUser(req, db) {
  const token = parseCookies(req).eco_session;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = db.sessions.find(s => s.tokenHash === tokenHash);
  if (!session || new Date(session.expiresAt) <= new Date()) return null;
  return db.users.find(u => u.id === session.userId) || null;
}
function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const db = readDb();
  db.sessions = db.sessions.filter(s => new Date(s.expiresAt) > new Date());
  db.sessions.push({ id: id('sess'), userId, tokenHash: hashToken(token), createdAt: now(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() });
  writeDb(db);
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `eco_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
function clearSession(req, res) {
  const token = parseCookies(req).eco_session;
  if (token) {
    const db = readDb();
    db.sessions = db.sessions.filter(s => s.tokenHash !== hashToken(token));
    writeDb(db);
  }
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `eco_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}
function publicUser(user) {
  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone || '', city: user.city || '', bio: user.bio || '',
    avatar: user.avatar || '', address: user.address || { cep:'', street:'', number:'', complement:'', neighborhood:'', city:'', state:'' }, createdAt: user.createdAt
  };
}
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendError(res, status, message) { sendJson(res, status, { ok: false, error: message }); }
function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}
function requireUser(req, res) {
  const db = readDb();
  const user = sessionUser(req, db);
  if (!user) { sendError(res, 401, 'LOGIN_REQUIRED'); return null; }
  return user;
}
function statsFor(userId, db) {
  const scans = db.scans.filter(x => x.userId === userId);
  const redemptions = db.redemptions.filter(x => x.userId === userId);
  const points = userPoints(userId, db);
  const energyValues=scans.filter(x=>x.energyKwh!=null).map(x=>Number(x.energyKwh||0)); const treeValues=scans.filter(x=>x.treeEquivalent!=null).map(x=>Number(x.treeEquivalent||0)); return { points, scans: scans.length, redemptions: redemptions.length, co2: +(scans.reduce((a,x)=>a+Number(x.co2Kg||0),0)).toFixed(3), water: scans.some(x=>x.waterLiters!=null) ? +scans.reduce((a,x)=>a+Number(x.waterLiters||0),0).toFixed(2) : null, trees: treeValues.length ? +treeValues.reduce((a,x)=>a+x,0).toFixed(3) : null, energy: energyValues.length ? +energyValues.reduce((a,x)=>a+x,0).toFixed(2) : null, level: Math.max(1, Math.floor(points / 500) + 1) };
}
function userPoints(userId, db) {
  const earned = db.scans.filter(x=>x.userId===userId).reduce((a,x)=>a+x.points,0);
  const spent = db.redemptions.filter(x=>x.userId===userId).reduce((a,x)=>a+x.cost,0);
  return Math.max(0, earned - spent);
}
function normalizePackageCode(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}
function isValidGTIN(code) {
  const value = normalizePackageCode(code);
  if (![8, 12, 13, 14].includes(value.length)) return false;
  const digits = value.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--, weight = weight === 3 ? 1 : 3) sum += digits[i] * weight;
  return (10 - (sum % 10)) % 10 === check;
}
async function lookupProduct(code) {
  const value = normalizePackageCode(code);
  if (!isValidGTIN(value)) return { found: false, code: value, reason: 'invalid_code' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(value)}?product_type=all&fields=code,product_name,product_name_pt,brands,image_front_url,quantity,categories,packaging,product_type`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'EcoViva/1.0 (barcode lookup)' },
      signal: controller.signal,
      redirect: 'follow'
    });
    if (!response.ok) return { found: false, code: value, reason: `upstream_${response.status}` };
    const data = await response.json();
    if (data.status !== 1 || !data.product) return { found: false, code: value, reason: 'not_found' };
    const p = data.product;
    return {
      found: true,
      code: value,
      name: p.product_name_pt || p.product_name || 'Produto sem nome cadastrado',
      brand: p.brands || '',
      image: p.image_front_url || '',
      quantity: p.quantity || '',
      categories: Array.isArray(p.categories_tags) ? p.categories_tags.slice(0, 8) : [],
      packaging: p.packaging || '',
      productType: p.product_type || ''
    };
  } catch (err) {
    return { found: false, code: value, reason: err.name === 'AbortError' ? 'timeout' : 'lookup_error' };
  } finally {
    clearTimeout(timeout);
  }
}

function addressComplete(address) {
  if (!address) return false;
  return ['cep','street','number','neighborhood','city','state'].every(k => String(address[k] || '').trim());
}
function couponCatalog() { return readJsonFile(COUPONS_FILE, []).filter(c => c && c.active !== false); }
function partnerCatalog() { return readJsonFile(PARTNERS_FILE, []).filter(p => p && p.active !== false); }
function productCatalog() { return readJsonFile(PRODUCTS_FILE, []).filter(p => p && p.active !== false); }
function materialFactors() { return readJsonFile(MATERIAL_FACTORS_FILE, {}); }
function findMaterialFactor(material) { return materialFactors()[String(material||'').trim().toLowerCase()] || null; }
function findConfiguredProduct(code, userId) { const value=normalizePackageCode(code); return productCatalog().find(p=>normalizePackageCode(p.code)===value && (!userId || p.ownerUserId===userId)) || null; }
function productReady(product) { if(!product) return false; const f=findMaterialFactor(product.material); return !!(f || (String(product.source||'').trim() && [product.pointsPerKg,product.co2PerKg,product.waterPerKg,product.treePerKg,product.energyPerKg].some(v=>Number(v)>0))); }
function adminSession(req) {
  const token = parseCookies(req).eco_admin_session;
  if (!token) return null;
  const db = adminCatalog();
  const sessions = db.sessions || [];
  const s = sessions.find(x => x.tokenHash === hashToken(token));
  if (!s || new Date(s.expiresAt) <= new Date()) return null;
  return db.admins.find(a => a.id === s.adminId) || null;
}
function setAdminSession(res, adminId) {
  const data = adminCatalog();
  data.sessions = (data.sessions || []).filter(s => new Date(s.expiresAt) > new Date());
  const token = crypto.randomBytes(32).toString('hex');
  data.sessions.push({ id:id('asess'), adminId, tokenHash:hashToken(token), createdAt:now(), expiresAt:new Date(Date.now()+SESSION_DAYS*86400000).toISOString() });
  writeJsonFile(ADMINS_FILE, data);
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `eco_admin_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS*86400}${secure}`);
}
function clearAdminSession(req,res) {
  const token=parseCookies(req).eco_admin_session;
  if(token){ const data=adminCatalog(); data.sessions=(data.sessions||[]).filter(s=>s.tokenHash!==hashToken(token)); writeJsonFile(ADMINS_FILE,data); }
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie',`eco_admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}
function requireAdmin(req,res){
  const admin=adminSession(req);
  if(!admin){sendError(res,401,'ADMIN_LOGIN_REQUIRED');return null;}
  return admin;
}
function publicAdmin(a){return {id:a.id,name:a.name,email:a.email,createdAt:a.createdAt};}
function setupKey(){
  if(process.env.ADMIN_SETUP_KEY) return String(process.env.ADMIN_SETUP_KEY);
  if(!fs.existsSync(ADMIN_SETUP_KEY_FILE)) fs.writeFileSync(ADMIN_SETUP_KEY_FILE, crypto.randomBytes(18).toString('hex'), {mode:0o600});
  return fs.readFileSync(ADMIN_SETUP_KEY_FILE,'utf8').trim();
}
function hasAdmin(){return adminCatalog().admins?.length>0;}
function adminStats(){
  const db=readDb(), partners=partnerCatalog(), coupons=couponCatalog(), products=productCatalog();
  const users=db.users||[], scans=db.scans||[], red=db.redemptions||[];
  return {
    users:users.length,
    scans:scans.length,
    pointsIssued:scans.reduce((a,x)=>a+Number(x.points||0),0),
    pointsSpent:red.reduce((a,x)=>a+Number(x.cost||0),0),
    redemptions:red.length,
    partners:partners.length,
    activeCoupons:coupons.length,
    configuredProducts:products.length,
    usersWithAddress:users.filter(u=>addressComplete(u.address)).length
  };
}

function cleanup() {

  const db = readDb();
  db.sessions = db.sessions.filter(s => new Date(s.expiresAt) > new Date());
  writeDb(db);
}

async function api(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'ecoviva', storage: isCloud() ? 'postgresql' : 'local' });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/setup/status') {
      return sendJson(res,200,{ok:true,setupRequired:!hasAdmin(), setupKeyHint:process.env.ADMIN_SETUP_KEY?'env':'terminal'});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/setup') {
      if(hasAdmin()) return sendError(res,409,'O administrador já foi configurado.');
      const data=await body(req);
      if(String(data.setupKey||'')!==setupKey()) return sendError(res,403,'Chave de configuração inválida.');
      const name=cleanName(data.name),email=cleanEmail(data.email),password=String(data.password||'');
      if(name.length<2)return sendError(res,400,'Informe o nome do administrador.');
      if(!/^\S+@\S+\.\S+$/.test(email))return sendError(res,400,'Informe um e-mail válido.');
      if(password.length<10)return sendError(res,400,'A senha do administrador deve ter pelo menos 10 caracteres.');
      const pw=hashPassword(password);
      writeJsonFile(ADMINS_FILE,{admins:[{id:id('adm'),name,email,passwordHash:pw.hash,passwordSalt:pw.salt,createdAt:now()}],sessions:[]});
      try{if(!process.env.ADMIN_SETUP_KEY&&fs.existsSync(ADMIN_SETUP_KEY_FILE))fs.unlinkSync(ADMIN_SETUP_KEY_FILE)}catch{}
      return sendJson(res,201,{ok:true});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const data=await body(req),email=cleanEmail(data.email),password=String(data.password||''),admins=adminCatalog().admins||[];
      const admin=admins.find(a=>a.email===email);
      if(!admin||!verifyPassword(password,admin))return sendError(res,401,'Credenciais do administrador incorretas.');
      setAdminSession(res,admin.id);return sendJson(res,200,{ok:true,admin:publicAdmin(admin)});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/me') {
      const admin=adminSession(req);if(!admin)return sendJson(res,200,{ok:true,authenticated:false,setupRequired:!hasAdmin()});
      return sendJson(res,200,{ok:true,authenticated:true,admin:publicAdmin(admin)});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {clearAdminSession(req,res);return sendJson(res,200,{ok:true});}
    if (req.method === 'GET' && url.pathname === '/api/admin/dashboard') {
      const admin=requireAdmin(req,res);if(!admin)return;
      const db=readDb();
      return sendJson(res,200,{ok:true,admin:publicAdmin(admin),stats:adminStats(),recentScans:(db.scans||[]).slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,10),recentRedemptions:(db.redemptions||[]).slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,10)});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/partners') {
      const admin=requireAdmin(req,res);if(!admin)return;return sendJson(res,200,{ok:true,partners:partnerCatalog()});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/partners') {
      const admin=requireAdmin(req,res);if(!admin)return;const data=await body(req);
      const name=cleanName(data.name),category=String(data.category||'').trim(),description=String(data.description||'').trim(),benefit=String(data.benefit||'').trim(),website=String(data.website||'').trim();
      if(!name||!category)return sendError(res,400,'Nome e categoria são obrigatórios.');
      const partners=partnerCatalog();if(partners.some(p=>p.name.toLowerCase()===name.toLowerCase()))return sendError(res,409,'Empresa já cadastrada.');
      const partner={id:id('partner'),name,category,description,benefit,website,createdAt:now(),active:true};partners.push(partner);writeJsonFile(PARTNERS_FILE,partners);return sendJson(res,201,{ok:true,partner});
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/partners/')) {
      const admin=requireAdmin(req,res);if(!admin)return;const pid=url.pathname.split('/').pop(),data=await body(req),partners=partnerCatalog(),p=partners.find(x=>x.id===pid);if(!p)return sendError(res,404,'Parceiro não encontrado.');
      if(data.name!==undefined)p.name=cleanName(data.name);if(data.category!==undefined)p.category=String(data.category||'').trim();if(data.description!==undefined)p.description=String(data.description||'').trim();if(data.benefit!==undefined)p.benefit=String(data.benefit||'').trim();if(data.website!==undefined)p.website=String(data.website||'').trim();if(data.active!==undefined)p.active=!!data.active;writeJsonFile(PARTNERS_FILE,partners);return sendJson(res,200,{ok:true,partner:p});
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/partners/')) {
      const admin=requireAdmin(req,res);if(!admin)return;const pid=url.pathname.split('/').pop(),partners=partnerCatalog();if(!partners.some(x=>x.id===pid))return sendError(res,404,'Parceiro não encontrado.');writeJsonFile(PARTNERS_FILE,partners.filter(x=>x.id!==pid));
      const coupons=couponCatalog();writeJsonFile(COUPONS_FILE,coupons.filter(c=>c.partnerId!==pid));return sendJson(res,200,{ok:true});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/coupons') {
      const admin=requireAdmin(req,res);if(!admin)return;return sendJson(res,200,{ok:true,coupons:couponCatalog(),partners:partnerCatalog()});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/coupons') {
      const admin=requireAdmin(req,res);if(!admin)return;const data=await body(req),partners=partnerCatalog(),partner=partners.find(p=>p.id===data.partnerId);if(!partner)return sendError(res,400,'Selecione um parceiro cadastrado.');
      const title=String(data.title||'').trim(),discount=String(data.discount||'').trim(),code=String(data.code||'').trim().toUpperCase(),description=String(data.description||'').trim(),pointsCost=Number(data.pointsCost||0),validUntil=data.validUntil?new Date(data.validUntil).toISOString():null;
      if(!title||!discount||!code||!description||!Number.isFinite(pointsCost)||pointsCost<=0)return sendError(res,400,'Preencha título, desconto, código, descrição e custo em pontos.');
      const coupons=couponCatalog();
      if(coupons.some(x=>String(x.code||'').toUpperCase()===code))return sendError(res,409,'Esse código de cupom já está cadastrado.');
      const coupon={id:id('coupon'),partnerId:partner.id,partner:partner.name,title,discount,code,description,pointsCost,validUntil,category:partner.category,createdAt:now(),active:true};coupons.push(coupon);writeJsonFile(COUPONS_FILE,coupons);return sendJson(res,201,{ok:true,coupon});
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/coupons/')) {
      const admin=requireAdmin(req,res);if(!admin)return;const cid=url.pathname.split('/').pop(),data=await body(req),coupons=couponCatalog(),c=coupons.find(x=>x.id===cid);if(!c)return sendError(res,404,'Cupom não encontrado.');
      if(data.code!==undefined){const code=String(data.code||'').trim().toUpperCase();if(!code)return sendError(res,400,'Informe o código do cupom.');if(coupons.some(x=>x.id!==cid&&String(x.code||'').toUpperCase()===code))return sendError(res,409,'Esse código de cupom já está cadastrado.');c.code=code;}if(data.title!==undefined)c.title=String(data.title||'').trim();if(data.discount!==undefined)c.discount=String(data.discount||'').trim();if(data.description!==undefined)c.description=String(data.description||'').trim();if(data.pointsCost!==undefined)c.pointsCost=Number(data.pointsCost||0);if(data.validUntil!==undefined)c.validUntil=data.validUntil?new Date(data.validUntil).toISOString():null;if(data.active!==undefined)c.active=!!data.active;
      if(data.partnerId!==undefined){const partner=partnerCatalog().find(p=>p.id===data.partnerId);if(!partner)return sendError(res,400,'Parceiro inválido.');c.partnerId=partner.id;c.partner=partner.name;c.category=partner.category;}
      writeJsonFile(COUPONS_FILE,coupons);return sendJson(res,200,{ok:true,coupon:c});
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/coupons/')) {
      const admin=requireAdmin(req,res);if(!admin)return;const cid=url.pathname.split('/').pop(),coupons=couponCatalog();if(!coupons.some(x=>x.id===cid))return sendError(res,404,'Cupom não encontrado.');writeJsonFile(COUPONS_FILE,coupons.filter(x=>x.id!==cid));return sendJson(res,200,{ok:true});
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/material-factors') {
      const admin=requireAdmin(req,res); if(!admin)return;
      return sendJson(res,200,{ok:true,factors:materialFactors()});
    }
    if (req.method === 'PUT' && url.pathname === '/api/admin/material-factors') {
      const admin=requireAdmin(req,res); if(!admin)return;
      const data=await body(req), material=String(data.material||'').trim().toLowerCase();
      const pointsPerKg=Number(data.pointsPerKg),co2PerKg=Number(data.co2PerKg); const waterPerKg=data.waterPerKg===''||data.waterPerKg==null?null:Number(data.waterPerKg); const treePerKg=data.treePerKg===''||data.treePerKg==null?null:Number(data.treePerKg); const energyPerKg=data.energyPerKg===''||data.energyPerKg==null?null:Number(data.energyPerKg); const source=String(data.source||'').trim();
      if(!['plastico','papel','vidro','metal','outro'].includes(material))return sendError(res,400,'Material inválido.');
      if(!Number.isFinite(pointsPerKg)||!Number.isFinite(co2PerKg)||pointsPerKg<0||co2PerKg<0 || (waterPerKg!==null && (!Number.isFinite(waterPerKg)||waterPerKg<0)) || (treePerKg!==null && (!Number.isFinite(treePerKg)||treePerKg<0)) || (energyPerKg!==null && (!Number.isFinite(energyPerKg)||energyPerKg<0)))return sendError(res,400,'Informe fatores válidos.');
      if(!source)return sendError(res,400,'Informe a fonte dos fatores.');
      const factors=materialFactors();factors[material]={pointsPerKg,co2PerKg,waterPerKg,treePerKg,energyPerKg,source,updatedAt:now()};writeJsonFile(MATERIAL_FACTORS_FILE,factors);
      return sendJson(res,200,{ok:true,factor:factors[material]});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/products') {
      const admin=requireAdmin(req,res); if(!admin)return;
      return sendJson(res,200,{ok:true,products:productCatalog()});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/products') {
      const admin=requireAdmin(req,res); if(!admin)return;
      const data=await body(req);
      const code=normalizePackageCode(data.code), name=String(data.name||'').trim(), brand=String(data.brand||'').trim();
      const material=String(data.material||'').trim().toLowerCase();
      const weightGrams=Number(data.weightGrams), pointsPerKg=Number(data.pointsPerKg), co2PerKg=Number(data.co2PerKg), waterPerKg=Number(data.waterPerKg), treePerKg=Number(data.treePerKg);
      const source=String(data.source||'').trim();
      if(!code||!isValidGTIN(code))return sendError(res,400,'Informe um código EAN/GTIN válido.');
      if(!name||!material||!Number.isFinite(weightGrams)||weightGrams<=0)return sendError(res,400,'Informe nome, material e peso da embalagem.');
      if(!Number.isFinite(pointsPerKg)||pointsPerKg<0||!Number.isFinite(co2PerKg)||co2PerKg<0||!Number.isFinite(waterPerKg)||waterPerKg<0||!Number.isFinite(treePerKg)||treePerKg<0)return sendError(res,400,'Informe fatores ambientais válidos.');
      if(!source)return sendError(res,400,'Informe a fonte dos fatores ambientais.');
      const products=productCatalog(); if(products.some(p=>normalizePackageCode(p.code)===code))return sendError(res,409,'Esse código já está cadastrado no catálogo Eco Viva.');
      const product={id:id('product'),code,name,brand,material,weightGrams,pointsPerKg,co2PerKg,waterPerKg,treePerKg,source,createdAt:now(),active:true};
      products.push(product);writeJsonFile(PRODUCTS_FILE,products);return sendJson(res,201,{ok:true,product});
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/products/')) {
      const admin=requireAdmin(req,res); if(!admin)return;
      const pid=url.pathname.split('/').pop(),data=await body(req),products=productCatalog(),p=products.find(x=>x.id===pid); if(!p)return sendError(res,404,'Produto não encontrado.');
      if(data.code!==undefined){const code=normalizePackageCode(data.code);if(!isValidGTIN(code))return sendError(res,400,'Código EAN/GTIN inválido.');if(products.some(x=>x.id!==pid&&normalizePackageCode(x.code)===code))return sendError(res,409,'Esse código já está cadastrado.');p.code=code;}
      if(data.name!==undefined)p.name=String(data.name||'').trim();if(data.brand!==undefined)p.brand=String(data.brand||'').trim();if(data.material!==undefined)p.material=String(data.material||'').trim().toLowerCase();
      for(const k of ['weightGrams','pointsPerKg','co2PerKg','waterPerKg','treePerKg'])if(data[k]!==undefined)p[k]=Number(data[k]);
      if(data.source!==undefined)p.source=String(data.source||'').trim();if(data.active!==undefined)p.active=!!data.active;
      if(!p.name||!p.material||!Number.isFinite(p.weightGrams)||p.weightGrams<=0||!p.source)return sendError(res,400,'Produto incompleto.');
      writeJsonFile(PRODUCTS_FILE,products);return sendJson(res,200,{ok:true,product:p});
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/products/')) {
      const admin=requireAdmin(req,res); if(!admin)return; const pid=url.pathname.split('/').pop(),products=productCatalog(); if(!products.some(p=>p.id===pid))return sendError(res,404,'Produto não encontrado.'); writeJsonFile(PRODUCTS_FILE,products.filter(p=>p.id!==pid)); return sendJson(res,200,{ok:true});
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const data = await body(req);
      const name = cleanName(data.name), email = cleanEmail(data.email), password = String(data.password || '');
      if (name.length < 2) return sendError(res, 400, 'Digite seu nome completo.');

      if (!/^\S+@\S+\.\S+$/.test(email)) return sendError(res, 400, 'Digite um e-mail válido.');
      if (password.length < 6) return sendError(res, 400, 'A senha precisa ter pelo menos 6 caracteres.');
      if (password !== String(data.confirmPassword || '')) return sendError(res, 400, 'As senhas não coincidem.');
      const db = readDb();
      if (db.users.some(u=>u.email===email)) return sendError(res, 409, 'E-mail já cadastrado.');
      const pw = hashPassword(password);
      const user = { id:id('usr'), name, email, passwordHash:pw.hash, passwordSalt:pw.salt, phone:'', city:'', bio:'', avatar:'', address:{cep:'',street:'',number:'',complement:'',neighborhood:'',city:'',state:''}, createdAt:now() };
      db.users.push(user); db.preferences.push({userId:user.id, notifications:true, tips:true, rewards:true}); writeDb(db);
      setSession(res, user.id);
      return sendJson(res, 201, {ok:true, user:publicUser(user), stats:statsFor(user.id, db)});
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const data = await body(req); const email=cleanEmail(data.email), password=String(data.password||''); const db=readDb();
      const user=db.users.find(u=>u.email===email);
      if(!user || !verifyPassword(password,user)) return sendError(res,401,'E-mail ou senha incorretos.');
      setSession(res,user.id); return sendJson(res,200,{ok:true,user:publicUser(user),stats:statsFor(user.id,db)});
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') { clearSession(req,res); return sendJson(res,200,{ok:true}); }
    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const db=readDb(); const user=sessionUser(req,db); if(!user) return sendJson(res,200,{ok:true,authenticated:false});
      return sendJson(res,200,{ok:true,authenticated:true,user:publicUser(user),stats:statsFor(user.id,db)});
    }
    if (req.method === 'GET' && url.pathname === '/api/dashboard') {
      const user=requireUser(req,res); if(!user)return; const db=readDb();
      return sendJson(res,200,{ok:true,user:publicUser(user),stats:statsFor(user.id,db),history:db.scans.filter(x=>x.userId===user.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20), redemptions:db.redemptions.filter(x=>x.userId===user.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
    }
    if (req.method === 'PATCH' && url.pathname === '/api/profile') {
      const session=requireUser(req,res); if(!session)return; const data=await body(req); const db=readDb();
      const user=db.users.find(u=>u.id===session.id); if(!user)return sendError(res,401,'LOGIN_REQUIRED');
      const email=cleanEmail(data.email); if(!/^\S+@\S+\.\S+$/.test(email)) return sendError(res,400,'E-mail inválido.');
      if(db.users.some(u=>u.email===email&&u.id!==user.id)) return sendError(res,409,'E-mail já está em uso.');
      const address=data.address||user.address||{}; Object.assign(user,{name:cleanName(data.name),email,phone:String(data.phone||'').trim(),city:String(data.city||'').trim(),bio:String(data.bio||'').trim(),address:{cep:String(address.cep||'').replace(/\D/g,''),street:String(address.street||'').trim(),number:String(address.number||'').trim(),complement:String(address.complement||'').trim(),neighborhood:String(address.neighborhood||'').trim(),city:String(address.city||'').trim(),state:String(address.state||'').trim().toUpperCase()}}); writeDb(db);
      return sendJson(res,200,{ok:true,user:publicUser(user),stats:statsFor(user.id,db)});
    }
    if (req.method === 'PATCH' && url.pathname === '/api/profile/address') {
      const session=requireUser(req,res); if(!session)return; const data=await body(req); const db=readDb();
      const user=db.users.find(u=>u.id===session.id); if(!user)return sendError(res,401,'LOGIN_REQUIRED');
      const address={cep:String(data.cep||'').replace(/\D/g,''),street:String(data.street||'').trim(),number:String(data.number||'').trim(),complement:String(data.complement||'').trim(),neighborhood:String(data.neighborhood||'').trim(),city:String(data.city||'').trim(),state:String(data.state||'').trim().toUpperCase()};
      if(address.cep.length!==8||!address.street||!address.number||!address.neighborhood||!address.city||address.state.length!==2)return sendError(res,400,'Preencha o endereço completo.');
      user.address=address; writeDb(db); return sendJson(res,200,{ok:true,user:publicUser(user)});
    }
    if (req.method === 'DELETE' && url.pathname === '/api/profile/avatar') {
      const user=requireUser(req,res); if(!user)return;
      const db=readDb(); const dbUser=db.users.find(u=>u.id===user.id);
      if(dbUser?.avatar){ const old=path.join(UPLOAD_DIR,path.basename(dbUser.avatar)); if(fs.existsSync(old)) fs.unlinkSync(old); }
      dbUser.avatar=''; writeDb(db);
      return sendJson(res,200,{ok:true,user:publicUser(dbUser)});
    }
    if (req.method === 'POST' && url.pathname === '/api/profile/avatar') {
      const user=requireUser(req,res); if(!user)return; const data=await body(req); const value=String(data.data||'');
      const m=value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/); if(!m)return sendError(res,400,'Imagem inválida. Use JPG, PNG ou WEBP.');
      const buf=Buffer.from(m[2],'base64'); if(buf.length>2*1024*1024)return sendError(res,400,'A foto deve ter no máximo 2 MB.');
      const ext=m[1].split('/')[1].replace('jpeg','jpg');
      const db=readDb(); const dbUser=db.users.find(u=>u.id===user.id);
      if(dbUser?.avatar){ const old=path.join(UPLOAD_DIR,path.basename(dbUser.avatar.split('?')[0])); if(fs.existsSync(old)) fs.unlinkSync(old); }
      if (isCloud()) {
        // Production stores the small avatar directly in PostgreSQL JSONB so it survives restarts.
        // The upload is capped above at 2 MB.
        user.avatar=value; dbUser.avatar=value;
      } else {
        const filename=`${user.id}_${Date.now()}.${ext}`; fs.writeFileSync(path.join(UPLOAD_DIR,filename),buf);
        user.avatar=`/uploads/${filename}`; dbUser.avatar=user.avatar;
      }
      writeDb(db);
      return sendJson(res,200,{ok:true,user:publicUser(dbUser)});
    }
    if (req.method === 'POST' && url.pathname === '/api/password') {
      const user=requireUser(req,res); if(!user)return; const data=await body(req); const db=readDb();
      if(!verifyPassword(String(data.currentPassword||''),user))return sendError(res,400,'Senha atual incorreta.');
      const next=String(data.newPassword||''); if(next.length<6)return sendError(res,400,'A nova senha precisa ter pelo menos 6 caracteres.'); if(next!==String(data.confirmPassword||''))return sendError(res,400,'As senhas não coincidem.');
      const pw=hashPassword(next); const dbUser=db.users.find(u=>u.id===user.id); dbUser.passwordHash=pw.hash;dbUser.passwordSalt=pw.salt;writeDb(db);return sendJson(res,200,{ok:true});
    }
    if (req.method === 'GET' && url.pathname === '/api/preferences') { const user=requireUser(req,res);if(!user)return;const db=readDb();return sendJson(res,200,{ok:true,preferences:db.preferences.find(x=>x.userId===user.id)||{notifications:true,tips:true,rewards:true}}); }
    if (req.method === 'PATCH' && url.pathname === '/api/preferences') { const user=requireUser(req,res);if(!user)return;const data=await body(req);const db=readDb();let p=db.preferences.find(x=>x.userId===user.id);if(!p){p={userId:user.id};db.preferences.push(p)};p.notifications=!!data.notifications;p.tips=!!data.tips;p.rewards=!!data.rewards;writeDb(db);return sendJson(res,200,{ok:true,preferences:p}); }
    if (req.method === 'GET' && url.pathname === '/api/user/products') {
      const user=requireUser(req,res); if(!user)return;
      const products=productCatalog().filter(p=>p.ownerUserId===user.id);
      return sendJson(res,200,{ok:true,products});
    }
    if (req.method === 'POST' && url.pathname === '/api/user/products') {
      const user=requireUser(req,res); if(!user)return;
      const data=await body(req);
      const code=normalizePackageCode(data.code), name=String(data.name||'').trim(), brand=String(data.brand||'').trim();
      const material=String(data.material||'').trim().toLowerCase();
      const weightGrams=Number(data.weightGrams);
      if(!code || !isValidGTIN(code)) return sendError(res,400,'Informe um código EAN/GTIN válido.');
      if(!name) return sendError(res,400,'Informe o nome do produto.');
      if(!['plastico','papel','vidro','metal','outro'].includes(material)) return sendError(res,400,'Selecione o material da embalagem.');
      if(!Number.isFinite(weightGrams) || weightGrams<=0 || weightGrams>10000) return sendError(res,400,'Informe um peso de embalagem válido.');
      const products=productCatalog();
      const existing=products.find(p=>normalizePackageCode(p.code)===code && p.ownerUserId===user.id);
      if(existing) return sendJson(res,200,{ok:true,product:existing,existing:true});
      const factor=findMaterialFactor(material);
      const product={id:id('product'),code,name,brand,material,weightGrams,
        pointsPerKg:Number(factor?.pointsPerKg||0),co2PerKg:Number(factor?.co2PerKg||0),
        waterPerKg:factor?.waterPerKg==null?null:Number(factor.waterPerKg),treePerKg:factor?.treePerKg==null?null:Number(factor.treePerKg),energyPerKg:factor?.energyPerKg==null?null:Number(factor.energyPerKg),
        source:String(factor?.source||''),ownerUserId:user.id,createdAt:now(),active:true};
      products.push(product);writeJsonFile(PRODUCTS_FILE,products);
      return sendJson(res,201,{ok:true,product,factorsConfigured:!!factor});
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/products/barcode/')) {
      const user = requireUser(req, res); if (!user) return;
      const code = normalizePackageCode(url.pathname.split('/').pop());
      if (!code || !isValidGTIN(code)) return sendError(res, 400, 'Código de barras inválido.');
      const catalogProduct = findConfiguredProduct(code, user.id);
      const configured = productReady(catalogProduct);
      const publicProduct = await lookupProduct(code);
      return sendJson(res, 200, { ok: true, configured, product: catalogProduct || publicProduct, catalogProduct: catalogProduct || null, factorsConfigured: configured });
    }
    if (req.method === 'POST' && url.pathname === '/api/actions/scan') {
      const user=requireUser(req,res);if(!user)return;
      const data=await body(req);
      const code=normalizePackageCode(data.code);
      if(!code || !isValidGTIN(code)) return sendError(res,400,'Código de embalagem inválido. Digite ou escaneie um código de barras válido.');
      const configured=findConfiguredProduct(code, user.id);
      if(!configured) return sendError(res,409,'Cadastre esta embalagem na sua conta antes de registrar.');
      const factor=findMaterialFactor(configured.material);
      const pointsPerKg=factor?Number(factor.pointsPerKg||0):Number(configured.pointsPerKg||0);
      const co2PerKg=factor?Number(factor.co2PerKg||0):Number(configured.co2PerKg||0);
      const waterPerKg=factor?Number(factor.waterPerKg||0):Number(configured.waterPerKg||0);
      const treePerKg=factor?.treePerKg!=null?Number(factor.treePerKg):configured.treePerKg!=null?Number(configured.treePerKg):null; const energyPerKg=factor?.energyPerKg!=null?Number(factor.energyPerKg):configured.energyPerKg!=null?Number(configured.energyPerKg):null;
      const source=factor?.source||configured.source||'';
      if(!source) return sendError(res,409,'Os fatores ambientais deste material ainda não estão configurados.');
      const weightKg=Number(configured.weightGrams)/1000;
      const points=Math.round(weightKg*pointsPerKg);
      const co2Kg=+(weightKg*co2PerKg).toFixed(4);
      const waterLiters=waterPerKg==null?null:+(weightKg*waterPerKg).toFixed(2);
      const treeEquivalent=treePerKg==null?null:+(weightKg*treePerKg).toFixed(4); const energyKwh=energyPerKg==null?null:+(weightKg*energyPerKg).toFixed(3);
      if(points<=0 && co2Kg<=0 && waterLiters<=0 && (treeEquivalent==null||treeEquivalent<=0) && (energyKwh==null||energyKwh<=0))return sendError(res,409,'Os fatores deste produto ainda não geram um impacto configurado.');
      const db=readDb();
      if(db.scans.some(x=>x.userId===user.id&&x.code===code))return sendError(res,409,'Esta embalagem já foi registrada por você.');
      const scan={id:id('scan'),userId:user.id,material:configured.material,label:configured.material.charAt(0).toUpperCase()+configured.material.slice(1),code,points,co2Kg,waterLiters,treeEquivalent,weightGrams:configured.weightGrams,energyKwh,product:{id:configured.id,code:configured.code,name:configured.name,brand:configured.brand,material:configured.material,weightGrams:configured.weightGrams,source:configured.source},createdAt:now()};
      db.scans.push(scan);writeDb(db);return sendJson(res,201,{ok:true,scan,stats:statsFor(user.id,db)});
    }
    if (req.method === 'GET' && url.pathname === '/api/partners') {
      const user=requireUser(req,res); if(!user)return;
      return sendJson(res,200,{ok:true,partners:partnerCatalog()});
    }
    if (req.method === 'GET' && url.pathname === '/api/coupons') {
      const user=requireUser(req,res); if(!user)return;
      const db=readDb();
      const redeemed=new Set(db.redemptions.filter(x=>x.userId===user.id).map(x=>x.rewardId));
      return sendJson(res,200,{ok:true,coupons:couponCatalog().map(c=>({...c,redeemed:redeemed.has(c.id)})),addressComplete:addressComplete(user.address),address:user.address||{}});
    }
    if (req.method === 'POST' && url.pathname === '/api/redeem-coupon') {
      const user=requireUser(req,res); if(!user)return;
      const data=await body(req); const coupon=couponCatalog().find(c=>c.id===data.couponId);
      if(!coupon)return sendError(res,404,'Cupom não encontrado ou não está disponível.');
      if(!addressComplete(user.address))return sendError(res,400,'Cadastre seu endereço completo antes de resgatar um benefício.');
      const db=readDb();
      if(db.redemptions.some(x=>x.userId===user.id&&x.rewardId===coupon.id))return sendError(res,409,'Você já resgatou este cupom.');
      if(userPoints(user.id,db)<Number(coupon.pointsCost||0))return sendError(res,400,'Pontos insuficientes.');
      const code=String(coupon.code||'').trim().toUpperCase(); if(!code)return sendError(res,409,'Este cupom ainda não possui um código de resgate configurado pelo administrador.');
      const r={id:id('red'),userId:user.id,rewardId:coupon.id,name:coupon.title||coupon.name||'Cupom Eco Viva',partner:coupon.partner||'',cost:Number(coupon.pointsCost||0),discount:coupon.discount||'',createdAt:now(),status:'ativo',couponCode:code,validUntil:coupon.validUntil||null,addressAtRedemption:user.address};
      db.redemptions.push(r); writeDb(db);
      return sendJson(res,201,{ok:true,redemption:r,stats:statsFor(user.id,db)});
    }
    return sendError(res,404,'Rota não encontrada.');
  } catch (err) { console.error(err); return sendError(res,500,'Erro interno do servidor.'); }
}

const publicPages = new Set(['/', '/index.html', '/login.html', '/cadastro.html', '/admin-login.html', '/admin-setup.html']);
const protectedPages = new Set(['/admin.html','/empresas.html','/escanear.html','/perfil.html','/editar-perfil.html','/endereco.html','/preferencias.html','/seguranca.html','/pontuacao.html','/resgates.html','/separar-lixo.html']);
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};
function serve(req,res,url){
  let pathname=decodeURIComponent(url.pathname); if(pathname==='/')pathname='/index.html';
  if(pathname==='/admin.html'){if(!adminSession(req)){res.writeHead(302,{Location:'/admin-login.html'});return res.end();}}
  if(pathname==='/admin-setup.html' && hasAdmin()){res.writeHead(302,{Location:'/admin-login.html'});return res.end();}
  if(protectedPages.has(pathname) && pathname!=='/admin.html'){const db=readDb();if(!sessionUser(req,db)){res.writeHead(302,{Location:`/login.html?next=${encodeURIComponent(pathname.slice(1))}`});return res.end();}}
  if(pathname.startsWith('/uploads/')){const file=path.join(UPLOAD_DIR,path.basename(pathname));if(!fs.existsSync(file))return sendError(res,404,'Arquivo não encontrado.');const ext=path.extname(file).toLowerCase();res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':'public, max-age=86400'});return fs.createReadStream(file).pipe(res);}
  const file=path.join(ROOT,pathname); if(!file.startsWith(ROOT)||!fs.existsSync(file)||!fs.statSync(file).isFile())return sendError(res,404,'Página não encontrada.');const ext=path.extname(file).toLowerCase();res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
}

const server=http.createServer(async (req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(req.method==='GET'&&url.pathname==='/health')return sendJson(res,200,{ok:true,service:'ecoviva',storage:isCloud()?'postgresql':'local'});if(url.pathname.startsWith('/api/'))return api(req,res,url);if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}return serve(req,res,url);});

async function start(){
  const result = await initStorage();
  cleanup();
  server.listen(PORT,'0.0.0.0',()=>{
    console.log(`Eco Viva rodando em http://localhost:${PORT}`);
    console.log(`Armazenamento: ${result.cloud ? 'PostgreSQL (produção)' : 'arquivos locais (desenvolvimento)'}`);
    if(!hasAdmin()){console.log(`ADMIN_SETUP_KEY=${setupKey()}`);console.log('Configure o dono em http://localhost:'+PORT+'/admin-setup.html');}
  });
}
process.on('SIGTERM', async()=>{await closeStorage();server.close(()=>process.exit(0));});
process.on('SIGINT', async()=>{await closeStorage();server.close(()=>process.exit(0));});
start().catch(err=>{console.error('Falha ao iniciar Eco Viva:',err);process.exit(1);});
