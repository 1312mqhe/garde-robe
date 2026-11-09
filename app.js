// Garde-robe : appli web locale (aucun serveur). Les données restent dans IndexedDB.

const BG_REMOVAL_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
const GRADIO_URL = 'https://cdn.jsdelivr.net/npm/@gradio/client@1.19.1/+esm';
const DEFAULT_SPACE = 'yisol/IDM-VTON';

// ---------- Données de référence ----------
const CATS = {
  haut:       { label: 'Haut (t-shirt, chemise, top)', short: 'Haut', slot: 'top', warmth: 2 },
  pull:       { label: 'Pull, sweat, gilet', short: 'Pull', slot: 'mid', warmth: 3 },
  veste:      { label: 'Veste légère, blazer', short: 'Veste', slot: 'outer', warmth: 2 },
  manteau:    { label: 'Manteau, doudoune', short: 'Manteau', slot: 'outer', warmth: 4 },
  bas:        { label: 'Pantalon, jupe, short', short: 'Bas', slot: 'bottom', warmth: 3 },
  robe:       { label: 'Robe, combinaison', short: 'Robe', slot: 'dress', warmth: 2 },
  chaussures: { label: 'Chaussures', short: 'Chaussures', slot: 'shoes', warmth: 3 },
  accessoire: { label: 'Écharpe, bonnet, gants', short: 'Accessoire', slot: 'acc', warmth: 4 },
};
const WARMTH = ['Très léger', 'Léger', 'Moyen', 'Chaud', 'Très chaud'];

const COLORS = [
  { id: 'noir', rgb: [30, 30, 32], neutral: true },
  { id: 'blanc', rgb: [242, 242, 240], neutral: true },
  { id: 'gris', rgb: [140, 140, 140], neutral: true },
  { id: 'beige', rgb: [214, 196, 168], neutral: true },
  { id: 'marron', rgb: [115, 78, 52], neutral: true },
  { id: 'bleu marine', rgb: [36, 44, 82], neutral: true },
  { id: 'jean', rgb: [78, 105, 145], neutral: true },
  { id: 'kaki', rgb: [110, 108, 66], neutral: true },
  { id: 'bleu', rgb: [45, 95, 200] },
  { id: 'bleu clair', rgb: [150, 190, 228] },
  { id: 'vert', rgb: [55, 130, 75] },
  { id: 'jaune', rgb: [235, 200, 55] },
  { id: 'orange', rgb: [228, 120, 45] },
  { id: 'rouge', rgb: [200, 40, 45] },
  { id: 'bordeaux', rgb: [110, 28, 42] },
  { id: 'rose', rgb: [236, 152, 172] },
  { id: 'violet', rgb: [118, 72, 150] },
  { id: 'imprimé', rgb: null },
];
const colorById = id => COLORS.find(c => c.id === id) || COLORS[0];
// Associations de couleurs vives qui vont bien ensemble
const GOOD_PAIRS = [
  ['bleu', 'bleu clair'], ['bleu clair', 'rose'], ['bordeaux', 'rose'], ['vert', 'bleu clair'],
  ['jaune', 'bleu'], ['orange', 'bleu'], ['rouge', 'bleu clair'], ['violet', 'rose'], ['vert', 'jaune'],
];

// Zones des pièces sur le mannequin (en % du cadre) et ordre d'empilement
// Les couches se superposent comme une veste ouverte : la plus chaude derrière et plus large,
// la plus fine devant et plus étroite, pour que chaque pièce reste visible.
const LAYOUT = {
  acc:    { l: 34, t: 12, w: 32, h: 12, z: 8 },
  outer:  { l: 14, t: 17, w: 72, h: 44, z: 3 },
  mid:    { l: 21, t: 18.5, w: 58, h: 33, z: 4 },
  top:    { l: 29, t: 20, w: 42, h: 28, z: 5 },
  dress:  { l: 22, t: 19, w: 56, h: 58, z: 4 },
  bottom: { l: 26, t: 46, w: 48, h: 41, z: 2 },
  shoes:  { l: 25, t: 86, w: 50, h: 12, z: 1 },
};
const SLOT_ORDER = ['acc', 'outer', 'mid', 'top', 'dress', 'bottom', 'shoes'];
const SLOT_NAME = { acc: 'Accessoire', outer: 'Veste/manteau', mid: 'Pull', top: 'Haut', dress: 'Robe', bottom: 'Bas', shoes: 'Chaussures' };

