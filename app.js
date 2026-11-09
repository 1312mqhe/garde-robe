// Garde-robe : appli web locale (aucun serveur). Les données restent dans IndexedDB.
import { FACTS } from './facts.js';

const BG_REMOVAL_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
const GRADIO_URL = 'https://cdn.jsdelivr.net/npm/@gradio/client@1.19.1/+esm';
const DEFAULT_SPACE = 'yisol/IDM-VTON';

// ---------- Données de référence ----------
const CATS = {
  haut:       { label: 'T-shirt, top, polo', short: 'Haut', slot: 'top', warmth: 2 },
  chemise:    { label: 'Chemise, chemisier', short: 'Chemise', slot: 'top', warmth: 2 },
  pull:       { label: 'Pull, sweat, gilet', short: 'Pull', slot: 'mid', warmth: 3 },
  veste:      { label: 'Veste légère, blazer', short: 'Veste', slot: 'outer', warmth: 2 },
  manteau:    { label: 'Manteau, doudoune', short: 'Manteau', slot: 'outer', warmth: 4 },
  bas:        { label: 'Pantalon, jupe, short', short: 'Bas', slot: 'bottom', warmth: 3 },
  robe:       { label: 'Robe, combinaison', short: 'Robe', slot: 'dress', warmth: 2 },
  chaussures: { label: 'Chaussures', short: 'Chaussures', slot: 'shoes', warmth: 3 },
  accessoire: { label: 'Écharpe, bonnet, gants', short: 'Écharpe…', slot: 'acc', warmth: 4 },
  cravate:    { label: 'Cravate, nœud papillon', short: 'Cravate', slot: 'tie', warmth: 3 },
  style:      { label: 'Ceinture, sac, bijou, casquette', short: 'Accessoire', slot: 'style', warmth: 3 },
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
  ['bleu', 'bleu clair'], ['bleu clair', 'rose'], ['bordeaux', 'rose'], ['vert', 'bleu clair'], ['bordeaux', 'bleu clair'],
  ['jaune', 'bleu'], ['orange', 'bleu'], ['rouge', 'bleu clair'], ['violet', 'rose'], ['vert', 'jaune'], ['vert', 'rose'], ['jaune', 'bleu clair'],
];
// Couleurs vives qui se heurtent
const CLASH_PAIRS = [
  ['rouge', 'rose'], ['rouge', 'orange'], ['rouge', 'bordeaux'], ['rouge', 'violet'], ['rouge', 'vert'], ['orange', 'rose'],
  ['orange', 'violet'], ['orange', 'bordeaux'], ['jaune', 'violet'], ['jaune', 'rose'], ['vert', 'violet'], ['jaune', 'orange'],
];
// Neutres qu'on évite traditionnellement d'associer
const NEUTRAL_AVOID = [['noir', 'marron'], ['noir', 'bleu marine'], ['marron', 'gris']];
const inPairs = (list, a, b) => list.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

// Zones des pièces sur le mannequin (en % du cadre) et ordre d'empilement
// Les couches se superposent comme une veste ouverte : la plus chaude derrière et plus large,
// la plus fine devant et plus étroite, pour que chaque pièce reste visible.
const LAYOUT = {
  acc:    { l: 34, t: 12, w: 32, h: 12, z: 8 },
  tie:    { l: 44, t: 20, w: 12, h: 22, z: 6 },
  style:  { l: 70, t: 44, w: 24, h: 18, z: 9 },
  outer:  { l: 14, t: 17, w: 72, h: 44, z: 3 },
  mid:    { l: 21, t: 18.5, w: 58, h: 33, z: 4 },
  top:    { l: 29, t: 20, w: 42, h: 28, z: 5 },
  dress:  { l: 22, t: 19, w: 56, h: 58, z: 4 },
  bottom: { l: 26, t: 46, w: 48, h: 41, z: 2 },
  shoes:  { l: 25, t: 86, w: 50, h: 12, z: 1 },
};
const SLOT_ORDER = ['acc', 'outer', 'mid', 'top', 'tie', 'dress', 'bottom', 'shoes', 'style'];
const SLOT_NAME = { acc: 'Écharpe…', outer: 'Veste/manteau', mid: 'Pull', top: 'Haut', tie: 'Cravate', dress: 'Robe', bottom: 'Bas', shoes: 'Chaussures', style: 'Accessoire' };

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
  journal: [],
  prefs: { aff: {}, liked: [], disliked: [] },
  ideaIdx: 0,
  view: (() => { try { return localStorage.getItem('view') || 'mannequin'; } catch { return 'mannequin'; } })(),
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
  const nForgot = forgottenItems().length;
  $('#filter-chips').innerHTML = cats.map(c =>
    `<button data-c="${c}" class="${state.filter === c ? 'on' : ''}">${c === 'tout' ? 'Tout' : CATS[c].short}<span class="n">${count(c)}</span></button>`).join('')
    + (nForgot ? `<button data-c="oublies" class="forgot ${state.filter === 'oublies' ? 'on' : ''}">💤 Oubliés<span class="n">${nForgot}</span></button>` : '');
  $('#filter-chips').querySelectorAll('button').forEach(b => b.onclick = () => { state.filter = b.dataset.c; renderWardrobe(); });
}
function renderWardrobe() {
  renderFilters();
  const forgot = state.filter === 'oublies';
  if (forgot && !forgottenItems().length) state.filter = 'tout';
  const worn = lastWornMap();
  const list = forgot ? forgottenItems() : state.items.filter(i => state.filter === 'tout' || i.category === state.filter)
    .sort((a, b) => Object.keys(CATS).indexOf(a.category) - Object.keys(CATS).indexOf(b.category) || b.createdAt - a.createdAt);
  $('#wardrobe-empty').classList.toggle('hidden', state.items.length > 0);
  $('#wardrobe-grid').innerHTML = list.map(i =>
    `<div class="tile" data-id="${i.id}"><img src="${itemUrl(i)}" alt="${esc(itemName(i))}" loading="lazy"><span class="dot" style="background:${swatchCss(i.color)}"></span>${forgot ? `<span class="ago">${worn[i.id] ? 'il y a ' + daysSince(worn[i.id]) + ' j' : 'jamais portée'}</span>` : ''}</div>`).join('');
  $('#wardrobe-kicker').textContent = state.items.length ? `${state.items.length} vêtement${state.items.length > 1 ? 's' : ''}` : 'Ta garde-robe';
  $('#wardrobe-grid').querySelectorAll('.tile').forEach(t => t.onclick = () => openSheet(state.items.find(i => i.id === t.dataset.id)));
}