// ---------- Petite base IndexedDB ----------
const db = {
  _p: null,
  open() {
    if (this._p) return this._p;
    this._p = new Promise((res, rej) => {
      const r = indexedDB.open('garde-robe', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('items', { keyPath: 'id' });
        d.createObjectStore('outfits', { keyPath: 'id' });
        d.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this._p;
  },
  async tx(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && 'result' in out ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  },
  all(store) { return this.tx(store, 'readonly', s => s.getAll()); },
  put(store, v, key) { return this.tx(store, 'readwrite', s => key === undefined ? s.put(v) : s.put(v, key)); },
  del(store, key) { return this.tx(store, 'readwrite', s => s.delete(key)); },
  get(store, key) { return this.tx(store, 'readonly', s => s.get(key)); },
};
const kv = { get: k => db.get('kv', k), set: (k, v) => db.put('kv', v, k) };

// ---------- État ----------
const state = {
  items: [],
  outfits: [],
  weather: null,
  loc: null,
  current: null,      // { pieces: {slot: itemId}, aiImage?: Blob, savedId?: string }
  seen: new Set(),    // tenues déjà proposées aujourd'hui
  filter: 'tout',
  editing: null,      // vêtement en cours d'édition
};
const urlCache = new Map();
function blobUrl(key, blob) {
  if (!blob) return '';
  const c = urlCache.get(key);
  if (c && c.blob === blob) return c.url;
  if (c) URL.revokeObjectURL(c.url);
  const url = URL.createObjectURL(blob);
  urlCache.set(key, { blob, url });
  return url;
}
const itemUrl = it => blobUrl('item-' + it.id, it.image);
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function itemName(it) { return it.name || `${CATS[it.category].short.toLowerCase()} ${it.color}`; }

// ---------- Navigation ----------
function showTab(name) {
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('#fab-add').classList.toggle('hidden', name !== 'wardrobe');
  if (name === 'library') renderLibrary();
  if (name === 'wardrobe') renderWardrobe();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// ---------- Images ----------
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
const canvasToBlob = (c, type = 'image/png', q = 0.9) => new Promise(r => c.toBlob(r, type, q));

// Réduit une photo (les photos d'iPhone sont très grandes)
async function downscale(file, max = 1024, type = 'image/jpeg') {
  const img = await blobToImage(file);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return canvasToBlob(c, type, 0.9);
}

// Recadre au plus près des pixels visibles
async function trimTransparent(blob) {
  const img = await blobToImage(blob);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return blob;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const o = document.createElement('canvas');
  o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return canvasToBlob(o);
}

// Couleur dominante parmi la palette
async function detectColor(blob) {
  const img = await blobToImage(blob);
  const c = document.createElement('canvas');
  const k = 80 / Math.max(img.naturalWidth, img.naturalHeight);
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const counts = {};
  // On ignore les bords (souvent du fond) si l'image n'a pas de transparence
  const hasAlpha = (() => { for (let i = 3; i < d.length; i += 4) if (d[i] < 200) return true; return false; })();
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (!hasAlpha && (x < c.width * 0.2 || x > c.width * 0.8 || y < c.height * 0.2 || y > c.height * 0.8)) continue;
    const i = (y * c.width + x) * 4;
    if (d[i + 3] < 128) continue;
    let best = null, bd = Infinity;
    for (const col of COLORS) {
      if (!col.rgb) continue;
      const dist = (d[i] - col.rgb[0]) ** 2 * 0.3 + (d[i + 1] - col.rgb[1]) ** 2 * 0.59 + (d[i + 2] - col.rgb[2]) ** 2 * 0.11;
      if (dist < bd) { bd = dist; best = col.id; }
    }
    counts[best] = (counts[best] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return 'noir';
  const total = sorted.reduce((s, e) => s + e[1], 0);
  // Pas de couleur nettement dominante : probablement un imprimé
  if (sorted[0][1] / total < 0.3 && sorted.length > 4) return 'imprimé';
  return sorted[0][0];
}

// Détourage : se fait sur le téléphone, le modèle (~40 Mo) est téléchargé une fois
let bgLib = null;
async function removeBackground(blob, onProgress) {
  if (!bgLib) bgLib = await import(BG_REMOVAL_URL);
  const out = await bgLib.removeBackground(blob, {
    model: 'isnet_quint8',
    output: { format: 'image/png' },
    progress: (key, cur, total) => {
      if (key.startsWith('fetch') && total) onProgress?.(`Téléchargement du modèle… ${Math.round(cur / total * 100)} %`);
      else if (key.startsWith('compute')) onProgress?.('Détourage en cours…');
    },
  });
  return trimTransparent(out);
}

// ---------- Garde-robe ----------
function renderFilters() {
  const count = c => c === 'tout' ? state.items.length : state.items.filter(i => i.category === c).length;
  const cats = ['tout', ...Object.keys(CATS).filter(c => count(c) > 0 || c === state.filter)];
  $('#filter-chips').innerHTML = cats.map(c =>
    `<button data-c="${c}" class="${state.filter === c ? 'on' : ''}">${c === 'tout' ? 'Tout' : CATS[c].short}<span class="n">${count(c)}</span></button>`).join('');
  $('#filter-chips').querySelectorAll('button').forEach(b => b.onclick = () => { state.filter = b.dataset.c; renderWardrobe(); });
}
function renderWardrobe() {
  renderFilters();
  const list = state.items.filter(i => state.filter === 'tout' || i.category === state.filter)
    .sort((a, b) => Object.keys(CATS).indexOf(a.category) - Object.keys(CATS).indexOf(b.category) || b.createdAt - a.createdAt);
  $('#wardrobe-empty').classList.toggle('hidden', state.items.length > 0);
  $('#wardrobe-grid').innerHTML = list.map(i =>
    `<div class="tile" data-id="${i.id}"><img src="${itemUrl(i)}" alt="${esc(itemName(i))}" loading="lazy"><span class="dot" style="background:${swatchCss(i.color)}"></span></div>`).join('');
  $('#wardrobe-kicker').textContent = state.items.length ? `${state.items.length} vêtement${state.items.length > 1 ? 's' : ''}` : 'Ta garde-robe';
  $('#wardrobe-grid').querySelectorAll('.tile').forEach(t => t.onclick = () => openSheet(state.items.find(i => i.id === t.dataset.id)));
}

// Feuille d'ajout / édition
$('#f-cat').innerHTML = Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('#f-color').innerHTML = COLORS.map(c => `<option value="${c.id}">${c.id[0].toUpperCase() + c.id.slice(1)}</option>`).join('');
function swatchCss(id) {
  const c = colorById(id);
  return c.rgb ? `rgb(${c.rgb.join(',')})` : 'conic-gradient(#ff5ca8,#ffd23f,#3fd28b,#4c8dff,#8b6cff,#ff5ca8)';
}
$('#f-cat-chips').innerHTML = Object.entries(CATS).map(([k, v]) => `<button type="button" data-c="${k}">${v.short}</button>`).join('');
$('#f-cat-chips').querySelectorAll('button').forEach(b => b.onclick = () => { $('#f-cat').value = b.dataset.c; $('#f-cat').onchange(); syncPickers(); });
$('#f-color-swatches').innerHTML = COLORS.map(c => `<button type="button" data-c="${c.id}" aria-label="${c.id}" style="background:${swatchCss(c.id)}"></button>`).join('') + '<div class="swatch-name" id="swatch-name"></div>';
$('#f-color-swatches').querySelectorAll('button').forEach(b => b.onclick = () => { $('#f-color').value = b.dataset.c; syncPickers(); });
function syncPickers() {
  $('#f-cat-chips').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === $('#f-cat').value));
  $('#f-color-swatches').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === $('#f-color').value));
  const n = $('#f-color').value; $('#swatch-name').textContent = n ? n[0].toUpperCase() + n.slice(1) : '';
}
$('#f-warmth').innerHTML = WARMTH.map((w, i) => `<button type="button" data-w="${i + 1}">${w}</button>`).join('');
$('#f-warmth').querySelectorAll('button').forEach(b => b.onclick = () => setWarmth(+b.dataset.w));
function setWarmth(w) {
  state.editing.warmth = w;
  $('#f-warmth').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.w === w));
}
$('#f-cat').onchange = () => {
  const c = $('#f-cat').value;
  if (!state.editing.warmthTouched) setWarmth(CATS[c].warmth);
  if (c === 'manteau' && !state.editing.id) $('#f-rain').checked = true;
};
$('#f-warmth').addEventListener('click', () => { if (state.editing) state.editing.warmthTouched = true; });

function openSheet(item) {
  state.editing = item ? { ...item } : { warmth: 2 };
  $('#sheet-title').textContent = item ? 'Modifier' : 'Nouveau vêtement';
  $('#pick-zone').classList.toggle('hidden', !!item);
  $('#edit-zone').classList.toggle('hidden', !item);
  $('#f-delete').classList.toggle('hidden', !item);
  $('#toggle-cut').classList.add('hidden');
  $('#cut-status').textContent = '';
  if (item) {
    $('#edit-img').src = itemUrl(item);
    $('#f-cat').value = item.category;
    $('#f-color').value = item.color;
    $('#f-rain').checked = !!item.rainOk;
    $('#f-name').value = item.name || '';
    setWarmth(item.warmth);
    syncPickers();
  }
  $('#sheet').classList.remove('hidden');
}
function closeSheet() { $('#sheet').classList.add('hidden'); state.editing = null; $('#cam-input').value = ''; $('#lib-input').value = ''; }
$('#sheet-close').onclick = closeSheet;
$('#sheet').onclick = e => { if (e.target.id === 'sheet') closeSheet(); };
$('#fab-add').onclick = () => openSheet(null);
$('#cam-input').onchange = e => e.target.files[0] && handlePhoto(e.target.files[0]);
$('#lib-input').onchange = e => e.target.files[0] && handlePhoto(e.target.files[0]);

async function handlePhoto(file) {
  const ed = state.editing;
  $('#pick-zone').classList.add('hidden');
  $('#edit-zone').classList.remove('hidden');
  const original = await downscale(file);
  ed.original = original;
  ed.image = original;
  $('#edit-img').src = URL.createObjectURL(original);
  $('#f-cat').value = 'haut';
  $('#f-rain').checked = false;
  $('#f-name').value = '';
  setWarmth(CATS.haut.warmth);
  $('#f-color').value = await detectColor(original);
  syncPickers();
  $('#f-save').disabled = true;
  $('#cut-status').innerHTML = '<span class="spinner"></span>Détourage en cours… (la première fois, ça peut prendre une minute)';
  try {
    const cut = await removeBackground(original, msg => { if (state.editing === ed) $('#cut-status').innerHTML = `<span class="spinner"></span>${msg}`; });
    if (state.editing !== ed) return;
    ed.cutout = cut;
    ed.image = cut;
    $('#edit-img').src = URL.createObjectURL(cut);
    $('#f-color').value = await detectColor(cut);
    syncPickers();
    $('#cut-status').textContent = 'Fond retiré ✓';
    $('#toggle-cut').classList.remove('hidden');
    $('#toggle-cut').textContent = "Garder la photo d'origine";
  } catch (err) {
    console.warn(err);
    if (state.editing !== ed) return;
    $('#cut-status').textContent = "Le détourage n'a pas marché, la photo est gardée telle quelle.";
  } finally {
    $('#f-save').disabled = false;
  }
}
$('#toggle-cut').onclick = () => {
  const ed = state.editing;
  ed.image = ed.image === ed.cutout ? ed.original : ed.cutout;
  $('#edit-img').src = URL.createObjectURL(ed.image);
  $('#toggle-cut').textContent = ed.image === ed.cutout ? "Garder la photo d'origine" : 'Utiliser la version détourée';
};
$('#f-save').onclick = async () => {
  const ed = state.editing;
  if (!ed?.image) return;
  const item = {
    id: ed.id || uid(),
    image: ed.image,
    category: $('#f-cat').value,
    color: $('#f-color').value,
    warmth: ed.warmth || CATS[$('#f-cat').value].warmth,
    rainOk: $('#f-rain').checked,
    name: $('#f-name').value.trim(),
    createdAt: ed.createdAt || Date.now(),
  };
  await db.put('items', item);
  const i = state.items.findIndex(x => x.id === item.id);
  if (i >= 0) state.items[i] = item; else state.items.push(item);
  closeSheet();
  renderWardrobe();
  toast(ed.id ? 'Modifié ✓' : 'Ajouté à ta garde-robe ✓');
  if (!state.current) suggest();
};
$('#f-delete').onclick = async () => {
  const ed = state.editing;
  if (!confirm('Supprimer ce vêtement ?')) return;
  await db.del('items', ed.id);
  state.items = state.items.filter(i => i.id !== ed.id);
  closeSheet();
  renderWardrobe();
  if (state.current && Object.values(state.current.pieces).includes(ed.id)) suggest();
};

// ---------- Météo ----------
const WMO = {
  0: ['☀️', 'Ciel dégagé'], 1: ['🌤️', 'Plutôt dégagé'], 2: ['⛅', 'Partiellement nuageux'], 3: ['☁️', 'Couvert'],
  45: ['🌫️', 'Brouillard'], 48: ['🌫️', 'Brouillard givrant'],
  51: ['🌦️', 'Bruine légère'], 53: ['🌦️', 'Bruine'], 55: ['🌧️', 'Bruine forte'], 56: ['🌧️', 'Bruine verglaçante'], 57: ['🌧️', 'Bruine verglaçante'],
  61: ['🌦️', 'Pluie faible'], 63: ['🌧️', 'Pluie'], 65: ['🌧️', 'Forte pluie'], 66: ['🌧️', 'Pluie verglaçante'], 67: ['🌧️', 'Pluie verglaçante'],
  71: ['🌨️', 'Neige faible'], 73: ['🌨️', 'Neige'], 75: ['❄️', 'Forte neige'], 77: ['🌨️', 'Grains de neige'],
  80: ['🌦️', 'Averses'], 81: ['🌧️', 'Averses'], 82: ['⛈️', 'Fortes averses'], 85: ['🌨️', 'Averses de neige'], 86: ['❄️', 'Averses de neige'],
  95: ['⛈️', 'Orage'], 96: ['⛈️', 'Orage et grêle'], 99: ['⛈️', 'Orage et grêle'],
};
const isWetCode = c => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const isSnowCode = c => (c >= 71 && c <= 77) || c === 85 || c === 86;