// Pièces pas portées depuis 30 jours (ou jamais, si elles sont dans le dressing depuis plus de 2 semaines)
function forgottenItems() {
  const worn = lastWornMap();
  return state.items.filter(i => worn[i.id] ? daysSince(worn[i.id]) > 30 : Date.now() - i.createdAt > 14 * DAY)
    .sort((a, b) => (worn[a.id] || '').localeCompare(worn[b.id] || '') || a.createdAt - b.createdAt);
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
  $('#item-stats').classList.toggle('hidden', !item);
  if (item) {
    const n = state.journal.filter(e => Object.values(e.pieces).includes(item.id)).length;
    const last = lastWornMap()[item.id];
    $('#item-stats').textContent = n ? `Portée ${n} fois · dernière fois ${new Date(last).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` : 'Jamais portée pour l\'instant';
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
    if (!force && cached && cached.data?.hourly && cached.lat === loc.lat && cached.lon === loc.lon && Date.now() - cached.at < 30 * 60 * 1000) {
      state.weather = cached.data;
    } else {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
        `&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day` +
        `&hourly=temperature_2m,apparent_temperature,precipitation_probability` +
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
// Températures ressenties du matin (7-10 h), de l'après-midi (12-17 h) et du soir (18-22 h)
function dayParts() {
  const h = state.weather?.hourly;
  if (!h?.time) return null;
  const today = h.time[0].slice(0, 10);
  const avg = (from, to, key) => {
    const v = h.time.map((t, i) => [t, h[key][i]]).filter(([t]) => t.startsWith(today) && +t.slice(11, 13) >= from && +t.slice(11, 13) <= to).map(x => x[1]);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const parts = { morning: [7, 10], afternoon: [12, 17], evening: [18, 22] };
  const out = {};
  for (const [k, [f, t]] of Object.entries(parts)) out[k] = { temp: avg(f, t, 'temperature_2m'), feels: avg(f, t, 'apparent_temperature') };
  return out.morning.temp === null ? null : out;
}
function weatherSummary() {
  const w = state.weather;
  if (!w) return { feels: 17, cold: 17, warm: 17, spread: 0, rain: false, wind: 10, snow: false };
  const cur = w.current, d = w.daily;
  const dayFeels = (d.apparent_temperature_max[0] + d.apparent_temperature_min[0]) / 2;
  const feels = cur.apparent_temperature * 0.6 + dayFeels * 0.4;
  const rain = isWetCode(cur.weather_code) || cur.precipitation > 0 || (d.precipitation_probability_max[0] ?? 0) >= 50 || isWetCode(d.weather_code[0]);
  const snow = isSnowCode(cur.weather_code) || isSnowCode(d.weather_code[0]);
  const parts = dayParts();
  // Le moment le plus froid décide des couches ; le plus chaud, de la pièce de base
  const hour = new Date().getHours();
  const pf = parts ? [hour <= 11 && parts.morning.feels, hour <= 17 && parts.afternoon.feels, parts.evening.feels].filter(x => x !== false && x !== null) : [];
  const cold = pf.length ? Math.min(...pf) : feels;
  const warm = pf.length ? Math.max(...pf) : feels;
  return { feels, cold, warm, spread: warm - cold, parts, rain: rain || snow, snow, wind: cur.wind_speed_10m };
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
      ${(() => { const p = dayParts(); return p ? `<span class="pill">Matin ${Math.round(p.morning.temp)}°</span><span class="pill">Après-midi ${Math.round(p.afternoon.temp)}°</span><span class="pill">Soir ${Math.round(p.evening.temp)}°</span>` : ''; })()}
      ${stale ? '<span class="pill">hors ligne</span>' : ''}
      ${state.loc?.mode === 'gps' ? '<span class="pill btn" id="refresh-gps"><svg class="ic"><use href="#i-pin"/></svg>Actualiser</span>' : ''}
    </div>`;
  $('#refresh-gps') && ($('#refresh-gps').onclick = () => loadWeather(true, true));
  renderKicker();
}
// ---------- Assistant ----------
const DEFAULT_NAME = 'Mahé';
const prefs = { name: DEFAULT_NAME, intro: true, fact: true };
function greetingWord() {
  const h = new Date().getHours();
  return h < 5 ? 'Bonne nuit' : h < 18 ? 'Bonjour' : 'Bonsoir';
}
function renderGreeting() {
  $('#greeting').textContent = `${greetingWord()} ${prefs.name}`.trim();
}
// Petite phrase de l'assistant, selon la météo et la tenue
function renderAssistantLine(plan) {
  const el = $('#assistant-line');
  if (!state.items.length) { el.innerHTML = "Ajoute quelques vêtements dans <b>Dressing</b> et je te proposerai une tenue chaque matin."; return; }
  if (!state.weather) { el.textContent = 'Voici une idée de tenue pour aujourd\'hui.'; return; }
  const w = weatherSummary(), cur = state.weather.current;
  const t = Math.round(cur.temperature_2m), f = Math.round(cur.apparent_temperature);
  const place = state.loc?.name ? ` à ${esc(state.loc.name)}` : '';
  let mood;
  if (w.cold >= 25) mood = 'Il fait chaud, je t\'ai choisi des pièces légères.';
  else if (w.cold >= 20) mood = 'Temps doux, parfait pour une tenue légère.';
  else if (w.cold >= 15) mood = 'Il fait frais, j\'ai ajouté une couche à retirer si besoin.';
  else if (w.cold >= 9) mood = 'Il fait frais, je t\'ai préparé une tenue en plusieurs couches.';
  else if (w.cold >= 3) mood = 'Il fait froid, manteau obligatoire !';
  else mood = 'Grand froid aujourd\'hui, couvre-toi bien.';
  let extra = w.snow ? ' Neige prévue, prévois de bonnes chaussures.' : w.rain ? ' Pluie prévue, pense au parapluie ☔' : w.wind > 35 ? ' Ça souffle fort, évite les tissus trop légers.' : '';
  if (w.spread >= 6 && w.parts) extra += ` Gros écart dans la journée (${Math.round(w.parts.morning.temp)}° le matin, ${Math.round(w.parts.afternoon.temp)}° l'après-midi) : garde une couche facile à enlever.`;
  el.innerHTML = `<b>${t}°${f !== t ? ` (${f}° ressentis)` : ''}</b>${place}. ${mood}${extra}`;
}

// Anecdote du jour : change à minuit, parcourt toute la liste avant de recommencer
function dayNumber() { const d = new Date(); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5); }
function renderFact() {
  const box = $('#fact');
  if (!prefs.fact) { box.classList.add('hidden'); return; }
  const n = FACTS.length;
  const [cat, text] = FACTS[(dayNumber() * 37) % n];
  box.innerHTML = `<div class="f-head"><span>Le saviez-vous ?</span><span>${cat}</span></div><p>${esc(text)}</p>
    <button class="link f-share"><svg class="ic"><use href="#i-share"/></svg>Partager</button>`;
  box.querySelector('.f-share').onclick = async () => {
    const msg = `Le saviez-vous ? ${text}`;
    if (navigator.share) { try { await navigator.share({ text: msg }); } catch {} }
    else { try { await navigator.clipboard.writeText(msg); toast('Anecdote copiée ✓'); } catch {} }
  };
  box.classList.remove('hidden');
}

// Animation d'ouverture : salut qui apparaît lettre par lettre sur un halo de couleur
function runIntro() {
  const el = $('#intro');
  el.classList.remove('hidden', 'leave');
  const hello = $('#intro-hello'), sub = $('#intro-sub');
  const letters = (txt, d0) => [...txt].map((ch, i) => `<span class="ch" style="animation-delay:${d0 + i * 65}ms">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
  const word = greetingWord();
  hello.innerHTML = letters(word, 250) + (prefs.name ? `<span class="name">${letters(prefs.name, 250 + word.length * 65 + 250)}</span>` : '');
  sub.classList.remove('show');
  let done = false; const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const finish = () => {
    if (done) return; done = true;
    timers.forEach(clearTimeout);
    el.classList.add('leave');
    setTimeout(() => { el.classList.add('hidden'); document.documentElement.classList.remove('intro-pending'); }, 950);
  };
  el.onclick = finish;
  const tSub = 250 + (word.length + prefs.name.length) * 65 + 1300;
  later(() => {
    const c = state.weather?.current;
    sub.textContent = c ? `${Math.round(c.temperature_2m)}°${state.loc?.name ? ' à ' + state.loc.name : ''} · ta tenue est prête` : 'Ta tenue du jour est prête';
    sub.classList.add('show');
  }, tSub);
  later(finish, tSub + 2100);
}

// Thèmes de couleur
const THEMES = [
  ['sapin', 'Vert sapin', 'linear-gradient(135deg,#1d5a42,#3d8e68)'],
  ['emeraude', 'Émeraude', 'linear-gradient(135deg,#0a6b50,#22a47c)'],
  ['sauge', 'Sauge', 'linear-gradient(135deg,#55705e,#8ba995)'],
  ['olive', 'Olive', 'linear-gradient(135deg,#6b7a3c,#a3b16a)'],
  ['graphite', 'Graphite', 'linear-gradient(135deg,#d9d9de,#f5f5f7)'],
  ['petrole', 'Bleu pétrole', 'linear-gradient(135deg,#0f4c5c,#2a8a9a)'],
  ['nuit', 'Bleu nuit', 'linear-gradient(135deg,#1f3a7a,#4a70c9)'],
  ['lavande', 'Lavande', 'linear-gradient(135deg,#5f5598,#9a8fd1)'],
  ['rose', 'Rose poudré', 'linear-gradient(135deg,#a4637a,#d9a0b2)'],
  ['bordeaux', 'Bordeaux', 'linear-gradient(135deg,#5e1a2c,#9c3a52)'],
  ['terracotta', 'Terracotta', 'linear-gradient(135deg,#9a4a2e,#d07a52)'],
  ['champagne', 'Champagne', 'linear-gradient(135deg,#9c7f4a,#d8bd85)'],
  ['sable', 'Sable', 'linear-gradient(135deg,#8a7a66,#c4b39b)'],
  ['violet', 'Violet', 'linear-gradient(135deg,#8b6cff,#ff5ca8)'],
];
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
  $('#themes').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  const th = THEMES.find(x => x[0] === t) || THEMES[0];
  $('#theme-name').textContent = th[1];
  $('#theme-dot').style.background = th[2];
}
function toggleThemes(open) {
  const o = open ?? $('#themes').classList.contains('collapsed');
  $('#themes').classList.toggle('collapsed', !o);
  $('#theme-toggle').setAttribute('aria-expanded', o);
}
$('#theme-toggle').onclick = () => toggleThemes();
$('#themes').innerHTML = THEMES.map(([id, label, g]) => `<button data-t="${id}"><i style="background:${g}"></i>${label}</button>`).join('');
$('#themes').querySelectorAll('button').forEach(b => b.onclick = () => { applyTheme(b.dataset.t); setTimeout(() => toggleThemes(false), 250); });
applyTheme(document.documentElement.dataset.theme || 'sapin');

function renderKicker() {
  const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#today-kicker').textContent = date[0].toUpperCase() + date.slice(1) + (state.loc?.name ? ' · ' + state.loc.name : '');
}
// ---------- Suggestions de tenues ----------
// Aucune part de hasard : toutes les combinaisons possibles sont notées selon des règles de mode
// (couleurs, superposition, météo, rotation des pièces, tes goûts), puis classées de la meilleure à la moins bonne.

// Besoin de chaque type de pièce selon la température ressentie : plage de chaleur et caractère obligatoire
function planFor(w) {
  const t = w.cold;
  let p;
  if (t >= 25) p = { top: [1, 2], bottom: [1, 2], dress: [1, 2], shoes: [1, 3], hint: 'Il fait chaud : tenue légère.' };
  else if (t >= 20) p = { top: [1, 3], bottom: [1, 3], dress: [1, 3], shoes: [1, 3], outer: w.wind > 30 ? { r: [1, 2], opt: true } : null, hint: 'Temps doux.' };
  else if (t >= 15) p = { top: [1, 3], bottom: [2, 4], dress: [1, 3], shoes: [2, 4], mid: { r: [2, 3], opt: true }, outer: { r: [1, 3], opt: true }, oneLayer: true, hint: 'Une couche en plus, à enlever si besoin.' };
  else if (t >= 9) p = { top: [1, 3], bottom: [2, 5], dress: [2, 4], shoes: [2, 5], mid: { r: [2, 4], opt: true }, outer: { r: [2, 4] }, hint: 'Frais : superpose les couches.' };
  else if (t >= 3) p = { top: [1, 4], bottom: [3, 5], dress: [3, 5], shoes: [3, 5], mid: { r: [3, 5] }, outer: { r: [3, 5] }, acc: { r: [3, 5], opt: true }, hint: 'Froid : manteau conseillé.' };
  else p = { top: [2, 5], bottom: [3, 5], dress: [4, 5], shoes: [3, 5], mid: { r: [3, 5] }, outer: { r: [4, 5] }, acc: { r: [4, 5] }, hint: 'Très froid : couvre-toi bien.' };
  // Grand écart dans la journée : la pièce de base suit le moment le plus chaud
  if (w.spread >= 6) {
    const warm = planFor({ ...w, cold: w.warm, spread: 0 });
    p.top = warm.top; p.dress = warm.dress;
    if (p.outer) p.outer.opt = false;
  }
  if (w.rain) { p.outer = p.outer ? { ...p.outer, opt: false } : { r: [1, 3] }; p.hint += ' Pluie prévue : imperméable conseillé.'; }
  return p;
}
const rangeOf = x => Array.isArray(x) ? x : x?.r;
function warmthFit(item, range) {
  if (!range) return 0;
  const [a, b] = range;
  if (item.warmth >= a && item.warmth <= b) return 1.5;
  return -Math.min(Math.abs(item.warmth - a), Math.abs(item.warmth - b)) * 2;
}
const lum = c => { const r = colorById(c).rgb; return r ? 0.3 * r[0] + 0.59 * r[1] + 0.11 * r[2] : 128; };

// Note d'un duo de couleurs
function colorPair(a, b) {
  if (a === 'imprimé' || b === 'imprimé') {
    if (a === b) return -4;                                     // jamais deux imprimés
    const other = a === 'imprimé' ? b : a;
    return colorById(other).neutral ? 0.6 : -1.5;               // un imprimé se porte avec du neutre
  }
  const na = colorById(a).neutral, nb = colorById(b).neutral;
  if (na && nb) {
    if (a === 'jean' && b === 'jean') return -3;                // pas de total look jean
    if (inPairs(NEUTRAL_AVOID, a, b)) return -1.2;
    return a === b ? 0.2 : 0.8;
  }
  if (na || nb) return 1;                                       // une couleur vive sur une base neutre
  if (a === b) return 0.3;                                      // ton sur ton
  if (inPairs(GOOD_PAIRS, a, b)) return 1;
  if (inPairs(CLASH_PAIRS, a, b)) return -3;
  return -1.2;
}
const pairKey = (x, y) => x < y ? `${x}|${y}` : `${y}|${x}`;
const outfitKey = pieces => Object.values(pieces).filter(Boolean).sort().join('|');
const DAY = 864e5;
const isoDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

// Dernière fois que chaque pièce a été portée (d'après le journal)
function lastWornMap() {
  const m = {};
  for (const e of state.journal) for (const id of Object.values(e.pieces)) if (!m[id] || m[id] < e.date) m[id] = e.date;
  return m;
}
function daysSince(dateStr) { return dateStr ? Math.round((new Date(isoDay()) - new Date(dateStr)) / DAY) : Infinity; }

// Note complète d'une tenue, avec les raisons à afficher
function scoreOutfit(items, ctx) {
  const { plan, w, worn } = ctx;
  let s = 0;
  const why = [];
  // Couleurs : chaque duo de pièces
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i], B = items[j];
    if (A.slot === 'shoes' && B.slot === 'shoes') continue;
    s += colorPair(A.it.color, B.it.color) * (A.slot === 'style' || B.slot === 'style' ? 0.5 : 1);
    s += Math.max(-3, Math.min(3, (state.prefs.aff[pairKey(A.it.id, B.it.id)] || 0) * 0.8));
  }
  const accents = [...new Set(items.filter(x => !colorById(x.it.color).neutral && x.it.color !== 'imprimé').map(x => x.it.color))];
  if (accents.length === 0) { s += 0.5; why.push('Tout en neutres : élégant et facile à porter.'); }
  else if (accents.length === 1) { s += 1.5; why.push(`Une seule couleur forte (${accents[0]}) sur une base neutre : la règle d'or.`); }
  else if (accents.length === 2 && inPairs(GOOD_PAIRS, accents[0], accents[1])) why.push(`${accents[0][0].toUpperCase() + accents[0].slice(1)} et ${accents[1]} : un duo harmonieux.`);
  else if (accents.length >= 3) s -= 4;                           // trois couleurs vives maximum… deux, c'est mieux
  const by = Object.fromEntries(items.map(x => [x.slot, x.it]));
  // Haut et bas : contraste, et pas exactement la même couleur
  if (by.top && by.bottom) {
    if (by.top.color === by.bottom.color && by.top.color !== 'noir') s -= 1;
    else if (lum(by.top.color) > lum(by.bottom.color) + 25) s += 0.4;   // clair en haut, foncé en bas
  }
  // Cravate : seulement avec une chemise, idéalement sous une veste
  if (by.tie) {
    if (!by.top || by.top.category !== 'chemise') s -= 50;
    s += by.outer?.category === 'veste' ? 1.5 : -2.5;
    if (by.outer?.category === 'veste') why.push('Chemise, cravate et veste : allure habillée.');
  }
  // Accessoire de style : assorti aux chaussures (règle cuir) ou neutre
  if (by.style) {
    s -= 0.4;
    if (by.shoes && by.style.color === by.shoes.color) { s += 1.2; why.push('Accessoire assorti aux chaussures.'); }
  }
  // Superposition : en mi-saison, une seule couche suffit
  if (plan.oneLayer) s += (by.mid && by.outer) ? -1.5 : (by.mid || by.outer) ? 0.5 : -2;
  // Chaleur et pluie
  for (const x of items) {
    s += warmthFit(x.it, rangeOf(plan[x.slot])) * 0.8;
    if (w.rain && (x.slot === 'outer' || x.slot === 'shoes')) s += x.it.rainOk ? 1 : -0.8;
    // Rotation : on évite ce qui a été porté ces derniers jours, on remet en avant les pièces oubliées
    const d = daysSince(worn[x.it.id]);
    if (x.slot !== 'shoes' && x.slot !== 'outer') s += d <= 1 ? -3 : d <= 3 ? -1.2 : d <= 7 ? -0.4 : d > 30 ? 0.3 : 0;
    else s += d <= 1 ? -0.5 : 0;
  }
  return { s, why };
}

const bySlot = slot => state.items.filter(i => CATS[i.category].slot === slot && !state.prefs.hidden?.includes(i.id));

// Pièces possibles pour un emplacement, classées par adéquation à la météo
function candidatesFor(slot, plan, w, limit = 8) {
  const all = bySlot(slot);
  const range = rangeOf(plan[slot]);
  const rank = i => warmthFit(i, range) + ((w.rain && (slot === 'outer' || slot === 'shoes') && i.rainOk) ? 1 : 0);
  return [...all].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id)).slice(0, limit);
}

// Construit la liste classée des meilleures tenues (recherche par faisceau, déterministe)
function buildIdeas() {
  const w = weatherSummary();
  const plan = planFor(w);
  const ctx = { plan, w, worn: lastWornMap() };
  const disliked = new Set(state.prefs.disliked);
  const evalP = parts => scoreOutfit(parts, ctx).s;
  const BEAM = 50;
  let beams = [];
  // Base : haut + bas, ou robe
  for (const t of candidatesFor('top', plan, w)) for (const b of candidatesFor('bottom', plan, w)) beams.push([{ slot: 'top', it: t }, { slot: 'bottom', it: b }]);
  if (w.cold >= 9 || !beams.length) for (const d of candidatesFor('dress', plan, w)) beams.push([{ slot: 'dress', it: d }]);
  if (!beams.length) return { ideas: [], plan };
  const step = (slot, { opt = true, need = null } = {}) => {
    const cands = candidatesFor(slot, plan, w);
    if (!cands.length) return;
    const next = [];
    for (const b of beams) {
      if (need && !need(b)) { next.push(b); continue; }
      if (opt) next.push(b);
      for (const c of cands) next.push([...b, { slot, it: c }]);
    }
    beams = next.map(b => [evalP(b), b]).sort((x, y) => y[0] - x[0] || outfitKey(Object.fromEntries(x[1].map(p => [p.slot, p.it.id]))).localeCompare(outfitKey(Object.fromEntries(y[1].map(p => [p.slot, p.it.id]))))).slice(0, BEAM).map(x => x[1]);
  };
  step('shoes', { opt: false });
  if (plan.mid) step('mid', { opt: plan.mid.opt !== false });
  if (plan.outer) step('outer', { opt: plan.outer.opt !== false });
  step('tie', { need: b => b.some(p => p.slot === 'top' && p.it.category === 'chemise') });
  if (plan.acc) step('acc', { opt: plan.acc.opt !== false });
  step('style');
  // Classement final, sans les tenues que tu n'as pas aimées
  const scored = beams.map(b => {
    const pieces = Object.fromEntries(b.map(p => [p.slot, p.it.id]));
    const r = scoreOutfit(b, ctx);
    return { pieces, key: outfitKey(pieces), score: r.s + (state.prefs.liked.includes(outfitKey(pieces)) ? 1 : 0), why: r.why };
  }).filter(o => !disliked.has(o.key)).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  // Variété : on alterne les bases (haut + bas) avant de reproposer la même
  const ideas = [], seenBase = new Set();
  for (const o of scored) { const base = [o.pieces.top, o.pieces.bottom, o.pieces.dress].join(); if (!seenBase.has(base)) { seenBase.add(base); ideas.push(o); } }
  for (const o of scored) if (!ideas.includes(o)) ideas.push(o);
  return { ideas: ideas.slice(0, 30), plan };
}

function suggest(advance = false) {
  if (!state.items.length) {
    $('#stage').innerHTML = mannequinSvg() + `<div class="missing" style="top:45%">Ajoute des vêtements dans « Dressing »</div>`;
    $('#outfit-hint').textContent = '';
    renderAssistantLine();
    $('#pieces-strip').innerHTML = '';
    state.current = null;
    updateSaveBtn();
    return;
  }
  const { ideas, plan } = buildIdeas();
  if (!ideas.length) return;
  state.ideaIdx = advance ? (state.ideaIdx + 1) % ideas.length : 0;
  const idea = ideas[state.ideaIdx];
  state.current = { pieces: idea.pieces, key: idea.key };
  $('#outfit-hint').innerHTML = `${esc(plan.hint)}${idea.why.length ? '<br><span class="why">' + esc(idea.why.join(' ')) + '</span>' : ''}`;
  $('#idea-count').textContent = `Idée ${state.ideaIdx + 1} sur ${ideas.length}`;
  renderAssistantLine(plan);
  renderStage();
  $('#ai-result').innerHTML = '';
  $('#ai-status').textContent = '';
}
// Petite animation entre deux idées
function animateSuggest(dir = -1) {
  const st = $('#stage');
  st.style.setProperty('--dx', `${dir * 40}px`);
  st.classList.add('out');
  setTimeout(() => { suggest(true); st.style.setProperty('--dx', `${-dir * 40}px`); requestAnimationFrame(() => st.classList.remove('out')); }, 180);
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

// Change une seule pièce : propose la meilleure alternative suivante pour cet emplacement
function swapPiece(slot) {
  const w = weatherSummary(), plan = planFor(w);
  const ctx = { plan, w, worn: lastWornMap() };
  const cur = state.current.pieces;
  const others = Object.entries(cur).filter(([s]) => s !== slot).map(([s, id]) => ({ slot: s, it: state.items.find(i => i.id === id) })).filter(x => x.it);
  const ranked = bySlot(slot).map(it => ({ it, s: scoreOutfit([...others, { slot, it }], ctx).s })).sort((a, b) => b.s - a.s || a.it.id.localeCompare(b.it.id));
  if (ranked.length < 2) { toast(`Pas d'autre ${SLOT_NAME[slot].toLowerCase()} dans ton dressing.`); return; }
  const idx = ranked.findIndex(r => r.it.id === cur[slot]);
  cur[slot] = ranked[(idx + 1) % ranked.length].it.id;
  state.current.key = outfitKey(cur);
  state.current.aiImage = null; state.current.savedId = null;
  $('#ai-result').innerHTML = '';
  renderStage();
  navigator.vibrate?.(10);
}

// ---------- J'aime / J'aime pas ----------
async function savePrefs() { await kv.set('prefs', state.prefs); }
async function rateCurrent(like) {
  if (!state.current) return;
  const ids = Object.values(state.current.pieces);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const k = pairKey(ids[i], ids[j]);
    state.prefs.aff[k] = Math.max(-4, Math.min(4, (state.prefs.aff[k] || 0) + (like ? 1 : -1)));
  }
  const key = outfitKey(state.current.pieces);
  if (like) { if (!state.prefs.liked.includes(key)) state.prefs.liked.push(key); state.prefs.disliked = state.prefs.disliked.filter(k => k !== key); }
  else { if (!state.prefs.disliked.includes(key)) state.prefs.disliked.push(key); state.prefs.liked = state.prefs.liked.filter(k => k !== key); }
  await savePrefs();
  navigator.vibrate?.(12);
  if (like) { toast('Noté 👍 Je proposerai plus souvent ce genre d\'associations.'); updateRateBtns(); }
  else { toast('Noté 👎 Je ne te la reproposerai plus.'); state.ideaIdx = Math.max(-1, state.ideaIdx - 1); animateSuggest(-1); }
}
function updateRateBtns() {
  const key = state.current && outfitKey(state.current.pieces);
  $('#btn-like').classList.toggle('on', !!key && state.prefs.liked.includes(key));
}
$('#btn-like').onclick = () => rateCurrent(true);
$('#btn-dislike').onclick = () => rateCurrent(false);

// ---------- Journal : « Je la porte aujourd'hui » ----------
async function wearCurrent() {
  if (!state.current) return;
  const date = isoDay();
  state.journal = state.journal.filter(e => e.date !== date);
  state.journal.push({ date, pieces: { ...state.current.pieces }, weather: state.weather ? { temp: Math.round(state.weather.current.temperature_2m), code: state.weather.current.weather_code } : null });
  await kv.set('journal', state.journal);
  updateWearBtn();
  navigator.vibrate?.(15);
  toast('Notée dans ton journal ✓ Je varierai les pièces les prochains jours.');
}
function updateWearBtn() {
  const today = state.journal.find(e => e.date === isoDay());
  const worn = !!today && state.current && outfitKey(today.pieces) === outfitKey(state.current.pieces);
  $('#btn-wear').classList.toggle('on', worn);
  $('#btn-wear-label').textContent = worn ? 'Portée ✓' : 'Je la porte';
}
$('#btn-wear').onclick = wearCurrent;

// Vue mannequin ou « à plat »
function setView(v) {
  state.view = v;
  try { localStorage.setItem('view', v); } catch {}
  $('#view-toggle').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (state.current) renderStage();
}
$('#view-toggle').querySelectorAll('button').forEach(b => b.onclick = () => setView(b.dataset.v));

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
  stage.classList.toggle('flat', state.view === 'flat');
  let html = state.view === 'flat' ? '' : mannequinSvg();
  if (state.view === 'flat') {
    // Moodboard : les pièces côte à côte, légèrement inclinées comme posées sur une table
    const order = ['outer', 'mid', 'top', 'dress', 'tie', 'bottom', 'acc', 'shoes', 'style'].filter(sl => p[sl] && state.items.find(i => i.id === p[sl]));
    const big = new Set(['outer', 'dress', 'bottom']);
    const tilt = [-3, 2.5, -1.5, 3, -2.5, 1.5, -2, 2, -1];
    html = `<div class="flat-grid n${order.length}">` + order.map((sl, k) => {
      const it = state.items.find(i => i.id === p[sl]);
      return `<div class="flat-cell ${big.has(sl) ? 'big' : ''}" style="--tilt:${tilt[k]}deg"><img class="piece-flat" data-slot="${sl}" src="${itemUrl(it)}" alt="${esc(itemName(it))}"></div>`;
    }).join('') + '</div>';
    stage.innerHTML = html;
    stage.querySelectorAll('.piece-flat').forEach(el => el.onclick = () => { if (!stage.dataset.swiped) swapPiece(el.dataset.slot); });
  }
  if (state.view !== 'flat') for (const slot of SLOT_ORDER) {
    const it = state.items.find(i => i.id === p[slot]);
    if (!it) continue;
    const L = LAYOUT[slot];
    html += `<img class="piece tap" data-slot="${slot}" src="${itemUrl(it)}" alt="${esc(itemName(it))}"
      style="left:${L.l}%;top:${L.t}%;width:${L.w}%;height:${L.h}%;z-index:${L.z}">`;
  }
  if (state.view !== 'flat') {
  if (!p.top && !p.dress) html += `<div class="missing" style="top:30%">Ajoute un haut</div>`;
  if (!p.bottom && !p.dress) html += `<div class="missing" style="top:62%">Ajoute un bas</div>`;
  stage.innerHTML = html;
  }
  stage.querySelectorAll('.piece').forEach(el => el.onclick = () => { if (!stage.dataset.swiped) swapPiece(el.dataset.slot); });
  // Liste des pièces sous le mannequin
  const strip = $('#pieces-strip');
  strip.innerHTML = SLOT_ORDER.filter(s => p[s] && state.items.find(i => i.id === p[s])).map(s => {
    const it = state.items.find(i => i.id === p[s]);
    return `<button data-slot="${s}"><img src="${itemUrl(it)}" alt=""><span><b>${esc(SLOT_NAME[s])}</b>${esc(it.name || it.color)}</span></button>`;
  }).join('');
  updateSaveBtn();
  updateRateBtns();
  updateWearBtn();
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
  const journal = state.libView === 'journal';
  $('#journal-list').classList.toggle('hidden', !journal);
  $('#library-list').classList.toggle('hidden', journal);
  if (journal) { $('#library-empty').classList.add('hidden'); renderJournal(); }
  const list = [...state.outfits].sort((a, b) => b.createdAt - a.createdAt);
  if (!journal) $('#library-empty').classList.toggle('hidden', list.length > 0);
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
state.libView = 'saved';
$('#lib-toggle').querySelectorAll('button').forEach(b => b.onclick = () => {
  state.libView = b.dataset.l;
  $('#lib-toggle').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  renderLibrary();
});
function renderJournal() {
  const list = [...state.journal].sort((a, b) => b.date.localeCompare(a.date));
  $('#journal-list').innerHTML = list.length ? list.map(e => {
    const d = new Date(e.date);
    const minis = SLOT_ORDER.filter(sl => e.pieces[sl]).map(sl => state.items.find(i => i.id === e.pieces[sl])).filter(Boolean);
    return `<div class="glass jentry"><div class="jdate"><b>${d.getDate()}</b><span>${d.toLocaleDateString('fr-FR', { month: 'short' })}</span></div>
      <div class="jminis">${minis.map(i => `<img src="${itemUrl(i)}" alt="">`).join('')}</div>
      ${e.weather ? `<div class="jwx">${(WMO[e.weather.code] || [''])[0]} ${e.weather.temp}°</div>` : ''}</div>`;
  }).join('') : `<div class="empty"><p>Ton journal est vide</p><p class="muted">Touche « Je la porte » sur la tenue du jour pour la noter ici.</p></div>`;
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
$('#user-name').onchange = async e => { prefs.name = e.target.value.trim(); await kv.set('userName', prefs.name); renderGreeting(); };
$('#intro-on').onchange = e => { prefs.intro = e.target.checked; kv.set('introOn', prefs.intro); try { localStorage.setItem('introOn', prefs.intro ? '1' : '0'); } catch {} };
$('#fact-on').onchange = e => { prefs.fact = e.target.checked; kv.set('factOn', prefs.fact); renderFact(); };
$('#intro-replay').onclick = () => runIntro();
// Si l'appli reste ouverte en fond, on remet à jour le salut et l'anecdote au retour
document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderGreeting(); renderFact(); } });
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
  const blob = new Blob([JSON.stringify({ app: 'garde-robe', v: 2, items, outfits, journal: state.journal, prefs: state.prefs })], { type: 'application/json' });
  const name = `garde-robe-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  let ok = true;
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch (e) { ok = e?.name !== 'AbortError'; } }
  else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
  if (ok) { await kv.set('lastBackup', Date.now()); renderBackupBanner(); toast('Sauvegarde prête ✓ Choisis « Enregistrer dans Fichiers » pour la garder sur iCloud.', 5000); }
};
// Rappel de sauvegarde : une fois par mois (et 2 semaines après la première pièce)
async function renderBackupBanner() {
  const last = await kv.get('lastBackup');
  const snooze = (await kv.get('backupSnooze')) || 0;
  const first = state.items.length ? Math.min(...state.items.map(i => i.createdAt)) : Date.now();
  const due = state.items.length >= 3 && Date.now() > snooze && (last ? Date.now() - last > 30 * DAY : Date.now() - first > 14 * DAY);
  $('#backup-banner').classList.toggle('hidden', !due);
  if (last) $('#backup-msg').textContent = `Dernière sauvegarde il y a ${Math.round((Date.now() - last) / DAY)} jours. Mets une copie à l'abri dans iCloud ou Fichiers.`;
  $('#backup-info').textContent = last ? `Dernière sauvegarde : ${new Date(last).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Aucune sauvegarde pour l\'instant.';
}
$('#backup-now').onclick = () => $('#export-btn').click();
$('#backup-later').onclick = async () => { await kv.set('backupSnooze', Date.now() + 7 * DAY); renderBackupBanner(); };
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
    if (j.journal) { const dates = new Set(state.journal.map(e => e.date)); state.journal.push(...j.journal.filter(e => !dates.has(e.date))); await kv.set('journal', state.journal); }
    if (j.prefs) { state.prefs = { ...state.prefs, ...j.prefs }; await savePrefs(); }
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
  prefs.name = (await kv.get('userName')) ?? DEFAULT_NAME;
  prefs.intro = (await kv.get('introOn')) ?? true;
  prefs.fact = (await kv.get('factOn')) ?? true;
  $('#user-name').value = prefs.name;
  $('#intro-on').checked = prefs.intro;
  $('#fact-on').checked = prefs.fact;
  renderGreeting();
  renderFact();
  state.items = await db.all('items');
  try { localStorage.setItem('introOn', prefs.intro ? '1' : '0'); } catch {}
  if (prefs.intro && !sessionStorage.getItem('introSeen')) { sessionStorage.setItem('introSeen', '1'); runIntro(); }
  else document.documentElement.classList.remove('intro-pending');
  state.outfits = await db.all('outfits');
  state.journal = (await kv.get('journal')) || [];
  state.prefs = { aff: {}, liked: [], disliked: [], ...((await kv.get('prefs')) || {}) };
  setView(state.view);
  renderBackupBanner();
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
window.__gr = { state, suggest, planFor, buildIdeas, db, kv };