function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no geo'));
    navigator.geolocation.getCurrentPosition(p => res(p.coords), rej, { timeout: 10000, maximumAge: 30 * 60 * 1000 });
  });
}
async function reverseName(lat, lon) {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=fr`);
    const j = await r.json();
    return j.city || j.locality || j.principalSubdivision || 'Ma position';
  } catch { return 'Ma position'; }
}
// La position n'est demandée qu'une fois, puis gardée en mémoire.
// iPhone redemande l'autorisation à chaque fois qu'on la lit : on ne la relit donc
// que si l'utilisateur touche « Mettre à jour ma position ».
async function loadWeather(force = false, refreshGps = false) {
  const box = $('#weather');
  try {
    let loc = state.loc || await kv.get('loc');
    if (!loc || (loc.mode === 'gps' && refreshGps)) {
      try {
        const c = await getPosition();
        const moved = !loc || Math.abs(loc.lat - c.latitude) > 0.05 || Math.abs(loc.lon - c.longitude) > 0.05;
        loc = { mode: 'gps', lat: c.latitude, lon: c.longitude, name: moved ? await reverseName(c.latitude, c.longitude) : loc.name };
        await kv.set('loc', loc);
      } catch (e) {
        if (!loc) {
          box.innerHTML = `<div>📍 Je n'ai pas accès à ta position.</div><div class="muted small">Autorise la localisation, ou choisis une ville dans Réglages.</div><button class="link" id="retry-gps">Réessayer</button>`;
          $('#retry-gps').onclick = () => loadWeather(true, true);
          suggest();
          return;
        }
      }
    }
    state.loc = loc;
    $('#loc-current').textContent = `Lieu actuel : ${loc.name}${loc.mode === 'gps' ? ' (position)' : ''}`;
    const cached = await kv.get('weather');
    if (!force && cached && cached.lat === loc.lat && cached.lon === loc.lon && Date.now() - cached.at < 30 * 60 * 1000) {
      state.weather = cached.data;
    } else {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
        `&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day` +
        `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,weather_code` +
        `&timezone=auto&forecast_days=1`;
      const r = await fetch(u);
      if (!r.ok) throw new Error('météo ' + r.status);
      state.weather = await r.json();
      await kv.set('weather', { lat: loc.lat, lon: loc.lon, at: Date.now(), data: state.weather });
    }
    renderWeather();
  } catch (err) {
    console.warn(err);
    const cached = await kv.get('weather');
    if (cached) { state.weather = cached.data; renderWeather(true); }
    else box.innerHTML = `<div>Météo indisponible pour le moment.</div><button class="link" id="retry-w">Réessayer</button>`;
    $('#retry-w') && ($('#retry-w').onclick = () => loadWeather(true));
  }
  suggest();
}
function weatherSummary() {
  const w = state.weather;
  if (!w) return { feels: 17, rain: false, wind: 10, snow: false, label: 'météo inconnue' };
  const cur = w.current, d = w.daily;
  const dayFeels = (d.apparent_temperature_max[0] + d.apparent_temperature_min[0]) / 2;
  const feels = cur.apparent_temperature * 0.6 + dayFeels * 0.4;
  const rain = isWetCode(cur.weather_code) || cur.precipitation > 0 || (d.precipitation_probability_max[0] ?? 0) >= 50 || isWetCode(d.weather_code[0]);
  const snow = isSnowCode(cur.weather_code) || isSnowCode(d.weather_code[0]);
  return { feels, rain: rain || snow, snow, wind: cur.wind_speed_10m };
}
function renderWeather(stale = false) {
  const w = state.weather, cur = w.current, d = w.daily;
  const [icon, txt] = WMO[cur.weather_code] || ['🌡️', ''];
  $('#weather').innerHTML = `
    <div class="wx-main">
      <div class="wx-icon">${cur.is_day === 0 && cur.weather_code <= 1 ? '🌙' : icon}</div>
      <div class="wx-temp">${Math.round(cur.temperature_2m)}°</div>
      <div class="wx-side">
        <div class="cond">${txt}</div>
        <div class="range">${Math.round(d.temperature_2m_min[0])}° / ${Math.round(d.temperature_2m_max[0])}°</div>
      </div>
    </div>
    <div class="wx-pills">
      <span class="pill">Ressenti ${Math.round(cur.apparent_temperature)}°</span>
      <span class="pill">💨 ${Math.round(cur.wind_speed_10m)} km/h</span>
      <span class="pill">☔ ${d.precipitation_probability_max[0] ?? 0} %</span>
      ${stale ? '<span class="pill">hors ligne</span>' : ''}
      ${state.loc?.mode === 'gps' ? '<span class="pill btn" id="refresh-gps"><svg class="ic"><use href="#i-pin"/></svg>Actualiser</span>' : ''}
    </div>`;
  $('#refresh-gps') && ($('#refresh-gps').onclick = () => loadWeather(true, true));
  renderKicker();
}
function renderKicker() {
  const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#today-kicker').textContent = date[0].toUpperCase() + date.slice(1) + (state.loc?.name ? ' · ' + state.loc.name : '');
}
// ---------- Suggestions de tenues ----------
// Pour chaque type de pièce : chaleur voulue [min, max] et si elle est nécessaire
function planFor(w) {
  const t = w.feels;
  let p;
  if (t >= 25) p = { top: [1, 2], bottom: [1, 2], dress: [1, 2], mid: null, outer: null, shoes: [1, 3], acc: null, hint: 'Il fait chaud : tenue légère.' };
  else if (t >= 20) p = { top: [1, 3], bottom: [1, 3], dress: [1, 3], mid: null, outer: w.wind > 30 ? [1, 2] : null, shoes: [1, 3], acc: null, hint: 'Temps doux.' };
  else if (t >= 15) p = { top: [1, 3], bottom: [2, 4], dress: [1, 3], layer: true, mid: [2, 3], outer: [1, 2], shoes: [2, 4], acc: null, hint: 'Prévois une couche en plus.' };
  else if (t >= 9) p = { top: [1, 3], bottom: [2, 5], dress: [2, 4], mid: [2, 4], outer: [2, 4], shoes: [2, 5], acc: null, hint: 'Frais : superpose les couches.' };
  else if (t >= 3) p = { top: [1, 4], bottom: [3, 5], dress: [3, 5], mid: [3, 5], outer: [3, 5], shoes: [3, 5], acc: [3, 5], hint: 'Froid : manteau conseillé.' };
  else p = { top: [2, 5], bottom: [3, 5], dress: [4, 5], mid: [3, 5], outer: [4, 5], shoes: [3, 5], acc: [4, 5], hint: 'Très froid : couvre-toi bien.' };
  if (w.rain) { p.outer = p.outer || [1, 3]; p.hint += ' Pluie prévue : imperméable conseillé.'; }
  return p;
}
function warmthFit(item, range) {
  if (!range) return 0;
  const [a, b] = range;
  if (item.warmth >= a && item.warmth <= b) return 2;
  return -Math.min(Math.abs(item.warmth - a), Math.abs(item.warmth - b)) * 1.5;
}
function colorScore(items) {
  const vivid = [...new Set(items.map(i => i.color).filter(c => !colorById(c).neutral && c !== 'imprimé'))];
  const prints = items.filter(i => i.color === 'imprimé').length;
  let s = 0;
  if (prints > 1) s -= 3;
  if (prints === 1 && vivid.length > 0) s -= 1.5;
  if (vivid.length === 0) s += prints ? 2 : 1;
  else if (vivid.length === 1) s += 2.5;
  else if (vivid.length === 2) s += GOOD_PAIRS.some(([a, b]) => vivid.includes(a) && vivid.includes(b)) ? 1.5 : -2;
  else s -= 3;
  // Évite le total look d'une même couleur neutre (sauf noir)
  const neutrals = items.filter(i => colorById(i.color).neutral).map(i => i.color);
  if (neutrals.length >= 3 && new Set(neutrals).size === 1 && neutrals[0] !== 'noir') s -= 1;
  return s;
}
const bySlot = slot => state.items.filter(i => CATS[i.category].slot === slot);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function candidatesFor(slot, plan, w) {
  const all = bySlot(slot);
  if (!all.length) return [];
  const range = plan[slot] || (slot === 'outer' ? [1, 5] : null);
  let fit = range ? all.filter(i => warmthFit(i, range) > 0) : all;
  if (slot === 'outer' && w.rain) { const dry = fit.filter(i => i.rainOk); if (dry.length) fit = dry; }
  if (slot === 'shoes' && w.rain) { const dry = fit.filter(i => i.rainOk); if (dry.length) fit = dry; }
  if (!fit.length && range) fit = [...all].sort((a, b) => warmthFit(b, range) - warmthFit(a, range)).slice(0, 3);
  return fit;
}

function buildOutfit() {
  const w = weatherSummary();
  const plan = planFor(w);
  let best = null;
  for (let n = 0; n < 150; n++) {
    const pieces = {};
    const useDress = bySlot('dress').length && w.feels >= 9 &&
      (!bySlot('top').length || !bySlot('bottom').length || Math.random() < 0.3);
    for (const slot of useDress ? ['dress'] : ['top', 'bottom']) {
      const c = candidatesFor(slot, plan, w); if (c.length) pieces[slot] = pick(c).id;
    }
    // Couches du dessus
    const wantMid = plan.mid && (!plan.layer || Math.random() < 0.5);
    const wantOuter = plan.outer && (!plan.layer || !wantMid || w.rain);
    if (wantMid) { const c = candidatesFor('mid', plan, w); if (c.length) pieces.mid = pick(c).id; }
    if (wantOuter) { const c = candidatesFor('outer', plan, w); if (c.length) pieces.outer = pick(c).id; }
    if (plan.layer && !pieces.mid && !pieces.outer) {
      const c = candidatesFor('outer', plan, w).concat(candidatesFor('mid', plan, w));
      if (c.length) { const it = pick(c); pieces[CATS[it.category].slot] = it.id; }
    }
    { const c = candidatesFor('shoes', plan, w); if (c.length) pieces.shoes = pick(c).id; }
    if (plan.acc) { const c = candidatesFor('acc', plan, w); if (c.length) pieces.acc = pick(c).id; }

    const items = Object.values(pieces).map(id => state.items.find(i => i.id === id));
    if (!items.length) continue;
    let score = colorScore(items) + Math.random() * 1.5;
    for (const [slot, id] of Object.entries(pieces)) {
      const it = state.items.find(i => i.id === id);
      score += warmthFit(it, plan[slot]) * 0.5;
    }
    const key = Object.values(pieces).sort().join('|');
    if (state.seen.has(key)) score -= 6;
    if (!best || score > best.score) best = { pieces, score, key };
  }
  return { best, plan };
}

function suggest() {
  if (!state.items.length) {
    $('#stage').innerHTML = mannequinSvg() + `<div class="missing" style="top:45%">Ajoute des vêtements dans « Dressing »</div>`;
    $('#outfit-hint').textContent = '';
    $('#pieces-strip').innerHTML = '';
    state.current = null;
    updateSaveBtn();
    return;
  }
  const { best, plan } = buildOutfit();
  if (!best) return;
  state.seen.add(best.key);
  state.current = { pieces: best.pieces };
  const w = weatherSummary();
  $('#outfit-hint').innerHTML = state.weather ? `<b>${Math.round(w.feels)}° ressentis.</b> ${esc(plan.hint)}` : esc(plan.hint);
  renderStage();
  $('#ai-result').innerHTML = '';
  $('#ai-status').textContent = '';
}
// Petite animation entre deux idées
function animateSuggest(dir = -1) {
  const st = $('#stage');
  st.style.setProperty('--dx', `${dir * 40}px`);
  st.classList.add('out');
  setTimeout(() => { suggest(); st.style.setProperty('--dx', `${-dir * 40}px`); requestAnimationFrame(() => st.classList.remove('out')); }, 180);
}
$('#btn-another').onclick = () => animateSuggest(-1);
// Glisser sur le mannequin = une autre idée
{
  let x0 = null, y0 = null;
  const st = $('#stage');
  st.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  st.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && state.items.length) { st.dataset.swiped = '1'; animateSuggest(dx < 0 ? -1 : 1); setTimeout(() => delete st.dataset.swiped, 400); }
  });
}

// Change une seule pièce (touchée sur le mannequin)
function swapPiece(slot) {
  const w = weatherSummary(), plan = planFor(w);
  let c = candidatesFor(slot, plan, w);
  if (c.length < 2) c = bySlot(slot);
  if (c.length < 2) { toast(`Pas d'autre ${SLOT_NAME[slot].toLowerCase()} adapté pour l'instant.`); return; }
  const cur = state.current.pieces[slot];
  const idx = c.findIndex(i => i.id === cur);
  state.current.pieces[slot] = c[(idx + 1) % c.length].id;
  state.current.aiImage = null; state.current.savedId = null;
  $('#ai-result').innerHTML = '';
  renderStage();
  navigator.vibrate?.(10);
}

function mannequinSvg() {
  return `<svg class="mannequin" viewBox="0 0 300 500" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <g fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.12)" stroke-width="1.2">
      <ellipse cx="150" cy="52" rx="24" ry="29"/>
      <rect x="140" y="76" width="20" height="18" rx="6"/>
      <path d="M104 98 Q150 86 196 98 L206 150 Q200 200 192 232 L108 232 Q100 200 94 150 Z"/>
      <path d="M104 100 Q86 106 82 130 L70 230 Q68 244 78 246 Q86 246 88 232 L102 150 Z"/>
      <path d="M196 100 Q214 106 218 130 L230 230 Q232 244 222 246 Q214 246 212 232 L198 150 Z"/>
      <path d="M108 228 L192 228 L190 270 L176 430 Q174 442 164 442 Q156 442 155 430 L152 290 L148 290 L145 430 Q144 442 136 442 Q126 442 124 430 L110 270 Z"/>
    </g>
    <rect x="146" y="446" width="8" height="34" fill="rgba(255,255,255,.12)"/>
    <ellipse cx="150" cy="484" rx="46" ry="7" fill="rgba(255,255,255,.1)"/>
  </svg>`;
}
function renderStage() {
  const stage = $('#stage');
  const p = state.current.pieces;
  let html = mannequinSvg();
  for (const slot of SLOT_ORDER) {
    const it = state.items.find(i => i.id === p[slot]);
    if (!it) continue;
    const L = LAYOUT[slot];
    html += `<img class="piece tap" data-slot="${slot}" src="${itemUrl(it)}" alt="${esc(itemName(it))}"
      style="left:${L.l}%;top:${L.t}%;width:${L.w}%;height:${L.h}%;z-index:${L.z}">`;
  }
  if (!p.top && !p.dress) html += `<div class="missing" style="top:30%">Ajoute un haut</div>`;
  if (!p.bottom && !p.dress) html += `<div class="missing" style="top:62%">Ajoute un bas</div>`;
  stage.innerHTML = html;
  stage.querySelectorAll('.piece').forEach(el => el.onclick = () => { if (!stage.dataset.swiped) swapPiece(el.dataset.slot); });
  // Liste des pièces sous le mannequin
  const strip = $('#pieces-strip');
  strip.innerHTML = SLOT_ORDER.filter(s => p[s] && state.items.find(i => i.id === p[s])).map(s => {
    const it = state.items.find(i => i.id === p[s]);
    return `<button data-slot="${s}"><img src="${itemUrl(it)}" alt=""><span><b>${esc(SLOT_NAME[s])}</b>${esc(it.name || it.color)}</span></button>`;
  }).join('');
  updateSaveBtn();
  strip.querySelectorAll('button').forEach(b => b.onclick = () => swapPiece(b.dataset.slot));
}

// Image de la tenue (vêtements à plat), utilisée pour la bibliothèque et Gemini
async function composeFlatLay(pieces) {
  const W = 900, H = 1200;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  const order = SLOT_ORDER.filter(s => pieces[s]).map(s => state.items.find(i => i.id === pieces[s])).filter(Boolean);
  const cols = order.length <= 2 ? 1 : 2;
  const rows = Math.ceil(order.length / cols);
  const cw = W / cols, ch = H / rows, pad = 30;
  for (let k = 0; k < order.length; k++) {
    const img = await blobToImage(order[k].image);
    const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
    const s = Math.min((cw - pad * 2) / img.naturalWidth, (ch - pad * 2) / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    g.drawImage(img, x + (cw - w) / 2, y + (ch - h) / 2, w, h);
  }
  return canvasToBlob(c, 'image/jpeg', 0.9);
}
function outfitDescription(pieces) {
  return SLOT_ORDER.filter(s => pieces[s]).map(s => {
    const it = state.items.find(i => i.id === pieces[s]);
    return it ? `${SLOT_NAME[s].toLowerCase()} : ${itemName(it)}` : null;
  }).filter(Boolean).join(', ');
}

// ---------- Bibliothèque ----------
async function saveCurrent(silent = false) {
  const cur = state.current;
  if (!cur) return null;
  const existing = cur.savedId && state.outfits.find(o => o.id === cur.savedId);
  const w = state.weather;
  const outfit = existing || {
    id: uid(),
    createdAt: Date.now(),
    pieces: { ...cur.pieces },
    weather: w ? { temp: Math.round(w.current.temperature_2m), code: w.current.weather_code, place: state.loc?.name } : null,
    name: '',
  };
  if (!existing) outfit.preview = await composeFlatLay(cur.pieces);
  if (cur.aiImage) outfit.aiImage = cur.aiImage;
  await db.put('outfits', outfit);
  if (!existing) state.outfits.push(outfit);
  cur.savedId = outfit.id;
  updateSaveBtn();
  if (!silent) toast('Tenue sauvegardée dans « Tenues » ✓');
  return outfit;
}
function updateSaveBtn() {
  const saved = !!state.current?.savedId;
  $('#btn-save').classList.toggle('saved', saved);
  $('#btn-save').setAttribute('aria-label', saved ? 'Tenue sauvegardée' : 'Sauvegarder');
}
$('#btn-save').onclick = async () => {
  if (!state.current) return;
  if (state.current.savedId) { toast('Déjà dans « Tenues » ✓'); return; }
  await saveCurrent();
  navigator.vibrate?.(15);
};

const outfitDate = o => new Date(o.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const outfitTitle = o => o.name || 'Tenue du ' + outfitDate(o);
function renderLibrary() {
  const list = [...state.outfits].sort((a, b) => b.createdAt - a.createdAt);
  $('#library-empty').classList.toggle('hidden', list.length > 0);
  $('#library-kicker').textContent = list.length ? `${list.length} tenue${list.length > 1 ? 's' : ''} sauvegardée${list.length > 1 ? 's' : ''}` : 'Ta bibliothèque';
  $('#library-list').innerHTML = list.map(o => {
    const main = o.aiImage || o.preview;
    const wx = o.weather ? ` · ${(WMO[o.weather.code] || [''])[0]} ${o.weather.temp}°` : '';
    return `<div class="lcard" data-id="${o.id}">
      <div class="img">${main ? `<img src="${blobUrl('o-' + o.id + (o.aiImage ? '-ai' : ''), main)}" alt="">` : ''}${o.aiImage ? '<span class="ai">✨ IA</span>' : ''}</div>
      <div class="meta"><b>${esc(outfitTitle(o))}</b><span>${outfitDate(o)}${wx}</span></div>
    </div>`;
  }).join('');
  $('#library-list').querySelectorAll('.lcard').forEach(card => card.onclick = () => openOutfit(state.outfits.find(x => x.id === card.dataset.id)));
}
let openedOutfit = null;
function openOutfit(o) {
  openedOutfit = o;
  $('#o-title').textContent = outfitTitle(o);
  const wx = o.weather ? ` · ${(WMO[o.weather.code] || [''])[0]} ${o.weather.temp}°${o.weather.place ? ' à ' + esc(o.weather.place) : ''}` : '';
  $('#o-meta').innerHTML = `Sauvegardée le ${outfitDate(o)}${wx}`;
  const imgs = [o.aiImage && blobUrl('o-' + o.id + '-ai', o.aiImage), o.preview && blobUrl('o-' + o.id, o.preview)].filter(Boolean);
  $('#o-images').innerHTML = imgs.map(u => `<img src="${u}" alt="">`).join('');
  $('#o-images').querySelectorAll('img').forEach((im, k) => im.onclick = () => viewImage(k === 0 && o.aiImage ? o.aiImage : o.preview));
  $('#o-minis').innerHTML = SLOT_ORDER.filter(s => o.pieces[s]).map(s => {
    const it = state.items.find(i => i.id === o.pieces[s]);
    return it ? `<button><img src="${itemUrl(it)}" alt=""><span><b>${esc(SLOT_NAME[s])}</b>${esc(it.name || it.color)}</span></button>` : '';
  }).join('');
  $('#osheet').classList.remove('hidden');
}
const closeOutfit = () => { $('#osheet').classList.add('hidden'); openedOutfit = null; };
$('#o-close').onclick = closeOutfit;
$('#osheet').onclick = e => { if (e.target.id === 'osheet') closeOutfit(); };
$('#o-wear').onclick = () => {
  const o = openedOutfit;
  state.current = { pieces: { ...o.pieces }, savedId: o.id, aiImage: o.aiImage || null };
  closeOutfit(); showTab('today'); renderStage();
  $('#outfit-hint').textContent = outfitTitle(o);
  $('#ai-result').innerHTML = o.aiImage ? `<img src="${blobUrl('o-' + o.id + '-ai', o.aiImage)}" alt="">` : '';
};
$('#o-img').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const o = openedOutfit;
  o.aiImage = await downscale(f, 1400);
  await db.put('outfits', o); e.target.value = '';
  renderLibrary(); openOutfit(o); toast('Image ajoutée ✓');
};
$('#o-rename').onclick = async () => {
  const o = openedOutfit;
  const n = prompt('Nom de la tenue', o.name || ''); if (n === null) return;
  o.name = n.trim(); await db.put('outfits', o); renderLibrary(); openOutfit(o);
};
$('#o-del').onclick = async () => {
  const o = openedOutfit;
  if (!confirm('Supprimer cette tenue de la bibliothèque ?')) return;
  await db.del('outfits', o.id);
  state.outfits = state.outfits.filter(x => x.id !== o.id);
  if (state.current?.savedId === o.id) { state.current.savedId = null; updateSaveBtn(); }
  closeOutfit(); renderLibrary();
};
function viewImage(blob) {
  if (!blob) return;
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="">`;
  v.onclick = () => v.remove();
  document.body.appendChild(v);
}

// ---------- Gemini (gratuit, dans l'appli Gemini) ----------
$('#btn-gemini').onclick = async () => {
  if (!state.current) return;
  const desc = outfitDescription(state.current.pieces);
  const person = await kv.get('person');
  const prompt = `Génère une photo réaliste, en pied, ${person ? 'de la personne de la deuxième image' : "d'un mannequin"} portant exactement les vêtements de la première image (${desc}). Garde les couleurs, matières et motifs des vêtements. Fond neutre clair, lumière douce, pose naturelle de face.`;
  try { await navigator.clipboard.writeText(prompt); } catch {}
  const flat = await composeFlatLay(state.current.pieces);
  const files = [new File([flat], 'tenue.jpg', { type: 'image/jpeg' })];
  if (person) files.push(new File([person], 'moi.jpg', { type: person.type || 'image/jpeg' }));
  if (navigator.canShare && navigator.canShare({ files })) {
    toast('Consigne copiée. Choisis Gemini, puis colle la consigne.', 5000);
    try { await navigator.share({ files, text: prompt }); } catch {}
  } else {
    viewImage(flat);
    toast('Consigne copiée. Enregistre l\'image et envoie-la à Gemini.', 5000);
  }
  await saveCurrent(true);
  toast('Tenue ajoutée à « Tenues ». Tu pourras y joindre l\'image de Gemini.', 5000);
};

// ---------- Essayage IA (Hugging Face, gratuit avec quota) ----------
async function whiteBg(blob) {
  const img = await blobToImage(blob);
  const c = document.createElement('canvas');
  c.width = 768; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  const s = Math.min(700 / img.naturalWidth, 950 / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  return canvasToBlob(c, 'image/jpeg', 0.92);
}
let aiBusy = false;
$('#btn-ai').onclick = async () => {
  if (!state.current || aiBusy) return;
  const person = await kv.get('person');
  if (!person) { toast("Ajoute d'abord une photo de toi dans Réglages."); showTab('settings'); return; }
  const p = state.current.pieces;
  // Ce modèle habille le haut du corps : on prend la couche la plus visible
  const slot = ['outer', 'mid', 'top', 'dress'].find(s => p[s]);
  if (!slot) { toast('Il faut au moins un haut dans la tenue.'); return; }
  const garment = state.items.find(i => i.id === p[slot]);
  const token = (await kv.get('hfToken')) || '';
  const space = (await kv.get('hfSpace')) || DEFAULT_SPACE;
  const status = $('#ai-status');
  aiBusy = true; $('#btn-ai').disabled = true;
  status.innerHTML = `<span class="spinner"></span>Essayage de : ${esc(itemName(garment))}… (30 s à 2 min)`;
  try {
    const { Client } = await import(GRADIO_URL);
    const opts = token ? { hf_token: token } : {};
    const client = await Client.connect(space, opts);
    const res = await client.predict('/tryon', [
      { background: person, layers: [], composite: null },
      await whiteBg(garment.image),
      itemName(garment),
      true, true, 30, Math.floor(Math.random() * 100000),
    ]);
    const out = res.data[0];
    const url = typeof out === 'string' ? out : out.url;
    const r = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    const blob = await r.blob();
    state.current.aiImage = blob;
    $('#ai-result').innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="Essayage">`;
    await saveCurrent(true);
    status.textContent = 'Image enregistrée dans « Tenues » ✓ (pas besoin de la regénérer)';
  } catch (err) {
    console.warn(err);
    const m = String(err?.message || err);
    if (/quota|exceeded|GPU|limit/i.test(m)) status.textContent = 'Quota gratuit atteint pour le moment. Réessaie plus tard, ou utilise « Envoyer à Gemini ».';
    else if (/token|auth|401|403/i.test(m)) status.textContent = 'Clé Hugging Face refusée. Vérifie-la dans Réglages.';
    else status.textContent = "L'essayage n'a pas marché (le modèle gratuit est peut-être en pause). Réessaie plus tard, ou utilise « Envoyer à Gemini ».";
  } finally {
    aiBusy = false; $('#btn-ai').disabled = false;
  }
};

// ---------- Réglages ----------
$('#city-search').onclick = async () => {
  const q = $('#city-input').value.trim(); if (!q) return;
  const box = $('#city-results');
  box.innerHTML = '<span class="spinner"></span>';
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=fr&format=json`);
    const j = await r.json();
    if (!j.results?.length) { box.innerHTML = '<div class="muted small">Aucune ville trouvée.</div>'; return; }
    box.innerHTML = j.results.map((c, i) => `<button class="city" data-i="${i}">${esc(c.name)} <span class="muted small">${esc([c.admin1, c.country].filter(Boolean).join(', '))}</span></button>`).join('');
    box.querySelectorAll('.city').forEach(b => b.onclick = async () => {
      const c = j.results[+b.dataset.i];
      state.loc = { mode: 'city', lat: c.latitude, lon: c.longitude, name: c.name };
      await kv.set('loc', state.loc);
      box.innerHTML = '';
      toast(`Météo de ${c.name} ✓`);
      loadWeather(true);
    });
  } catch { box.innerHTML = '<div class="muted small">Recherche impossible (pas de réseau ?).</div>'; }
};
$('#use-gps').onclick = async () => { state.loc = null; await kv.set('loc', null); loadWeather(true, true); toast('Position mise à jour'); };
$('#person-input').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const b = await downscale(f, 1024);
  await kv.set('person', b);
  showPerson(b); toast('Photo enregistrée ✓');
};
function showPerson(b) { const i = $('#person-preview'); if (b) { i.src = URL.createObjectURL(b); i.classList.remove('hidden'); } }
$('#hf-token').onchange = e => kv.set('hfToken', e.target.value.trim());
$('#hf-space').onchange = e => kv.set('hfSpace', e.target.value.trim());

// Export / import
const blobToDataUrl = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const dataUrlToBlob = async u => (await fetch(u)).blob();
$('#export-btn').onclick = async () => {
  toast('Préparation de la sauvegarde…');
  const items = await Promise.all(state.items.map(async i => ({ ...i, image: await blobToDataUrl(i.image) })));
  const outfits = await Promise.all(state.outfits.map(async o => ({
    ...o, preview: o.preview ? await blobToDataUrl(o.preview) : null, aiImage: o.aiImage ? await blobToDataUrl(o.aiImage) : null,
  })));
  const blob = new Blob([JSON.stringify({ app: 'garde-robe', v: 1, items, outfits })], { type: 'application/json' });
  const name = `garde-robe-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch {} }
  else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
};
$('#import-input').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== 'garde-robe') throw new Error('format');
    for (const i of j.items) { i.image = await dataUrlToBlob(i.image); await db.put('items', i); }
    for (const o of j.outfits || []) {
      o.preview = o.preview ? await dataUrlToBlob(o.preview) : null;
      o.aiImage = o.aiImage ? await dataUrlToBlob(o.aiImage) : null;
      await db.put('outfits', o);
    }
    state.items = await db.all('items'); state.outfits = await db.all('outfits');
    toast(`Importé : ${j.items.length} vêtements, ${(j.outfits || []).length} tenues ✓`);
    renderWardrobe(); suggest();
  } catch { toast("Ce fichier n'est pas une sauvegarde valide."); }
  e.target.value = '';
};
async function storageInfo() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
    const est = await navigator.storage.estimate();
    $('#storage-info').textContent = `${state.items.length} vêtements · ${state.outfits.length} tenues · ${(est.usage / 1e6).toFixed(1)} Mo utilisés`;
  } catch {}
}

// ---------- Démarrage ----------
async function init() {
  state.items = await db.all('items');
  state.outfits = await db.all('outfits');
  $('#hf-token').value = (await kv.get('hfToken')) || '';
  $('#hf-space').value = (await kv.get('hfSpace')) || '';
  showPerson(await kv.get('person'));
  $('#fab-add').classList.add('hidden');
  renderWardrobe();
  renderKicker();
  storageInfo();
  loadWeather();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();

// Pour les tests
window.__gr = { state, suggest, planFor, colorScore, db };
