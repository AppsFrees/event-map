// Eventmaps — PWA conectada a Firebase (Auth, Firestore, Cloud Messaging, App Check, Analytics). Todo en el plan gratuito Spark.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import { getAnalytics, logEvent, isSupported as analyticsSupported } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-analytics.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app-check.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, GoogleAuthProvider, sendEmailVerification, sendPasswordResetEmail,
  updateProfile, signOut, reload
} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, increment, Timestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js';
import { getMessaging, getToken, deleteToken, isSupported as messagingSupported } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-messaging.js';
import { firebaseConfig, appSettings } from './firebase-config.js';
import {getPaymentSettings, enabledMethods, paymentDetails, wirePaymentCopy, paymentRevision, renderPaymentSettings, whatsappURL, installMapEffects, getAmountPEN, getAmountUSD, planLabel, planStatus, formatDateES, REMIND_DAYS} from './payment-settings.js';


// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------
const app = initializeApp(firebaseConfig);
if (appSettings.appCheckSiteKey) {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  try {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appSettings.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  } catch (e) { console.warn('App Check no se pudo iniciar', e); }
}
const auth = getAuth(app);
auth.languageCode = 'es';
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
let messaging = null;
const messagingReady = messagingSupported().then(ok => { if (ok && appSettings.vapidKey) messaging = getMessaging(app); return messaging; }).catch(() => null);
let analytics = null;
analyticsSupported().then(ok => { if (ok) analytics = getAnalytics(app); }).catch(() => {});
const track = (name, params = {}) => { try { if (analytics) logEvent(analytics, name, params); } catch (_) {} };

// PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(e => console.warn('SW', e)));
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = s => document.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dateISO = d => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const datePlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return dateISO(d); };
const todayISO = () => dateISO(new Date());
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const startAtOf = (date, time) => Timestamp.fromDate(new Date(`${date}T${time || '00:00'}:00`));
const fmtDate = iso => { try { return new Date(iso + 'T12:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }); } catch (_) { return iso; } };

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 3800); }
function errMsg(e) {
  const c = e?.code || '';
  const map = {
    'permission-denied': 'No tienes permiso para esta acción.', 'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/email-already-in-use': 'Ese correo ya tiene una cuenta. Inicia sesión.', 'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/popup-closed-by-user': 'Se cerró la ventana de Google.', 'auth/too-many-requests': 'Demasiados intentos. Espera un momento.',
    'auth/network-request-failed': 'Sin conexión. Revisa tu internet.', 'unavailable': 'Sin conexión: se guardará al reconectar.'
  };
  return map[c] || map[c.replace('firestore/', '')] || (e?.message || 'Ocurrió un error.');
}

function sanitizeRichHTML(input) {
  const t = document.createElement('template'); t.innerHTML = String(input || '');
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI']);
  const clean = node => [...node.childNodes].forEach(ch => {
    if (ch.nodeType === Node.TEXT_NODE) return;
    if (ch.nodeType !== Node.ELEMENT_NODE) { ch.remove(); return; }
    if (!allowed.has(ch.tagName)) { ch.replaceWith(document.createTextNode(ch.textContent || '')); return; }
    [...ch.attributes].forEach(a => ch.removeAttribute(a.name)); clean(ch);
  });
  clean(t.content); return t.innerHTML.slice(0, 4000);
}
const richText = v => sanitizeRichHTML(v || '');
const plainText = html => { const d = document.createElement('div'); d.innerHTML = sanitizeRichHTML(html); return d.textContent || ''; };

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const planLimits = { Free: { photos: 1, events: 1 }, Standard: { photos: 3, events: 3 }, Pro: { photos: 5, events: 10 } };
const DEFAULT_CATEGORIES = ['Gastronomía', 'Entretenimiento', 'Tienda'];
const PERU_DEPARTMENTS = [
  'Amazonas', 'Áncash', 'Apurímac', 'Arequipa', 'Ayacucho', 'Cajamarca', 'Callao', 'Cusco',
  'Huancavelica', 'Huánuco', 'Ica', 'Junín', 'La Libertad', 'Lambayeque', 'Lima', 'Loreto',
  'Madre de Dios', 'Moquegua', 'Pasco', 'Piura', 'Puno', 'San Martín', 'Tacna', 'Tumbes', 'Ucayali'
];
const COUNTRIES = ['Perú']; // Por ahora EventMaps opera solo en Perú
const DEPT_COORDS = {
  'Lima': [-12.0464, -77.0428, 12],
  'Callao': [-12.0566, -77.1181, 13],
  'Arequipa': [-16.4090, -71.5375, 13],
  'Cusco': [-13.5319, -71.9675, 13],
  'La Libertad': [-8.1118, -79.0287, 13],
  'Piura': [-5.1945, -80.6328, 13],
  'Lambayeque': [-6.7714, -79.8409, 13],
  'Junín': [-12.0651, -75.2049, 13],
  'Áncash': [-9.5278, -77.5278, 13],
  'Ica': [-14.0678, -75.7286, 13],
  'Puno': [-15.8422, -70.0199, 13],
  'Tacna': [-18.0146, -70.2536, 13],
  'Loreto': [-3.7491, -73.2538, 13],
  'San Martín': [-6.4853, -76.3686, 13],
  'Cajamarca': [-7.1617, -78.5126, 13],
  'Ayacucho': [-13.1588, -74.2239, 13],
  'Huánuco': [-9.9306, -76.2422, 13],
  'Ucayali': [-8.3791, -74.5539, 13]
};

const state = {
  user: null, profile: null, role: 'guest',
  businesses: new Map(), events: [], categories: [...DEFAULT_CATEGORIES],
  favorites: new Set(), agenda: new Map(), myBusinesses: [],
  filter: 'Todos', query: '', selected: null, userLocation: null, nearRadiusKm: 2,
  geoFilter: { country: 'Todos', department: 'Todos', district: 'Todos' },
  photoCache: new Map(), unsub: []
};
const isAdmin = () => state.role === 'admin';

// ---------------------------------------------------------------------------
// Preferencias: tema, tamaño de texto, movimiento
// ---------------------------------------------------------------------------
const prefs = Object.assign({ theme: 'auto', darkMap: true, fontScale: 1, reduceMotion: false }, JSON.parse(localStorage.getItem('em_prefs') || '{}'));
function applyPrefs() {
  const html = document.documentElement;
  html.dataset.theme = prefs.theme;
  const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  html.classList.toggle('dark-map', dark && prefs.darkMap);
  html.classList.toggle('reduce-motion', !!prefs.reduceMotion);
  html.style.setProperty('--fs', `${16 * prefs.fontScale}px`);
  document.querySelector('meta[name=theme-color]').content = dark ? '#111321' : '#4f46e5';
}
function savePrefs() {
  localStorage.setItem('em_prefs', JSON.stringify(prefs)); applyPrefs();
  if (state.user && state.profile) updateDoc(doc(db, 'users', state.user.uid), { theme: prefs.theme }).catch(() => {});
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);
applyPrefs();
installMapEffects();

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------
if (!window.L) {
  $('#map').innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;padding:30px;text-align:center"><div><strong>No se pudo cargar el mapa</strong><p class="muted" style="font-size:13px;margin-top:8px">Comprueba tu conexión a internet y vuelve a abrir Eventmaps.</p></div></div>';
  throw new Error('Leaflet no disponible');
}
const LIMA_CENTER = [-12.0464, -77.0428];
const PERU_BOUNDS = L.latLngBounds([-19.5, -82.5], [0.8, -67.5]);
const map = L.map('map', { zoomControl: false, attributionControl: true, keyboard: true, minZoom: 5, maxBounds: PERU_BOUNDS, maxBoundsViscosity: 0.8 }).setView(LIMA_CENTER, 12);
const mapProviders = [
  { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' } },
  { url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', options: { subdomains: 'abc', maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · HOT' } },
  { url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', options: { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' } }
];
let baseLayer = null;
function loadBaseMap(i = 0) {
  if (baseLayer) map.removeLayer(baseLayer);
  const p = mapProviders[i]; if (!p) { toast('No se pudo cargar el mapa. Revisa tu conexión.'); return; }
  let errors = 0, switched = false;
  baseLayer = L.tileLayer(p.url, { ...p.options, keepBuffer: 4 }).addTo(map);
  baseLayer.on('tileerror', () => { if (++errors >= 5 && !switched) { switched = true; loadBaseMap(i + 1); } });
}
loadBaseMap(0);
L.control.zoom({ position: 'topright' }).addTo(map);
map.whenReady(() => [250, 900].forEach(ms => setTimeout(() => map.invalidateSize({ pan: false }), ms)));
window.addEventListener('resize', debounce(() => map.invalidateSize({ pan: false }), 300));
const goldLayer = L.layerGroup().addTo(map);
const clusterLayer = L.markerClusterGroup ? L.markerClusterGroup({
  maxClusterRadius: 55, disableClusteringAtZoom: 16, showCoverageOnHover: false, spiderfyOnMaxZoom: true, chunkedLoading: true,
  iconCreateFunction: c => { const n = c.getChildCount(); const s = n < 10 ? 40 : n < 50 ? 48 : 56; return L.divIcon({ className: 'em-cluster-wrap', html: `<div class="em-cluster" style="width:${s}px;height:${s}px">${n}</div>`, iconSize: [s, s] }); }
}).addTo(map) : L.layerGroup().addTo(map);
const markerLayer = { clearLayers() { goldLayer.clearLayers(); clusterLayer.clearLayers(); } };
function updateMotion() {
  const bounds = map.getBounds(); let n = 0;
  goldLayer.eachLayer(m => { if (bounds.contains(m.getLatLng())) n++; });
  n += document.querySelectorAll('.leaflet-marker-pane .em-pin:not(.pro)').length;
  document.documentElement.classList.toggle('em-map-paused', document.hidden || n > 45);
}
map.on('moveend zoomend', debounce(updateMotion, 150));
document.addEventListener('visibilitychange', () => setTimeout(updateMotion, 0));
let gpsMarker = null, searchMarker = null;

// ---------------------------------------------------------------------------
// Datos en tiempo real (Firestore)
// ---------------------------------------------------------------------------
function subscribePublic() {
  try {
    const quick = JSON.parse(localStorage.getItem('em_quick_biz') || 'null');
    if (quick && Array.isArray(quick.list) && Date.now() - quick.t < 7 * 864e5 && !state.businesses.size) { state.businesses = new Map(quick.list.map(b => [b.id, b])); redraw(); }
  } catch (_) {}
  onSnapshot(query(collection(db, 'businesses'), where('status', '==', 'approved')), snap => {
    state.businesses = new Map(snap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    redraw();
    if (!snap.metadata.fromCache) setTimeout(() => { try { const list = [...state.businesses.values()].map(({ id, name, category, plan, lat, lng, address, department, district, country, promo, paused, subscriptionActive, subscriptionEnd, status }) => ({ id, name, category, plan, lat, lng, address, department, district, country, promo, paused, subscriptionActive, subscriptionEnd, status })); localStorage.setItem('em_quick_biz', JSON.stringify({ t: Date.now(), list })); } catch (_) {} }, 0);
    openFromURL();
  }, e => { console.error(e); $('#resultCount').textContent = 'No se pudieron cargar los negocios.'; });
  const onEvents = snap => { state.events = snap.docs.map(d => ({ id: d.id, ...d.data() })); redraw(); checkReminders(); };
  const since = datePlus(-30);
  const allEvents = () => onSnapshot(query(collection(db, 'events'), where('status', '==', 'approved')), snap => { onEvents({ docs: snap.docs.filter(d => (d.data().endDate || d.data().date || '') >= since) }); }, e => console.error(e));
  // Requiere el índice compuesto events(status ASC, endDate ASC). Si aún no existe, usa la consulta anterior.
  let stopRecent = null;
  stopRecent = onSnapshot(query(collection(db, 'events'), where('status', '==', 'approved'), where('endDate', '>=', since)), onEvents, e => {
    if (stopRecent) stopRecent();
    if (e.code === 'failed-precondition') console.warn('Crea el índice events(status, endDate) para descargar menos eventos:', e.message);
    else console.error(e);
    allEvents();
  });
  onSnapshot(collection(db, 'categories'), snap => {
    const cats = snap.docs.map(d => d.data()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(c => c.name).filter(Boolean);
    state.categories = cats.length ? cats : [...DEFAULT_CATEGORIES];
    renderChips(); redraw();
  }, e => console.error(e));
}

function subscribeUser(uid) {
  state.unsub.forEach(u => u()); state.unsub = [];
  state.unsub.push(onSnapshot(collection(db, 'users', uid, 'favorites'), s => { state.favorites = new Set(s.docs.map(d => d.id)); redraw(); refreshSheet(); }));
  state.unsub.push(onSnapshot(collection(db, 'users', uid, 'agenda'), s => { state.agenda = new Map(s.docs.map(d => [d.id, d.data().businessId])); redraw(); refreshSheet(); checkReminders(); }));
  state.unsub.push(onSnapshot(query(collection(db, 'businesses'), where('ownerUid', '==', uid)), s => { state.myBusinesses = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAccountButton(); checkPlanExpiry(); }));
}

// Alerta al dueño cuando su plan está por vencer (una vez al día por negocio)
function checkPlanExpiry() {
  const due = state.myBusinesses.filter(b => b.status === 'approved' && b.plan !== 'Free' && planStatus(b).days !== null && planStatus(b).days <= REMIND_DAYS);
  const key = b => `em_plan_alert_${b.id}_${todayISO()}`;
  const pending = due.filter(b => { try { return !localStorage.getItem(key(b)); } catch (_) { return true; } });
  if (!pending.length) return;
  const b = pending[0];
  try { localStorage.setItem(key(b), '1'); } catch (_) {}
  const st = planStatus(b);
  if ($('#modalBackdrop').classList.contains('show')) { toast(`⏰ ${b.name}: tu plan ${planLabel(b.plan)} ${st.label.toLowerCase()}.`); return; }
  const expired = st.days < 0;
  showModal(`${modalHeader(expired ? '⚠️ Tu plan venció' : '⏰ Tu plan está por vencer', esc(b.name))}
    <div class="banner ${expired || st.days === 0 ? 'warn' : 'info'}"><strong>Plan ${esc(planLabel(b.plan))}: ${esc(st.label)}</strong><br>Fecha de vencimiento: ${esc(formatDateES(b.subscriptionEnd))}</div>
    <p class="text-sm">${expired ? 'Tu negocio ya no aparece destacado en el mapa. Renueva para recuperar tu visibilidad.' : 'Renueva a tiempo para que tu negocio siga destacado en el mapa sin interrupciones. Los días que te quedan se suman a la renovación.'}</p>
    <div class="flex gap-2 mt-4"><button class="main-btn" id="renewNow">💳 Renovar ahora</button><button class="soft-btn" id="renewLater">Más tarde</button></div>`);
  $('#renewNow').onclick = () => { hideModal(); openPaymentModal(b); };
  $('#renewLater').onclick = hideModal;
}

const eventsOf = bid => state.events.filter(e => e.businessId === bid).sort((a, b) => a.date.localeCompare(b.date));
function eventStatus(e) { const t = todayISO(); if ((e.endDate || e.date) < t) return 'finalizado'; if (e.date > t) return 'próximo'; return 'vigente'; }
const statusLabel = s => s === 'vigente' ? '● Vigente' : s === 'próximo' ? '◷ Próximo' : '✓ Finalizado';
function subscriptionOk(b) { if (b.plan === 'Free') return true; return b.subscriptionActive === true && (!b.subscriptionEnd || b.subscriptionEnd >= todayISO()); }
function activeEvents(bid) { return eventsOf(bid).filter(e => eventStatus(e) !== 'finalizado'); }
function distanceKm(b) { const c = state.userLocation || [map.getCenter().lat, map.getCenter().lng]; return map.distance(c, [b.lat, b.lng]) / 1000; }
const iconFor = c => c === 'Gastronomía' ? '☕' : c === 'Entretenimiento' ? '♫' : c === 'Tienda' ? '🛍' : '✦';

function matches(b) {
  const evs = activeEvents(b.id);
  const q = state.query.toLowerCase();
  const searchCorpus = `${b.name} ${b.address} ${b.country || ''} ${b.department || ''} ${b.district || ''} ${b.category} ${evs.map(x => x.title + ' ' + plainText(x.description)).join(' ')}`.toLowerCase();
  if (q && !searchCorpus.includes(q)) return false;

  // Filtro geográfico estructurado
  const gf = state.geoFilter;
  if (gf.country !== 'Todos' && b.country && b.country !== gf.country) return false;
  if (gf.department !== 'Todos' && b.department && b.department !== gf.department) return false;
  if (gf.district !== 'Todos' && b.district && !b.district.toLowerCase().includes(gf.district.toLowerCase())) return false;

  const f = state.filter, t = todayISO();
  if (state.categories.includes(f)) return b.category === f;
  switch (f) {
    case 'Populares': return b.plan !== 'Free';
    case 'Promociones': return !!b.promo;
    case 'Hoy': return evs.some(x => x.date <= t && (x.endDate || x.date) >= t);
    case 'Fin de semana': { const sat = datePlus((6 - new Date().getDay() + 7) % 7), sun = datePlus(((6 - new Date().getDay() + 7) % 7) + 1); return evs.some(x => x.date <= sun && (x.endDate || x.date) >= sat); }
    case 'Cerca': return distanceKm(b) <= state.nearRadiusKm;
    case 'Favoritos': return state.favorites.has(b.id);
    case 'Mi agenda': return [...state.agenda.values()].includes(b.id);
    default: return true;
  }
}
function visibleBusinesses() {
  return [...state.businesses.values()].filter(b => !b.paused && subscriptionOk(b) && matches(b))
    .sort((a, b) => (b.plan === 'Pro') - (a.plan === 'Pro'));
}

function redraw() {
  markerLayer.clearLayers();
  const shown = visibleBusinesses();
  $('#resultCount').textContent = state.businesses.size === 0 ? 'Aún no hay negocios publicados.' : shown.length === 1 ? '1 negocio' : `${shown.length} negocios`;
  shown.forEach(b => {
    const label = b.name.length > 18 ? b.name.slice(0, 17) + '…' : b.name;
    const evCount = activeEvents(b.id).length;
    const markerVisual = b.mapImage ? `<img class="pin-photo" src="${esc(b.mapImage)}" alt="" loading="lazy">` : `<span class="pin-emoji" aria-hidden="true">${iconFor(b.category)}</span>`;
    const tier = esc((b.plan || 'free').toLowerCase());
    const html = `<div class="em-pin ${tier}" title="${esc(b.name)}"><div class="bubble pin-bubble ${tier}">${markerVisual}${state.favorites.has(b.id) ? '<span class="fav" aria-hidden="true">♥</span>' : ''}</div><span class="pin-name">${esc(label)}</span></div>`;
    const m = L.marker([b.lat, b.lng], {
      icon: L.divIcon({ className: 'bubble-wrap', html, iconSize: [130, 96], iconAnchor: [65, 70] }),
      title: `${b.name}, ${b.category}${evCount ? `, ${evCount} eventos` : ''}`, alt: b.name, keyboard: true, riseOnHover: true
    }).addTo(b.plan === 'Pro' ? goldLayer : clusterLayer);
    m.on('click', () => openBusiness(b.id));
    m.on('keypress', e => { if (e.originalEvent.key === 'Enter' || e.originalEvent.key === ' ') openBusiness(b.id); });
  });
  requestAnimationFrame(updateMotion);
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------
function renderChips() {
  const base = ['Todos', 'Cerca', 'Populares', ...state.categories, 'Promociones', 'Hoy', 'Fin de semana', 'Favoritos', 'Mi agenda'];
  if (!base.includes(state.filter)) state.filter = 'Todos';
  const labels = { Cerca: `📍 Cerca (${state.nearRadiusKm} km)`, Favoritos: '♥ Favoritos', 'Mi agenda': '✓ Mi agenda' };
  const g = state.geoFilter, geoOn = !(g.country === 'Todos' && g.department === 'Todos' && g.district === 'Todos');
  const geoChip = `<button class="chip" id="geoChip" aria-pressed="${geoOn}" aria-haspopup="dialog">📍 Ubicación</button>`;
  $('#chips').innerHTML = base.map((f, i) => `<button class="chip" data-filter="${esc(f)}" aria-pressed="${f === state.filter}">${esc(labels[f] || f)}</button>${i === 0 ? geoChip : ''}`).join('');
}
$('#chips').addEventListener('click', e => {
  if (e.target.closest('#geoChip')) { openGeoFilterModal(); return; }
  const btn = e.target.closest('[data-filter]'); if (!btn) return;
  const f = btn.dataset.filter;
  if ((f === 'Favoritos' || f === 'Mi agenda') && !state.user) { openAuth('Inicia sesión para ver tus favoritos y tu agenda en todos tus dispositivos.'); return; }
  state.filter = f; renderChips(); redraw(); track('filter', { filter: f });
});

// ---------------------------------------------------------------------------
// Búsqueda por texto y por dirección (Nominatim / OpenStreetMap)
// ---------------------------------------------------------------------------
async function geocode(q, opts = {}) {
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: String(opts.limit || 5), 'accept-language': 'es', addressdetails: '0', countrycodes: 'pe' });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('geocode');
  return (await r.json()).map(x => ({ name: x.display_name, lat: Number(x.lat), lng: Number(x.lon) }));
}
async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=es&zoom=18&addressdetails=1`);
    if (!r.ok) return { address: '', country: '', department: '', district: '' };
    const j = await r.json();
    const a = j.address || {};
    return {
      address: j.display_name || '',
      country: a.country || '',
      department: a.state || a.region || '',
      district: a.suburb || a.city_district || a.neighbourhood || a.city || a.town || ''
    };
  } catch (_) { return { address: '', country: '', department: '', district: '' }; }
}

function updateGeoBadge() {
  if ($('#chips')) renderChips();
  const badge = $('#geoFilterActiveBadge');
  if (!badge) return;
  const { country, department, district } = state.geoFilter;
  if (country === 'Todos' && department === 'Todos' && district === 'Todos') {
    badge.classList.add('hidden');
    badge.textContent = '';
  } else {
    badge.classList.remove('hidden');
    const label = [country !== 'Todos' ? country : '', department !== 'Todos' ? department : '', district !== 'Todos' ? district : ''].filter(Boolean).join(' · ');
    badge.textContent = `📍 ${label} ✕`;
  }
}

function openGeoFilterModal() {
  const currentCountry = state.geoFilter.country;
  const currentDept = state.geoFilter.department;
  const currentDist = state.geoFilter.district;
  showModal(`
    ${modalHeader('Filtrar por Ubicación', 'Busca negocios por País, Departamento o Distrito')}
    <div class="field mt-3">
      <label for="fCountry">País</label>
      <select id="fCountry" class="input">
        <option value="Todos" ${currentCountry === 'Todos' ? 'selected' : ''}>Todo el Perú</option>
        ${COUNTRIES.map(c => `<option value="${c}" ${c === currentCountry ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="fDept">Departamento / Región</label>
      <select id="fDept" class="input">
        <option value="Todos" ${currentDept === 'Todos' ? 'selected' : ''}>Todos los departamentos</option>
        ${PERU_DEPARTMENTS.map(d => `<option value="${d}" ${d === currentDept ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="fDist">Distrito / Localidad</label>
      <input id="fDist" class="input" placeholder="Ej. Miraflores, San Isidro, Yanahuara..." value="${currentDist === 'Todos' ? '' : esc(currentDist)}">
    </div>
    <div class="flex gap-2 mt-4">
      <button type="button" class="soft-btn flex-1" id="fClear">Limpiar filtro</button>
      <button type="button" class="main-btn flex-1" id="fApply">Aplicar Filtro</button>
    </div>
  `);
  $('#fClear').onclick = () => {
    state.geoFilter = { country: 'Todos', department: 'Todos', district: 'Todos' };
    updateGeoBadge();
    hideModal();
    redraw();
    toast('Filtro de ubicación limpiado.');
  };
  $('#fApply').onclick = () => {
    const c = $('#fCountry').value;
    const d = $('#fDept').value;
    const dist = $('#fDist').value.trim();
    state.geoFilter = {
      country: c,
      department: d,
      district: dist ? dist : 'Todos'
    };
    updateGeoBadge();
    hideModal();
    if (d !== 'Todos' && DEPT_COORDS[d]) {
      const [lat, lng, zoom] = DEPT_COORDS[d];
      map.flyTo([lat, lng], zoom);
    }
    redraw();
    toast(`Filtro aplicado: ${c !== 'Todos' ? c : ''} ${d !== 'Todos' ? '· ' + d : ''} ${dist ? '· ' + dist : ''}`);
  };
}
const search = $('#search'), suggest = $('#suggest');
function closeSuggest() { suggest.classList.remove('show'); search.setAttribute('aria-expanded', 'false'); }
function renderSuggest(places = null) {
  const q = state.query.trim(); if (!q) { closeSuggest(); return; }
  const biz = visibleBusinesses().slice(0, 5);
  let html = biz.map(b => `<button role="option" data-open="${esc(b.id)}"><span aria-hidden="true">${iconFor(b.category)}</span><span><strong>${esc(b.name)}</strong><span class="block muted text-xs">${esc(b.address)}</span></span></button>`).join('');
  if (places === null) html += `<button role="option" data-geo="1"><span aria-hidden="true">📍</span><span>Buscar la dirección «${esc(q)}» en el mapa</span></button>`;
  else if (places.length) html += places.map((p, i) => `<button role="option" data-place="${i}"><span aria-hidden="true">📍</span><span class="text-xs">${esc(p.name)}</span></button>`).join('');
  else html += '<div class="p-3 text-xs muted">No se encontró esa dirección.</div>';
  suggest.innerHTML = html; suggest.classList.add('show'); search.setAttribute('aria-expanded', 'true');
  suggest._places = places || [];
}
async function searchAddress() {
  const q = state.query.trim(); if (q.length < 3) return;
  suggest.innerHTML = '<div class="p-3 text-xs muted">Buscando dirección…</div>'; suggest.classList.add('show');
  try { renderSuggest(await geocode(q)); track('search_address', { search_term: q }); } catch (_) { renderSuggest([]); }
}
function goToPlace(p) {
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.circleMarker([p.lat, p.lng], { radius: 10, color: '#fff', weight: 3, fillColor: '#f59e0b', fillOpacity: 1 }).addTo(map).bindPopup(esc(p.name)).openPopup();
  map.flyTo([p.lat, p.lng], 15);
  state.query = ''; search.value = ''; state.filter = 'Cerca'; state.userLocation = null; renderChips();
  setTimeout(redraw, 900); closeSuggest();
  toast('Mostrando negocios cerca de esa dirección.');
}
search.addEventListener('input', debounce(e => { state.query = e.target.value.trim(); redraw(); renderSuggest(); if (state.query) track('search', { search_term: state.query }); }, 350));
search.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); searchAddress(); }
  if (e.key === 'Escape') closeSuggest();
  if (e.key === 'ArrowDown') { const f = suggest.querySelector('button'); if (f) { e.preventDefault(); f.focus(); } }
});
suggest.addEventListener('keydown', e => {
  const items = $$('button', suggest), i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : search).focus(); }
  if (e.key === 'Escape') { closeSuggest(); search.focus(); }
});
suggest.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.open) { closeSuggest(); openBusiness(b.dataset.open); }
  else if (b.dataset.geo) searchAddress();
  else if (b.dataset.place) goToPlace(suggest._places[Number(b.dataset.place)]);
});
$('#clearSearch').onclick = () => { search.value = ''; state.query = ''; closeSuggest(); redraw(); search.focus(); };
const gBtn = $('#geoFilterBtn'); if (gBtn) gBtn.onclick = openGeoFilterModal;
const gBadge = $('#geoFilterActiveBadge'); if (gBadge) gBadge.onclick = () => { state.geoFilter = { country: 'Todos', department: 'Todos', district: 'Todos' }; updateGeoBadge(); redraw(); toast('Filtro de ubicación limpiado.'); };
document.addEventListener('click', e => { if (!e.target.closest('.searchbox')) closeSuggest(); });

$('#gpsBtn').onclick = () => {
  if (!navigator.geolocation) { toast('Este navegador no ofrece geolocalización.'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    state.userLocation = [pos.coords.latitude, pos.coords.longitude];
    if (gpsMarker) map.removeLayer(gpsMarker);
    gpsMarker = L.circleMarker(state.userLocation, { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map).bindPopup('Estás aquí');
    map.flyTo(state.userLocation, 15); redraw();
  }, () => toast('No se pudo obtener tu ubicación. Activa el permiso de ubicación.'), { enableHighAccuracy: true, timeout: 10000 });
};

// ---------------------------------------------------------------------------
// Modales accesibles (foco atrapado y restaurado)
// ---------------------------------------------------------------------------
let lastFocus = null;
function showModal(html) {
  lastFocus = document.activeElement;
  $('#modal').innerHTML = html; $('#modalBackdrop').classList.add('show');
  const closeBtn = $('#modal [data-close]'); if (closeBtn) closeBtn.onclick = hideModal;
  setTimeout(() => { const f = $('#modal').querySelector('input,select,textarea,button:not([data-close])') || $('#modal button'); f && f.focus(); }, 30);
}
function hideModal() { $('#modalBackdrop').classList.remove('show'); $('#modal').innerHTML = ''; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
const modalHeader = (title, sub = '') => `<div class="row-between"><h2 id="modalTitle" class="text-lg font-extrabold">${title}</h2><button class="soft-btn" data-close aria-label="Cerrar">✕</button></div>${sub ? `<p class="muted text-xs mt-1">${sub}</p>` : ''}`;
$('#modalBackdrop').addEventListener('click', e => { if (e.target === $('#modalBackdrop')) hideModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#modalBackdrop').classList.contains('show')) hideModal(); else if ($('#panel').classList.contains('show')) closePanel(); else closeSheet(); }
  if (e.key === 'Tab') {
    const container = $('#modalBackdrop').classList.contains('show') ? $('#modal') : $('#panel').classList.contains('show') ? $('#panel') : null;
    if (!container) return;
    const f = $$('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[contenteditable="true"],[tabindex]:not([tabindex="-1"])', container).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});
function openPanel(html, label) { const p = $('#panel'); lastFocus = document.activeElement; p.setAttribute('aria-label', label); p.innerHTML = `<div class="panel-inner">${html}</div>`; p.classList.add('show'); p.scrollTop = 0; setTimeout(() => (p.querySelector('h1') || p).focus?.(), 30); }
function closePanel() { $('#panel').classList.remove('show'); $('#panel').innerHTML = ''; if (lastFocus && lastFocus.focus) lastFocus.focus(); }

// ---------------------------------------------------------------------------
// Ficha del negocio
// ---------------------------------------------------------------------------
async function bumpStat(bid, field, delta = 1) {
  const r = doc(db, 'stats', bid);
  try { await updateDoc(r, { [field]: increment(delta) }); }
  catch (e) {
    if (delta > 0) { try { await setDoc(r, { views: 0, routes: 0, shares: 0, going: 0, [field]: 1 }); } catch (_) {} }
  }
}
async function loadPhotos(b) {
  if (Array.isArray(b.photos) && b.photos.length) return b.photos;
  if (state.photoCache.has(b.id)) return state.photoCache.get(b.id);
  try { const s = await getDoc(doc(db, 'businessPhotos', b.id)); const p = s.exists() ? (s.data().photos || []) : []; state.photoCache.set(b.id, p); return p; }
  catch (_) { return []; }
}
function openBusiness(id) {
  const b = state.businesses.get(id); if (!b) return;
  state.selected = id; map.flyTo([b.lat, b.lng], 17, { duration: .6 });
  renderSheet(b); const sh = $('#sheet'); sh.classList.add('open'); setTimeout(() => $('#sheetTitle')?.focus(), 350);
  { const k = `em_view_${id}_${todayISO()}`; let seen = false; try { seen = !!localStorage.getItem(k); localStorage.setItem(k, '1'); } catch (_) {} if (!seen) bumpStat(id, 'views'); }
  track('view_item', { item_id: id, item_name: b.name, item_category: b.category });
  history.replaceState(null, '', `?b=${encodeURIComponent(id)}`);
}
function closeSheet() { $('#sheet').classList.remove('open'); state.selected = null; if (location.search) history.replaceState(null, '', location.pathname); }
function refreshSheet() { if (state.selected && state.businesses.get(state.selected)) renderSheet(state.businesses.get(state.selected)); }
let openedFromURL = false;
function openFromURL() { if (openedFromURL) return; const id = new URLSearchParams(location.search).get('b'); if (id && state.businesses.has(id)) { openedFromURL = true; openBusiness(id); } }

async function renderSheet(b) {
  const limitP = planLimits[b.plan]?.photos || 1;
  const socials = Object.entries(b.socials || {}).filter(([, v]) => v).map(([k, v]) => {
    const labels = { wa: 'WA', fb: 'f', ig: 'IG', tt: 'TT', web: 'www' }, names = { wa: 'WhatsApp', fb: 'Facebook', ig: 'Instagram', tt: 'TikTok', web: 'Sitio web' };
    const colors = { wa: '#15803d', fb: '#1877f2', ig: '#be185d', tt: '#111827', web: '#475569' };
    const raw = String(v).trim(); const href = k === 'wa' ? 'https://wa.me/' + raw.replace(/\D/g, '') : (/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    return `<a class="social" style="background:${colors[k]}" href="${esc(href)}" target="_blank" rel="noopener" aria-label="${names[k]} de ${esc(b.name)}">${labels[k]}</a>`;
  }).join('');
  const evs = activeEvents(b.id);
  const eventHTML = evs.map(e => {
    const s = eventStatus(e), going = state.agenda.has(e.id);
    return `<article class="event-card"><div class="row-between"><h4 class="font-bold">${esc(e.title)}</h4><span class="pill ${s === 'vigente' ? 'ok' : 'info'}">${statusLabel(s)}</span></div>
      <p class="muted text-xs mt-2">📅 ${esc(fmtDate(e.date))}${e.endDate && e.endDate !== e.date ? ' → ' + esc(fmtDate(e.endDate)) : ''} · ${esc(e.time || 'Hora por confirmar')}</p>
      <div class="text-sm mt-2 leading-relaxed rich">${richText(e.description)}</div>
      <div class="flex flex-wrap gap-2 mt-3"><button class="soft-btn" data-going="${esc(e.id)}" aria-pressed="${going}">${going ? '✓ Voy' : '＋ Voy a ir'}</button><button class="soft-btn" data-ics="${esc(e.id)}">⤓ Calendario (.ics)</button><a class="soft-btn inline-flex items-center" target="_blank" rel="noopener" href="${esc(googleCalURL(b, e))}">Google Calendar</a></div></article>`;
  }).join('');
  $('#sheetContent').innerHTML = `<div class="pr-12"><div class="flex items-center gap-2 flex-wrap"><h2 id="sheetTitle" tabindex="-1" class="text-xl font-extrabold">${esc(b.name)}</h2>${b.plan === 'Pro' ? '<span class="pill warn">Destacado Pro</span>' : ''}</div>
    <p class="muted text-xs mt-1">${esc(b.category)} · ${esc(b.address)}</p><p class="muted text-xs mt-1">🕒 ${esc(b.hours || 'Horario no indicado')}</p></div>
    <div class="text-sm mt-3 leading-relaxed rich">${richText(b.description)}</div>
    <div class="mt-4">${socials}</div>
    ${(() => {
      const cleanWa = String(b.socials?.wa || '').replace(/\D/g, '');
      return cleanWa ? `<a class="main-btn inline-flex items-center justify-center gap-2 mt-3" style="background:#16a34a;color:#fff;text-decoration:none" href="https://wa.me/${cleanWa}?text=${encodeURIComponent('Hola ' + b.name + ', vi su local en EventMaps y deseo información.')}" target="_blank" rel="noopener"><span>💬</span> Escribir por WhatsApp</a>` : '';
    })()}
    <h3 class="section-title">Galería</h3><div class="gallery" id="gallery" aria-busy="true"><span class="skel skel-photo"></span><span class="skel skel-photo"></span><span class="skel skel-photo"></span></div>
    <div class="grid grid-cols-3 gap-2 mt-2"><button class="soft-btn" id="favBtn" aria-pressed="${state.favorites.has(b.id)}">${state.favorites.has(b.id) ? '♥ Guardado' : '♡ Guardar'}</button><button class="soft-btn" id="shareBtn">↗ Compartir</button><button class="soft-btn" id="directionsBtn">🧭 Cómo llegar</button></div>
    <h3 class="section-title">Eventos y actividades</h3>${eventHTML || '<p class="muted text-sm">Sin eventos próximos por ahora.</p>'}
    ${b.promo ? '<button class="soft-btn w-full mt-3" id="couponBtn">🎟 Cupón: 10% de descuento · Ver QR</button>' : ''}
    <h3 class="section-title" id="reviewsTitle">Reseñas</h3><div id="reviews" aria-live="polite"><div class="skel skel-line"></div><div class="skel skel-line" style="width:70%"></div></div>
    <div id="reviewForm"></div>`;
  loadPhotos(b).then(ph => { const g = $('#gallery'); if (!g || state.selected !== b.id) return; g.innerHTML = ph.slice(0, limitP).map((p, i) => `<img src="${esc(p)}" alt="Foto ${i + 1} de ${esc(b.name)}" loading="lazy">`).join('') || '<p class="muted text-xs">Este negocio aún no subió fotos.</p>'; });
  $('#favBtn').onclick = () => toggleFavorite(b);
  $('#shareBtn').onclick = () => shareBusiness(b);
  $('#directionsBtn').onclick = () => { bumpStat(b.id, 'routes'); track('get_directions', { item_id: b.id }); window.open(`https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`, '_blank', 'noopener'); };
  $$('[data-going]', $('#sheetContent')).forEach(btn => btn.onclick = () => toggleGoing(b, btn.dataset.going));
  $$('[data-ics]', $('#sheetContent')).forEach(btn => btn.onclick = () => downloadICS(b, state.events.find(x => x.id === btn.dataset.ics)));
  const c = $('#couponBtn'); if (c) c.onclick = () => showCoupon(b);
  loadReviews(b);
}
$('#closeSheet').onclick = closeSheet; map.on('click', closeSheet);

async function toggleFavorite(b) {
  if (!state.user) { openAuth('Inicia sesión para guardar favoritos en tu cuenta.'); return; }
  const r = doc(db, 'users', state.user.uid, 'favorites', b.id);
  try {
    if (state.favorites.has(b.id)) { await deleteDoc(r); toast('Quitado de favoritos.'); }
    else { await setDoc(r, { createdAt: serverTimestamp() }); toast('Guardado en favoritos. Te avisaremos de sus nuevos eventos.'); track('add_to_wishlist', { item_id: b.id }); }
  } catch (e) { toast(errMsg(e)); }
}
async function toggleGoing(b, eventId) {
  if (!state.user) { openAuth('Inicia sesión para añadir eventos a tu agenda.'); return; }
  const r = doc(db, 'users', state.user.uid, 'agenda', eventId);
  try {
    if (state.agenda.has(eventId)) { await deleteDoc(r); bumpStat(b.id, 'going', -1); toast('Quitado de tu agenda.'); }
    else { await setDoc(r, { businessId: b.id, createdAt: serverTimestamp() }); bumpStat(b.id, 'going'); track('join_event', { item_id: eventId }); toast('Añadido a tu agenda. Te recordaremos el evento.'); maybeAskNotifications(); }
  } catch (e) { toast(errMsg(e)); }
}
async function shareBusiness(b) {
  const url = `${location.origin}${location.pathname}?b=${encodeURIComponent(b.id)}`;
  const text = `${b.name} · ${b.address}`;
  bumpStat(b.id, 'shares'); track('share', { item_id: b.id });
  try { if (navigator.share) await navigator.share({ title: b.name, text, url }); else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Enlace copiado.'); } }
  catch (_) { /* cancelado */ }
}
const scriptLoads = new Map();
function loadScriptOnce(src) {
  if (!scriptLoads.has(src)) scriptLoads.set(src, new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = () => { scriptLoads.delete(src); fail(new Error('script')); }; document.head.append(s); }));
  return scriptLoads.get(src);
}
function showCoupon(b) {
  const code = `EM-${b.id.slice(0, 5).toUpperCase()}-10OFF`;
  showModal(`${modalHeader('Tu cupón de descuento', `Muestra este código en ${esc(b.name)} para solicitar tu 10% de descuento.`)}<div id="qr" class="flex justify-center my-5" role="img" aria-label="Código QR del cupón ${code}"></div><div class="text-center text-xl font-extrabold tracking-wider">${code}</div>`);
  loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').then(() => { if (window.QRCode && $('#qr')) new QRCode($('#qr'), { text: code, width: 180, height: 180 }); }).catch(() => { const q = $('#qr'); if (q) q.textContent = code; });
}

// ---------------------------------------------------------------------------
// Reseñas verificadas
// ---------------------------------------------------------------------------
const reviewCache = new Map();
async function loadReviews(b, force = false) {
  let list = [];
  const hit = reviewCache.get(b.id);
  if (!force && hit && Date.now() - hit.t < 10 * 60e3) list = hit.list;
  else {
    try { list = (await getDocs(query(collection(db, 'reviews'), where('businessId', '==', b.id), where('status', '==', 'visible')))).docs.map(d => ({ id: d.id, ...d.data() })); reviewCache.set(b.id, { t: Date.now(), list }); }
    catch (e) { console.warn(e); }
  }
  if (state.selected !== b.id) return;
  list.sort((x, y) => (y.verified - x.verified) || ((y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0)));
  const avg = list.length ? (list.reduce((s, r) => s + r.stars, 0) / list.length).toFixed(1) : '—';
  $('#reviewsTitle').textContent = `Reseñas · ${avg} ★ (${list.length})`;
  const shown = Math.min(list.length, b._revShown || 5);
  $('#reviews').innerHTML = list.slice(0, shown).map(r => `<div class="review-card"><div class="row-between"><span class="text-amber-500" aria-label="${r.stars} de 5 estrellas">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span>${r.verified ? '<span class="pill ok" title="Marcó asistencia a un evento de este negocio">✓ Verificada</span>' : ''}</div><p class="text-sm mt-1">${esc(r.text)}</p><p class="muted text-xs mt-1">${esc(r.displayName || 'Usuario')}</p></div>`).join('') || '<p class="muted text-sm">Todavía no hay reseñas.</p>'; if (list.length > shown) { const more = document.createElement('button'); more.className = 'soft-btn mt-2'; more.textContent = `Ver más reseñas (${list.length - shown})`; more.onclick = () => { b._revShown = shown + 5; loadReviews(b); }; $('#reviews').append(more); }
  renderReviewForm(b, list.find(r => state.user && r.uid === state.user.uid));
}
function attendedEventFor(bid) {
  const now = Date.now();
  for (const [eid, b] of state.agenda) {
    if (b !== bid) continue;
    const ev = state.events.find(e => e.id === eid);
    if (ev && ev.startAt && ev.startAt.toMillis() <= now) return eid;
  }
  return null;
}
function renderReviewForm(b, mine) {
  const box = $('#reviewForm'); if (!box) return;
  if (!state.user) { box.innerHTML = '<button class="soft-btn w-full mt-3" id="loginToReview">Inicia sesión para escribir una reseña</button>'; $('#loginToReview').onclick = () => openAuth(); return; }
  const verifiedUser = state.user.emailVerified || state.user.providerData.some(p => p.providerId === 'google.com');
  if (!verifiedUser) { box.innerHTML = '<div class="banner warn mt-3">Verifica tu correo para publicar reseñas. <button class="link-btn" id="resendV">Reenviar correo</button></div>'; $('#resendV').onclick = resendVerification; return; }
  const eid = attendedEventFor(b.id);
  box.innerHTML = `<form id="rf" class="mt-3"><div class="field"><label for="reviewStars">${mine ? 'Edita tu calificación' : 'Tu calificación'}</label><select id="reviewStars">${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${mine?.stars === n ? 'selected' : ''}>${'★'.repeat(n)}${'☆'.repeat(5 - n)} — ${['', 'Malo', 'Regular', 'Bueno', 'Muy bueno', 'Excelente'][n]}</option>`).join('')}</select></div>
    <div class="field"><label for="reviewText">Tu reseña</label><textarea id="reviewText" minlength="3" maxlength="500" required>${esc(mine?.text || '')}</textarea></div>
    <p class="muted text-xs">${eid || mine?.verified ? '✓ Se publicará como reseña verificada porque marcaste asistencia a un evento.' : 'Para obtener la insignia «Verificada», marca «Voy a ir» en un evento y escribe tu reseña después de que empiece.'}</p>
    <button class="soft-btn w-full mt-2" type="submit">${mine ? 'Actualizar reseña' : 'Publicar reseña'}</button>${mine ? '<button class="link-btn mt-2" type="button" id="delReview">Eliminar mi reseña</button>' : ''}</form>`;
  $('#rf').onsubmit = async e => {
    e.preventDefault();
    const stars = Number($('#reviewStars').value), text = $('#reviewText').value.trim();
    if (text.length < 3) { toast('Escribe al menos 3 caracteres.'); return; }
    const r = doc(db, 'reviews', `${b.id}_${state.user.uid}`);
    try {
      if (mine) await updateDoc(r, { stars, text, updatedAt: serverTimestamp() });
      else await setDoc(r, { businessId: b.id, uid: state.user.uid, displayName: state.user.displayName || state.user.email.split('@')[0], stars, text, verified: !!eid, eventId: eid || null, status: 'visible', createdAt: serverTimestamp() });
      track('review', { item_id: b.id, stars }); toast('¡Gracias por tu reseña!'); loadReviews(b, true);
    } catch (err) { toast(errMsg(err)); }
  };
  const del = $('#delReview'); if (del) del.onclick = async () => { if (!confirm('¿Eliminar tu reseña?')) return; try { await deleteDoc(doc(db, 'reviews', `${b.id}_${state.user.uid}`)); loadReviews(b, true); } catch (e) { toast(errMsg(e)); } };
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------
function icsText(b, e) {
  const clean = s => String(s || '').replace(/[\\,;]/g, ' ').replace(/\s+/g, ' ').trim();
  const d = e.date.replace(/-/g, ''), t = (e.time || '12:00').replace(':', '');
  const start = new Date(`${e.date}T${e.time || '12:00'}:00`), end = new Date(start.getTime() + 2 * 3600e3);
  const f = x => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Eventmaps//ES\r\nBEGIN:VEVENT\r\nUID:${e.id}@eventmaps\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}\r\nDTSTART:${d}T${t.padEnd(4, '0')}00\r\nDTEND:${f(end)}\r\nSUMMARY:${clean(e.title)}\r\nLOCATION:${clean(b.name + ' ' + b.address)}\r\nDESCRIPTION:${clean(plainText(e.description))}\r\nBEGIN:VALARM\r\nTRIGGER:-PT2H\r\nACTION:DISPLAY\r\nDESCRIPTION:${clean(e.title)}\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR`;
}
function downloadICS(b, e) {
  if (!e) return;
  const url = URL.createObjectURL(new Blob([icsText(b, e)], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `eventmaps-${e.id}.ics`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  track('add_to_calendar', { item_id: e.id }); toast('Evento listo para tu calendario.');
}
function googleCalURL(b, e) {
  const s = new Date(`${e.date}T${e.time || '12:00'}:00`), en = new Date(s.getTime() + 2 * 3600e3);
  const f = x => x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${f(s)}/${f(en)}&location=${encodeURIComponent(b.name + ', ' + b.address)}&details=${encodeURIComponent(plainText(e.description).slice(0, 500))}`;
}
let calCursor = new Date(); calCursor.setDate(1); let calSelected = todayISO(); let calOnlyMine = false;
function openCalendar() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  const first = new Date(y, m, 1), startOffset = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
  const evs = state.events.filter(e => { const b = state.businesses.get(e.businessId); return b && !b.paused && subscriptionOk(b) && (!calOnlyMine || state.agenda.has(e.id)); });
  const onDay = iso => evs.filter(e => e.date <= iso && (e.endDate || e.date) >= iso);
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - startOffset + i), iso = dateISO(d), n = onDay(iso).length;
    cells += `<button class="cal-day ${d.getMonth() !== m ? 'out' : ''} ${iso === todayISO() ? 'today' : ''}" data-day="${iso}" aria-pressed="${iso === calSelected}" aria-label="${d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}${n ? `, ${n} eventos` : ', sin eventos'}">${d.getDate()}${n ? `<span class="dots" aria-hidden="true">${'<i></i>'.repeat(Math.min(n, 3))}</span>` : ''}</button>`;
  }
  const list = onDay(calSelected).map(e => { const b = state.businesses.get(e.businessId); return `<button class="list-item w-full text-left" data-open="${esc(b.id)}"><span><strong class="text-sm">${esc(e.title)}</strong><span class="block muted text-xs mt-1">${esc(b.name)} · ${esc(e.time || 'Todo el día')}</span></span>${state.agenda.has(e.id) ? '<span class="pill ok">✓ Voy</span>' : ''}</button>`; }).join('');
  showModal(`${modalHeader('Calendario de eventos')}
    <div class="row-between mt-3"><button class="soft-btn" id="calPrev" aria-label="Mes anterior">‹</button><strong aria-live="polite">${first.toLocaleDateString('es', { month: 'long', year: 'numeric' })}</strong><button class="soft-btn" id="calNext" aria-label="Mes siguiente">›</button></div>
    <div class="flex gap-2 mt-2"><button class="soft-btn" id="calAll" aria-pressed="${!calOnlyMine}">Todos</button><button class="soft-btn" id="calMine" aria-pressed="${calOnlyMine}">✓ Mi agenda</button></div>
    <div class="cal-grid mt-3">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<div class="dow" aria-hidden="true">${d}</div>`).join('')}${cells}</div>
    <h3 class="section-title">${esc(fmtDate(calSelected))}</h3><div>${list || '<p class="muted text-sm">No hay eventos este día.</p>'}</div>`);
  $('#calPrev').onclick = () => { calCursor.setMonth(calCursor.getMonth() - 1); openCalendar(); };
  $('#calNext').onclick = () => { calCursor.setMonth(calCursor.getMonth() + 1); openCalendar(); };
  $('#calAll').onclick = () => { calOnlyMine = false; openCalendar(); };
  $('#calMine').onclick = () => { if (!state.user) { openAuth(); return; } calOnlyMine = true; openCalendar(); };
  $$('[data-day]', $('#modal')).forEach(b => b.onclick = () => { calSelected = b.dataset.day; openCalendar(); setTimeout(() => $(`[data-day="${calSelected}"]`)?.focus(), 40); });
  $$('[data-open]', $('#modal')).forEach(b => b.onclick = () => { hideModal(); openBusiness(b.dataset.open); });
}
$('#calendarBtn').onclick = () => { openCalendar(); track('open_calendar'); };

function showList() {
  const items = visibleBusinesses().map(b => ({ b, d: distanceKm(b) })).sort((a, b) => a.d - b.d);
  showModal(`${modalHeader('Negocios y eventos', state.userLocation ? 'Ordenados por distancia a tu ubicación.' : 'Ordenados por distancia al centro del mapa.')}<div class="mt-3">${items.length ? items.map(({ b, d }) => `<button class="list-item w-full text-left" data-open="${esc(b.id)}"><span><strong class="text-sm">${esc(b.name)}</strong><span class="block muted text-xs mt-1">${esc(activeEvents(b.id)[0]?.title || 'Sin eventos próximos')} · ${esc(b.category)}</span></span><span class="pill">${d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km'}</span></button>`).join('') : '<div class="empty">No hay resultados con este filtro.</div>'}</div>`);
  $$('[data-open]', $('#modal')).forEach(btn => btn.onclick = () => { hideModal(); openBusiness(btn.dataset.open); });
}
$('#listBtn').onclick = showList;

// ---------------------------------------------------------------------------
// Notificaciones de eventos: push (Cloud Messaging) + avisos locales al abrir la app
// ---------------------------------------------------------------------------
async function notify(title, body, tag, bid) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const sent = JSON.parse(localStorage.getItem('em_notified') || '[]'); if (sent.includes(tag)) return;
  sent.push(tag); localStorage.setItem('em_notified', JSON.stringify(sent.slice(-300)));
  try { const reg = await navigator.serviceWorker?.ready; const opts = { body, tag, icon: './icon-192.png', badge: './favicon-32.png', data: { url: `./?b=${bid}` } }; if (reg) reg.showNotification(title, opts); else new Notification(title, opts); } catch (_) {}
}
function checkReminders() {
  if (!state.user || !state.profile?.notify) return;
  const now = Date.now();
  // 1) Recordatorio de eventos de tu agenda que empiezan en las próximas 24 h
  for (const [eid] of state.agenda) {
    const e = state.events.find(x => x.id === eid); if (!e?.startAt) continue;
    const ms = e.startAt.toMillis() - now; const b = state.businesses.get(e.businessId);
    if (b && ms > 0 && ms < 24 * 3600e3) notify(`Pronto: ${e.title}`, `${b.name} · ${fmtDate(e.date)} ${e.time || ''}`, `rem-${eid}`, b.id);
  }
  // 2) Nuevos eventos de tus negocios favoritos
  const since = Number(localStorage.getItem('em_lastSeen') || 0);
  state.events.filter(e => state.favorites.has(e.businessId) && (e.approvedAt?.toMillis?.() || 0) > since).forEach(e => {
    const b = state.businesses.get(e.businessId); if (b) notify(`Nuevo evento en ${b.name}`, `${e.title} · ${fmtDate(e.date)}`, `new-${e.id}`, b.id);
  });
  localStorage.setItem('em_lastSeen', String(now));
}
setInterval(checkReminders, 15 * 60e3);
async function enableNotifications() {
  if (!('Notification' in window)) { toast('Este navegador no admite notificaciones.'); return false; }
  const p = await Notification.requestPermission();
  if (p !== 'granted') { toast('Permiso de notificaciones denegado.'); return false; }
  if (state.user) await updateDoc(doc(db, 'users', state.user.uid), { notify: true }).catch(() => {});
  if (state.profile) state.profile.notify = true;
  const push = await registerPush();
  toast(push ? 'Notificaciones activadas. Te avisaremos aunque la app esté cerrada.' : 'Notificaciones activadas.'); checkReminders(); return true;
}
// Registra este dispositivo en Cloud Messaging y guarda el token en users/{uid}/pushTokens.
async function registerPush() {
  try {
    if (!state.user || Notification.permission !== 'granted') return false;
    const m = await messagingReady; if (!m) return false;
    const reg = await navigator.serviceWorker.ready;
    const token = await getToken(m, { vapidKey: appSettings.vapidKey, serviceWorkerRegistration: reg });
    if (!token) return false;
    const known = localStorage.getItem('em_pushToken');
    if (known && known !== token) await deleteDoc(doc(db, 'users', state.user.uid, 'pushTokens', known)).catch(() => {});
    await setDoc(doc(db, 'users', state.user.uid, 'pushTokens', token), { token, ua: navigator.userAgent.slice(0, 180), createdAt: serverTimestamp() });
    localStorage.setItem('em_pushToken', token);
    return true;
  } catch (e) { console.warn('push', e); return false; }
}
async function unregisterPush() {
  const token = localStorage.getItem('em_pushToken'); localStorage.removeItem('em_pushToken');
  try { if (token && state.user) await deleteDoc(doc(db, 'users', state.user.uid, 'pushTokens', token)); } catch (_) {}
  try { const m = await messagingReady; if (m) await deleteToken(m); } catch (_) {}
}
function maybeAskNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'default' || localStorage.getItem('em_askedNotif')) return;
  localStorage.setItem('em_askedNotif', '1');
  showModal(`${modalHeader('¿Te avisamos?', 'Recibe un recordatorio antes de tus eventos y cuando tus negocios favoritos publiquen algo nuevo.')}<div class="flex gap-2 mt-4"><button class="soft-btn" data-close>Ahora no</button><button class="main-btn" id="yesNotif">Activar notificaciones</button></div>`);
  $('#yesNotif').onclick = async () => { hideModal(); await enableNotifications(); };
}

// ---------------------------------------------------------------------------
// Cuenta: registro, inicio de sesión, perfil
// ---------------------------------------------------------------------------
function renderAccountButton() {
  const u = state.user;
  $('#accountLabel').textContent = u ? (u.displayName || u.email.split('@')[0]).slice(0, 18) : 'Iniciar sesión';
  $('#avatar').innerHTML = u?.photoURL ? `<img src="${esc(u.photoURL)}" alt="">` : esc(u ? (u.displayName || u.email)[0].toUpperCase() : '?');
  $('#accountBtn').setAttribute('aria-label', u ? `Mi cuenta: ${u.email}` : 'Iniciar sesión o crear cuenta');
}
function openAuth(reason = '', mode = 'login') {
  showModal(`${modalHeader(mode === 'login' ? 'Inicia sesión' : 'Crea tu cuenta', esc(reason))}
    <button class="soft-btn w-full mt-4" id="googleBtn" style="min-height:48px">Continuar con Google</button>
    <p class="text-center muted text-xs my-3">o con tu correo</p>
    <form id="authForm">${mode === 'signup' ? '<div class="field"><label for="aName">Nombre</label><input id="aName" autocomplete="name" required maxlength="80"></div>' : ''}
      <div class="field"><label for="aEmail">Correo electrónico</label><input id="aEmail" type="email" autocomplete="email" required></div>
      <div class="field"><label for="aPass">Contraseña</label><input id="aPass" type="password" minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required></div>
      <button class="main-btn mt-2" type="submit">${mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button></form>
    <div class="row-between mt-3"><button class="link-btn" id="switchMode">${mode === 'login' ? 'Crear una cuenta nueva' : 'Ya tengo cuenta'}</button>${mode === 'login' ? '<button class="link-btn" id="forgot">Olvidé mi contraseña</button>' : ''}</div>`);
  $('#switchMode').onclick = () => openAuth(reason, mode === 'login' ? 'signup' : 'login');
  $('#googleBtn').onclick = async () => {
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); hideModal(); toast('Sesión iniciada.'); }
    catch (e) { if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') signInWithRedirect(auth, provider); else toast(errMsg(e)); }
  };
  const forgot = $('#forgot'); if (forgot) forgot.onclick = async () => { const email = $('#aEmail').value.trim(); if (!email) { toast('Escribe tu correo primero.'); return; } try { await sendPasswordResetEmail(auth, email); toast('Te enviamos un correo para restablecer tu contraseña.'); } catch (e) { toast(errMsg(e)); } };
  $('#authForm').onsubmit = async e => {
    e.preventDefault(); const email = $('#aEmail').value.trim(), pass = $('#aPass').value;
    try {
      if (mode === 'login') await signInWithEmailAndPassword(auth, email, pass);
      else { const cred = await createUserWithEmailAndPassword(auth, email, pass); await updateProfile(cred.user, { displayName: $('#aName').value.trim() }); await sendEmailVerification(cred.user); toast('Cuenta creada. Revisa tu correo para verificarla.'); }
      hideModal(); track(mode === 'login' ? 'login' : 'sign_up', { method: 'password' });
    } catch (err) { toast(errMsg(err)); }
  };
}
async function resendVerification() { try { await sendEmailVerification(auth.currentUser); toast('Correo de verificación enviado.'); } catch (e) { toast(errMsg(e)); } }
async function ensureProfile(u) {
  const r = doc(db, 'users', u.uid);
  try {
    let s = await getDoc(r);
    if (!s.exists()) { await setDoc(r, { displayName: u.displayName || '', email: u.email || '', role: 'user', createdAt: serverTimestamp(), theme: prefs.theme, notify: false }); s = await getDoc(r); }
    state.profile = s.data(); state.role = state.profile.role || 'user';
    if (state.profile.theme && state.profile.theme !== prefs.theme) { prefs.theme = state.profile.theme; localStorage.setItem('em_prefs', JSON.stringify(prefs)); applyPrefs(); }
  } catch (e) { console.error('perfil', e); state.role = 'user'; }
}
onAuthStateChanged(auth, async u => {
  state.user = u; state.favorites = new Set(); state.agenda = new Map(); state.myBusinesses = [];
  if (u) { await ensureProfile(u); subscribeUser(u.uid); if (state.profile?.notify && window.Notification?.permission === 'granted') registerPush(); }
  else { state.profile = null; state.role = 'guest'; state.unsub.forEach(x => x()); state.unsub = []; }
  renderAccountButton(); redraw(); refreshSheet();
});

function openAccount() {
  if (!state.user) { openAuth(); return; }
  const u = state.user, verified = u.emailVerified || u.providerData.some(p => p.providerId === 'google.com');
  const roleLabel = { user: 'Usuario', business: 'Negocio', admin: 'Administrador' }[state.role] || 'Usuario';
  showModal(`${modalHeader('Mi cuenta', `${esc(u.email)} · Rol: ${roleLabel}`)}
    ${verified ? '' : '<div class="banner warn">Tu correo no está verificado. <button class="link-btn" id="resend">Reenviar</button> · <button class="link-btn" id="recheck">Ya lo verifiqué</button></div>'}
    <div class="grid grid-cols-2 gap-2 mt-3">
      <button class="soft-btn" id="myFavs">♥ Mis favoritos (${state.favorites.size})</button>
      <button class="soft-btn" id="myAgenda">✓ Mi agenda (${state.agenda.size})</button>
      <button class="soft-btn" id="myBiz">🏪 Mis negocios (${state.myBusinesses.length})</button>
      ${isAdmin() ? '<button class="soft-btn success" id="adminBtn">🛡 Panel de administración</button>' : '<span></span>'}
    </div>
    <h3 class="section-title">Apariencia y accesibilidad</h3>
    <div class="field"><span class="label" id="themeLbl">Tema</span><div class="flex gap-2" role="group" aria-labelledby="themeLbl">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<button class="soft-btn" data-theme-set="${v}" aria-pressed="${prefs.theme === v}">${l}</button>`).join('')}</div></div>
    <label class="flex items-center gap-2 text-sm my-2"><input type="checkbox" id="darkMap" ${prefs.darkMap ? 'checked' : ''}> Mapa oscuro en modo oscuro</label>
    <label class="flex items-center gap-2 text-sm my-2"><input type="checkbox" id="reduceMotion" ${prefs.reduceMotion ? 'checked' : ''}> Reducir animaciones</label>
    <div class="field"><label for="fontScale">Tamaño del texto</label><select id="fontScale">${[[0.9, 'Pequeño'], [1, 'Normal'], [1.15, 'Grande'], [1.3, 'Muy grande']].map(([v, l]) => `<option value="${v}" ${prefs.fontScale == v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label for="radius">Radio de «Cerca»</label><select id="radius">${[1, 2, 5, 10, 25].map(v => `<option value="${v}" ${state.nearRadiusKm == v ? 'selected' : ''}>${v} km</option>`).join('')}</select></div>
    <h3 class="section-title">Notificaciones</h3>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="notifToggle" ${state.profile?.notify && window.Notification?.permission === 'granted' ? 'checked' : ''}> Recordatorios de mi agenda y nuevos eventos de mis favoritos</label>
    <a class="link-btn block mt-4" href="./privacy.html" target="_blank" rel="noopener">Política de privacidad</a>
    <button class="link-btn mt-3" id="deleteAccountRequest">Solicitar eliminación de mi cuenta y datos</button>
    <button class="soft-btn w-full mt-5" id="logout">Cerrar sesión</button>`);
  const rs = $('#resend'); if (rs) rs.onclick = resendVerification;
  const rc = $('#recheck'); if (rc) rc.onclick = async () => { await reload(auth.currentUser); await auth.currentUser.getIdToken(true); state.user = auth.currentUser; openAccount(); refreshSheet(); };
  $('#myFavs').onclick = () => { hideModal(); state.filter = 'Favoritos'; renderChips(); redraw(); showList(); };
  $('#myAgenda').onclick = () => { calOnlyMine = true; openCalendar(); };
  $('#myBiz').onclick = () => { hideModal(); openBusinessPanel(); };
  const ab = $('#adminBtn'); if (ab) ab.onclick = () => { hideModal(); openAdmin(); };
  $$('[data-theme-set]', $('#modal')).forEach(b => b.onclick = () => { prefs.theme = b.dataset.themeSet; savePrefs(); openAccount(); });
  $('#darkMap').onchange = e => { prefs.darkMap = e.target.checked; savePrefs(); };
  $('#reduceMotion').onchange = e => { prefs.reduceMotion = e.target.checked; savePrefs(); };
  $('#fontScale').onchange = e => { prefs.fontScale = Number(e.target.value); savePrefs(); };
  $('#radius').onchange = e => { state.nearRadiusKm = Number(e.target.value); renderChips(); redraw(); };
  $('#notifToggle').onchange = async e => { if (e.target.checked) { if (!(await enableNotifications())) e.target.checked = false; } else { await updateDoc(doc(db, 'users', state.user.uid), { notify: false }).catch(() => {}); state.profile.notify = false; await unregisterPush(); toast('Notificaciones desactivadas.'); } };
  $('#deleteAccountRequest').onclick = async () => {
    if (!confirm('Solicitarás el borrado de tu cuenta y de los datos asociados. Esta acción no se puede deshacer.')) return;
    try {
      await addDoc(collection(db, 'deletionRequests'), { uid: state.user.uid, email: state.user.email || '', status: 'pending', createdAt: serverTimestamp() });
      toast('Solicitud enviada. Recibirás confirmación al completarse el borrado.');
    } catch (e) { toast(errMsg(e)); }
  };
  $('#logout').onclick = async () => { await unregisterPush(); await signOut(auth); hideModal(); toast('Sesión cerrada.'); };
}
$('#accountBtn').onclick = openAccount;

// ---------------------------------------------------------------------------
// Selector de ubicación: búsqueda de dirección + pin arrastrable + GPS
// ---------------------------------------------------------------------------
function locationPickerHTML(initial = null) {
  const selCountry = initial?.country || 'Perú';
  const selDept = initial?.department || 'Lima';
  const selDist = initial?.district || '';
  return `
    <div class="banner info flex items-center justify-between gap-2 p-3 my-2" style="background:#e0f2fe;border:1px solid #38bdf8;color:#0369a1;border-radius:14px">
      <div class="text-xs">
        <strong>¿Estás en tu negocio?</strong><br>
        Toca el botón para fijar la ubicación exacta con el GPS de tu celular.
      </div>
      <button type="button" class="main-btn flex items-center gap-1 text-xs whitespace-nowrap" id="pickGpsBtn" style="width:auto;min-height:38px;padding:8px 12px;background:#0284c7">
        📍 Detectar mi GPS
      </button>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
      <div class="field" style="margin:4px 0">
        <label for="pickCountry">País *</label>
        <select id="pickCountry" name="country" required class="input">
          ${COUNTRIES.map(c => `<option value="${c}" ${c === selCountry ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:4px 0">
        <label for="pickDept">Departamento *</label>
        <select id="pickDept" name="department" required class="input">
          ${PERU_DEPARTMENTS.map(d => `<option value="${d}" ${d === selDept ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:4px 0">
        <label for="pickDist">Distrito / Localidad *</label>
        <input id="pickDist" name="district" required maxlength="80" placeholder="Ej. Miraflores, San Isidro..." value="${esc(selDist)}" class="input">
      </div>
    </div>
    <div class="field"><label for="addrInput">Dirección detallada (Calle, Av., Nro) *</label>
      <div class="flex gap-2">
        <input id="addrInput" required maxlength="200" class="input" placeholder="Calle, número, urbanización" value="${esc(initial?.address || '')}">
        <button type="button" class="soft-btn" id="addrFind">Buscar</button>
      </div>
      <p class="muted text-xs">Arrastra el pin o toca el mapa en la puerta de tu local para máxima precisión.</p>
    </div>
    <div id="pickMap" role="application" aria-label="Mapa para elegir la ubicación del negocio"></div>
    <div class="row-between mt-1">
      <p class="muted text-xs" id="pickCoords" aria-live="polite"></p>
      <span class="pill ok text-xs" id="gpsBadge" style="display:none">GPS fijado ✓</span>
    </div>`;
}

function wireLocationPicker(initial) {
  const start = initial?.lat ? [initial.lat, initial.lng] : (state.userLocation || [map.getCenter().lat, map.getCenter().lng]);
  const pm = L.map('pickMap', { zoomControl: true }).setView(start, 16);
  L.tileLayer(mapProviders[0].url, mapProviders[0].options).addTo(pm);
  const marker = L.marker(start, { draggable: true, keyboard: true, title: 'Ubicación del negocio' }).addTo(pm);
  const pos = { lat: start[0], lng: start[1] };
  const addr = $('#addrInput'); if (initial?.address) addr.value = initial.address;
  const cSel = $('#pickCountry'), dSel = $('#pickDept'), distInp = $('#pickDist');

  const set = async (lat, lng, fill = true) => {
    pos.lat = lat; pos.lng = lng; marker.setLatLng([lat, lng]);
    $('#pickCoords').textContent = `Pin en ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (fill) {
      const geo = await reverseGeocode(lat, lng);
      if (geo.address) addr.value = geo.address.slice(0, 200);
      if (geo.country && cSel && [...cSel.options].some(o => o.value.toLowerCase() === geo.country.toLowerCase())) {
        cSel.value = [...cSel.options].find(o => o.value.toLowerCase() === geo.country.toLowerCase()).value;
      }
      if (geo.department && dSel) {
        const found = [...dSel.options].find(o => geo.department.toLowerCase().includes(o.value.toLowerCase()) || o.value.toLowerCase().includes(geo.department.toLowerCase()));
        if (found) dSel.value = found.value;
      }
      if (geo.district && distInp && !distInp.value) {
        distInp.value = geo.district.slice(0, 80);
      }
    }
  };
  set(start[0], start[1], false);
  marker.on('dragend', () => { const p = marker.getLatLng(); set(p.lat, p.lng); });
  pm.on('click', e => set(e.latlng.lat, e.latlng.lng));

  const gpsBtn = $('#pickGpsBtn');
  if (gpsBtn) {
    gpsBtn.onclick = () => {
      if (!navigator.geolocation) { toast('Geolocalización no soportada.'); return; }
      gpsBtn.disabled = true; gpsBtn.textContent = 'Obteniendo GPS…';
      navigator.geolocation.getCurrentPosition(async p => {
        gpsBtn.disabled = false; gpsBtn.textContent = '📍 Detectar mi GPS';
        const lat = p.coords.latitude, lng = p.coords.longitude;
        pm.setView([lat, lng], 17);
        await set(lat, lng, true);
        const b = $('#gpsBadge'); if (b) b.style.display = 'inline-block';
        toast('¡Ubicación GPS detectada con éxito!');
      }, () => {
        gpsBtn.disabled = false; gpsBtn.textContent = '📍 Detectar mi GPS';
        toast('No se pudo obtener tu señal GPS. Revisa tus permisos.');
      }, { enableHighAccuracy: true, timeout: 12000 });
    };
  }

  if (dSel) {
    dSel.onchange = () => {
      const d = dSel.value;
      if (DEPT_COORDS[d]) {
        const [lat, lng, zoom] = DEPT_COORDS[d];
        pm.setView([lat, lng], Math.max(zoom, 14));
        set(lat, lng, false);
      }
    };
  }

  const find = async () => {
    const q = addr.value.trim(); if (q.length < 3) return;
    try {
      const r = await geocode(q, { limit: 1 });
      if (!r.length) { toast('No encontramos esa dirección. Mueve el pin manualmente.'); return; }
      pm.setView([r[0].lat, r[0].lng], 17);
      set(r[0].lat, r[0].lng, false);
    } catch (_) { toast('No se pudo buscar la dirección.'); }
  };
  $('#addrFind').onclick = find;
  addr.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
  setTimeout(() => pm.invalidateSize(), 200);
  return pos;
}

// ---------------------------------------------------------------------------
// Alta de negocio (queda pendiente de moderación)
// ---------------------------------------------------------------------------
function openRegistration() {
  if (!state.user) { openAuth('Crea una cuenta o inicia sesión para registrar tu negocio.', 'signup'); return; }
  const verified = state.user.emailVerified || state.user.providerData.some(p => p.providerId === 'google.com');
  if (!verified) { showModal(`${modalHeader('Verifica tu correo')}<p class="text-sm mt-3">Para registrar un negocio necesitas verificar tu correo. Revisa tu bandeja de entrada.</p><button class="main-btn mt-4" id="rv">Reenviar correo</button>`); $('#rv').onclick = resendVerification; return; }
  showModal(`${modalHeader('Registra tu negocio', 'Tu solicitud será revisada por un administrador antes de aparecer en el mapa.')}
    <form id="registerForm"><div class="field"><label for="rName">Nombre del negocio *</label><input id="rName" name="name" required minlength="2" maxlength="60"></div>
    <div class="field"><label for="rCat">Categoría *</label><select id="rCat" name="category" required><option value="">Selecciona una categoría</option>${state.categories.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
    ${locationPickerHTML()}
    <fieldset class="field"><legend class="label">3. Elige tu plan</legend><div class="plan-grid">${['Free', 'Standard', 'Pro'].map((p, i) => `<label class="plan ${i === 0 ? 'selected' : ''}"><input type="radio" name="plan" value="${p}" ${i === 0 ? 'checked' : ''}><strong>${p === 'Pro' ? 'Gold' : p}</strong>${planLimits[p].photos} foto${planLimits[p].photos > 1 ? 's' : ''}<br>${planLimits[p].events} evento${planLimits[p].events > 1 ? '<br>eventos' : '<br>evento'}${p === 'Pro' ? '<br>Destacado' : ''}</label>`).join('')}</div></fieldset>
    <section id="registrationPayment" class="banner info" hidden><strong class="block text-sm">4. Datos de pago</strong><p class="text-xs mt-1">Completa estos datos antes de enviar la solicitud. El plan se activa solo después de la verificación administrativa.</p><div class="field"><label for="regMethod">Método</label><select id="regMethod" name="paymentMethod"><option value="yape">Yape</option><option value="plin">Plin</option></select></div><div class="field"><label for="regOperation">Código de operación</label><input id="regOperation" name="operationCode" maxlength="40"></div><div class="field"><label for="regVoucher">Comprobante</label><input id="regVoucher" type="file" accept="image/jpeg,image/png,image/webp"></div></section>
    <button class="main-btn mt-3" type="submit">Enviar solicitud</button></form>`);
  const pos = wireLocationPicker();
  let registrationSettings=null,registrationSending=false,registrationDraft=null,registeredBusiness=null;
  const regSelect=$('#regMethod'),details=document.createElement('div');regSelect.closest('.field').after(details);
  regSelect.innerHTML='<option value="">Consultando cobros…</option>';
  const updateRegPayment=()=>{details.innerHTML=registrationSettings?paymentDetails(registrationSettings,regSelect.value,$('#modal input[name=plan]:checked')?.value||'Standard'):'<p class="muted text-xs">Cobros no disponibles. El registro gratuito sigue disponible.</p>';wirePaymentCopy(details,toast);};
  regSelect.onchange=updateRegPayment;
  getPaymentSettings(db).then(data=>{if(!regSelect.isConnected)return;registrationSettings=data;regSelect.innerHTML=enabledMethods(data).map(m=>`<option value="${m}">${m==='paypal'?'PayPal':m==='yape'?'Yape':'Plin'}</option>`).join('')||'<option value="">Sin métodos habilitados</option>';updateRegPayment();}).catch(()=>{if(regSelect.isConnected){regSelect.innerHTML='<option value="">Cobros no disponibles</option>';updateRegPayment();}});
  const updateRegistrationPlan = () => { const paid = $('#modal input[name=plan]:checked').value !== 'Free'; $('#registrationPayment').hidden = !paid; $$('.plan', $('#modal')).forEach(p => p.classList.toggle('selected', p.querySelector('input').checked)); updateRegPayment(); };
  $$('input[name=plan]', $('#modal')).forEach(r => r.onchange = updateRegistrationPlan);
  $('#registerForm').onsubmit = async e => {
    e.preventDefault();if(registrationSending)return; const fd = registrationDraft || new FormData(e.target);
    const address = $('#addrInput').value.trim();
    if (address.length < 3) { toast('Escribe la dirección del negocio.'); return; }
    const country = String(fd.get('country') || 'Perú').trim();
    const department = String(fd.get('department') || 'Lima').trim();
    const district = String(fd.get('district') || '').trim();
    const plan = String(fd.get('plan')), paymentFile = $('#regVoucher').files[0], operationCode = $('#regOperation').value.trim(), method = String(fd.get('paymentMethod') || '');
    if (plan !== 'Free' && (!paymentFile || operationCode.length < 3)) { toast('Para Standard o Gold adjunta comprobante y código de operación.'); return; }
    if(plan!=='Free'&&(!registrationSettings||!enabledMethods(registrationSettings).includes(method))){toast('Selecciona un método de cobro habilitado.');return;}
    const submit=e.target.querySelector('button[type=submit]');registrationSending=true;submit.disabled=true;
    try {
      let voucher='';
      if(plan!=='Free'){
        const latest=await getPaymentSettings(db);if(paymentRevision(latest)!==paymentRevision(registrationSettings))throw new Error('Los datos de cobro cambiaron. Contacta al administrador si ya pagaste.');
        if(!/^image\/(jpeg|png|webp)$/.test(paymentFile.type))throw new Error('Usa JPG, PNG o WebP.');
        voucher=await compressToBudget(paymentFile,400*1024);if(voucher.length>600000)throw new Error('Comprobante demasiado pesado.');
      }
      const created = registeredBusiness || await addDoc(collection(db, 'businesses'), {
        ownerUid: state.user.uid, ownerEmail: state.user.email, name: String(fd.get('name')).trim(), category: String(fd.get('category')),
        plan, country, department, district, address, lat: pos.lat, lng: pos.lng, mapImage: '', description: '', hours: '', socials: { wa: '', fb: '', ig: '', tt: '', web: '' },
        photos: [], promo: false, paused: false, status: 'pending', subscriptionActive: false, subscriptionEnd: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      registeredBusiness=created;registrationDraft=fd;
      if (plan !== 'Free') { await addDoc(collection(db, 'payments'), { businessId: created.id, businessName: String(fd.get('name')).trim(), ownerUid: state.user.uid, ownerEmail: state.user.email, plan, amount: method === 'paypal' ? getAmountUSD(plan) : getAmountPEN(plan), currency: method === 'paypal' ? 'USD' : 'PEN', method, operationCode, voucher, status: 'pending_verification', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); }
      hideModal(); track('business_signup', { plan });
      toast(plan === 'Free' ? 'Solicitud enviada. Te avisaremos cuando sea aprobada.' : 'Solicitud y comprobante enviados para verificación.');
    } catch (err) { toast((registeredBusiness?'Negocio registrado; reintenta el comprobante sin cerrar esta ventana. ':'')+errMsg(err)); }finally{registrationSending=false;if(submit.isConnected)submit.disabled=false;}
  };
}
$('#addBusiness').onclick = openRegistration;

// ---------------------------------------------------------------------------
// Fotos: comprimidas en el navegador y guardadas en Firestore (sin Cloud Storage, plan gratuito)
// ---------------------------------------------------------------------------
const PHOTO_DOC_BUDGET = 900 * 1024; // un documento de Firestore admite hasta 1 MiB
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}
const WEBP_OK = (() => { try { const c = document.createElement('canvas'); c.width = c.height = 2; return c.toDataURL('image/webp').startsWith('data:image/webp'); } catch (_) { return false; } })();
function imageToDataURL(img, maxSide, quality) {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height)); const c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
  if (WEBP_OK) { const w = c.toDataURL('image/webp', quality); if (w.startsWith('data:image/webp')) return w; }
  return c.toDataURL('image/jpeg', quality);
}
// Reduce tamaño y calidad hasta que cada foto quepa en su parte del presupuesto del documento.
async function compressThumb(file) {
  const img = await loadImage(file); let out = '';
  for (const [side, q] of [[144, 0.75], [128, 0.7], [112, 0.65], [96, 0.6], [80, 0.55]]) { out = imageToDataURL(img, side, q); if (out.length <= 8000) return out; }
  return out;
}
async function compressToBudget(file, budget) {
  const img = await loadImage(file);
  const steps = [[1200, 0.72], [1000, 0.66], [900, 0.6], [800, 0.55], [700, 0.5], [600, 0.45], [500, 0.42], [420, 0.4]];
  let out = '';
  for (const [side, q] of steps) { out = imageToDataURL(img, side, q); if (out.length <= budget) return out; }
  return out;
}
async function uploadPhotos(b, files) {
  const max = planLimits[b.plan].photos;
  if (files.length > max) throw new Error(`Tu plan permite hasta ${max} fotos.`);
  if (!files.every(f => /^image\/(jpeg|png|webp)$/.test(f.type))) throw new Error('Usa imágenes JPG, PNG o WebP.');
  const budget = Math.floor(PHOTO_DOC_BUDGET / files.length);
  const data = [];
  for (const f of files) data.push(await compressToBudget(f, budget));
  if (data.reduce((n, x) => n + x.length, 0) > PHOTO_DOC_BUDGET) throw new Error('Las fotos son demasiado pesadas. Prueba con menos fotos.');
  await setDoc(doc(db, 'businessPhotos', b.id), { photos: data, updatedAt: serverTimestamp() });
  state.photoCache.set(b.id, data);
  return { photos: [] };
}

// ---------------------------------------------------------------------------
// Panel del negocio
// ---------------------------------------------------------------------------
const statusPill = s => s === 'approved' ? '<span class="pill ok">Aprobado</span>' : s === 'pending' ? '<span class="pill warn">En revisión</span>' : s === 'rejected' ? '<span class="pill bad">Rechazado</span>' : `<span class="pill gray">${esc(s)}</span>`;
let panelBizId = null, editingEventId = null;
async function openBusinessPanel(bid = null) {
  if (!state.user) { openAuth(); return; }
  const mine = isAdmin() && bid ? [state.myBusinesses.find(x => x.id === bid) || { id: bid, ...(await getDoc(doc(db, 'businesses', bid))).data() }] : state.myBusinesses;
  if (!mine.length) { openPanel(`<div class="row-between"><h1 tabindex="-1" class="text-2xl font-extrabold">Mis negocios</h1><button class="soft-btn" id="px">Cerrar</button></div><div class="empty">Aún no registraste ningún negocio.<br><button class="main-btn mt-4" id="pnew" style="max-width:300px">＋ Registrar mi negocio</button></div>`, 'Mis negocios'); $('#px').onclick = closePanel; $('#pnew').onclick = () => { closePanel(); openRegistration(); }; return; }
  panelBizId = bid || (mine.find(x => x.id === panelBizId) ? panelBizId : mine[0].id);
  const b = mine.find(x => x.id === panelBizId);
  let evs = [];
  try { const qy = isAdmin() && b.ownerUid !== state.user.uid ? query(collection(db, 'events'), where('businessId', '==', b.id)) : query(collection(db, 'events'), where('ownerUid', '==', state.user.uid)); evs = (await getDocs(qy)).docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.businessId === b.id).sort((x, y) => x.date.localeCompare(y.date)); } catch (e) { console.warn(e); }
  let stats = {}; try { const s = await getDoc(doc(db, 'stats', b.id)); stats = s.exists() ? s.data() : {}; } catch (_) {}
  const photos = await loadPhotos(b);
  const editing = evs.find(e => e.id === editingEventId) || null;
  const lim = planLimits[b.plan];
  const social = b.socials || {};
  openPanel(`<div class="row-between"><div><p class="muted text-xs">PANEL DEL NEGOCIO</p><h1 tabindex="-1" class="text-2xl font-extrabold">${esc(b.name)}</h1><div class="flex gap-2 flex-wrap mt-1">${statusPill(b.status)}<span class="pill font-bold">Plan ${esc(b.plan)}</span>${b.plan !== 'Free' ? `<span class="pill ${subscriptionOk(b) ? 'ok' : 'bad'}">${subscriptionOk(b) ? 'Suscripción activa' + (b.subscriptionEnd ? ' hasta ' + esc(formatDateES(b.subscriptionEnd)) : '') : 'Suscripción inactiva'}</span><span class="pill ${planStatus(b).tone}">⏳ ${esc(planStatus(b).label)}</span>` : ''}${b.paused ? '<span class="pill gray">Pausado</span>' : ''}</div></div><div class="flex gap-2"><button class="main-btn" id="upgradePlanBtn" style="width:auto;min-height:38px;padding:6px 14px;background:linear-gradient(135deg,#059669,#10b981);font-size:0.78rem">💳 ${b.plan === 'Free' ? 'Mejorar Plan' : 'Renovar Plan'}</button><button class="soft-btn" id="px">Cerrar</button></div></div>
    ${mine.length > 1 ? `<div class="field"><label for="bizSel">Negocio</label><select id="bizSel">${mine.map(x => `<option value="${esc(x.id)}" ${x.id === b.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
    ${b.status === 'rejected' ? `<div class="banner warn">Solicitud rechazada: ${esc(b.rejectReason || 'sin motivo')}. Corrige los datos y contacta al administrador.</div>` : ''}
    ${b.status === 'pending' ? '<div class="banner info">Tu negocio está en revisión. Puedes completar la ficha mientras tanto; podrás publicar eventos cuando sea aprobado.</div>' : ''}
    <div class="kpi mt-4"><div class="stat-card"><strong>${stats.views || 0}</strong><span class="muted text-xs">Vistas de ficha</span></div><div class="stat-card"><strong>${stats.routes || 0}</strong><span class="muted text-xs">Rutas</span></div><div class="stat-card"><strong>${stats.going || 0}</strong><span class="muted text-xs">Asistentes</span></div><div class="stat-card"><strong>${stats.shares || 0}</strong><span class="muted text-xs">Compartidos</span></div><div class="stat-card"><strong>${evs.length}/${lim.events}</strong><span class="muted text-xs">Eventos</span></div></div>
    <h2 class="font-extrabold mt-6">Información del negocio</h2>
    <form id="profileForm"><div class="field"><label for="pName">Nombre</label><input id="pName" name="name" required minlength="2" maxlength="60" value="${esc(b.name)}"></div>
      <div class="grid md:grid-cols-2 gap-2"><div class="field"><label for="pCat">Categoría</label><select id="pCat" name="category">${state.categories.map(c => `<option ${c === b.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div><div class="field"><label for="pHours">Horario</label><input id="pHours" name="hours" maxlength="120" placeholder="Lun-Dom · 09:00 a 21:00" value="${esc(b.hours || '')}"></div></div>
      ${locationPickerHTML(b)}
      <div class="field"><span class="label" id="descLbl">Descripción</span>${editorToolbar('pDesc')}<div id="pDesc" class="editor rich" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="descLbl">${richText(b.description)}</div></div>
      <label class="flex items-center gap-2 text-sm my-2"><input type="checkbox" name="promo" ${b.promo ? 'checked' : ''}> Ofrecer cupón de 10% de descuento</label>
      <label class="flex items-center gap-2 text-sm my-2"><input type="checkbox" name="paused" ${b.paused ? 'checked' : ''}> Pausar temporalmente (ocultar del mapa)</label>
      <h3 class="font-bold text-sm mt-4">Redes y enlaces</h3><div class="grid md:grid-cols-2 gap-2">${[['wa', 'WhatsApp'], ['fb', 'Facebook'], ['ig', 'Instagram'], ['tt', 'TikTok'], ['web', 'Página web']].map(([k, l]) => `<div class="field"><label for="s_${k}">${l}</label><input id="s_${k}" name="social_${k}" maxlength="200" value="${esc(social[k] || '')}" placeholder="${k === 'wa' ? 'Número con código de país' : 'https://…'}"></div>`).join('')}</div>
      <div class="field"><label for="mapImage">Imagen del marcador del mapa</label><input id="mapImage" type="file" accept="image/jpeg,image/png,image/webp"><p class="muted text-xs">Logo o foto cuadrada: se mostrará dentro de la burbuja del mapa.</p></div><div class="field"><label for="bPhotos">Fotos (máximo ${lim.photos} con tu plan)</label><input id="bPhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple><p class="muted text-xs">Las nuevas fotos reemplazan la galería. Se comprimen automáticamente.</p><div class="gallery">${photos.slice(0, lim.photos).map((s, i) => `<img src="${esc(s)}" alt="Foto actual ${i + 1}">`).join('')}</div></div>
      <button class="main-btn" type="submit" id="saveProfile">Guardar información</button></form>
    <h2 class="font-extrabold mt-8">Tus eventos</h2><p class="muted text-xs">Cada evento nuevo o editado pasa por moderación antes de publicarse.</p>
    <div>${evs.map(e => `<div class="admin-card"><div class="row-between"><strong>${esc(e.title)}</strong>${statusPill(e.status)}</div><p class="muted text-xs mt-1">📅 ${esc(e.date)}${e.endDate !== e.date ? ' → ' + esc(e.endDate) : ''} · ${esc(e.time || 'Hora por confirmar')} · ${eventStatus(e)}</p>${e.status === 'rejected' && e.rejectReason ? `<p class="text-xs mt-1" style="color:#b91c1c">Motivo: ${esc(e.rejectReason)}</p>` : ''}<div class="flex gap-2 mt-3"><button class="soft-btn" data-edit="${esc(e.id)}">✎ Editar</button><button class="soft-btn danger" data-del="${esc(e.id)}">Eliminar</button></div></div>`).join('') || '<div class="empty">Todavía no tienes eventos.</div>'}</div>
    <h2 class="font-extrabold mt-6" id="evFormTitle">${editing ? 'Editar evento' : 'Nuevo evento'}</h2>
    <form id="eventForm" ${b.status !== 'approved' ? 'aria-disabled="true"' : ''}><div class="field"><label for="eTitle">Título *</label><input id="eTitle" name="title" required minlength="2" maxlength="90" value="${esc(editing?.title || '')}"></div>
      <div class="grid grid-cols-2 gap-2"><div class="field"><label for="eDate">Desde *</label><input id="eDate" type="date" name="date" required min="${todayISO()}" value="${esc(editing?.date || '')}"></div><div class="field"><label for="eEnd">Hasta</label><input id="eEnd" type="date" name="endDate" value="${esc(editing?.endDate || '')}"></div></div>
      <div class="grid grid-cols-2 gap-2"><div class="field"><label for="eTime">Hora</label><input id="eTime" type="time" name="time" value="${esc(editing?.time || '')}"></div><div class="field"><label for="eDur">Duración rápida</label><select id="eDur"><option value="">Manual</option><option value="0">Un día</option><option value="1">1 semana</option><option value="2">2 semanas</option><option value="4">4 semanas</option></select></div></div>
      <div class="field"><span class="label" id="eDescLbl">Descripción</span>${editorToolbar('eDesc')}<div id="eDesc" class="editor rich" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="eDescLbl">${richText(editing?.description)}</div></div>
      <div class="flex gap-2"><button class="main-btn" type="submit" ${b.status !== 'approved' ? 'disabled' : ''}>${editing ? 'Guardar y enviar a revisión' : 'Enviar evento a revisión'}</button>${editing ? '<button class="soft-btn" type="button" id="cancelEdit">Cancelar</button>' : ''}</div></form>`, 'Panel del negocio');
  $('#px').onclick = () => { editingEventId = null; closePanel(); };
  const upBtn = $('#upgradePlanBtn'); if (upBtn) upBtn.onclick = () => openPaymentModal(b);
  const sel = $('#bizSel'); if (sel) sel.onchange = () => { editingEventId = null; openBusinessPanel(sel.value); };
  wireEditor($('#panel'));
  const pos = wireLocationPicker(b);
  $('#profileForm').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target); const btn = $('#saveProfile'); btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const files = [...$('#bPhotos').files];
      const country = String(fd.get('country') || 'Perú').trim();
      const department = String(fd.get('department') || 'Lima').trim();
      const district = String(fd.get('district') || '').trim();
      const upd = {
        name: String(fd.get('name')).trim(), category: String(fd.get('category')),
        country, department, district,
        hours: String(fd.get('hours') || '').trim(), address: $('#addrInput').value.trim(),
        lat: pos.lat, lng: pos.lng, description: (() => { if (descTooLong('pDesc')) throw new Error(`La descripción del negocio admite máximo ${DESC_LIMITS.pDesc} caracteres.`); return sanitizeRichHTML($('#pDesc').innerHTML); })(),
        promo: fd.get('promo') === 'on', paused: fd.get('paused') === 'on',
        socials: Object.fromEntries(['wa', 'fb', 'ig', 'tt', 'web'].map(k => [k, String(fd.get('social_' + k) || '').trim().slice(0, 200)])),
        updatedAt: serverTimestamp()
      };
      const mapFile = $('#mapImage').files[0]; if (mapFile) { if (!/^image\/(jpeg|png|webp)$/.test(mapFile.type)) throw new Error('El marcador debe ser JPG, PNG o WebP.'); upd.mapImage = await compressThumb(mapFile); }
      if (files.length) { const r = await uploadPhotos(b, files); upd.photos = r.photos; }
      await updateDoc(doc(db, 'businesses', b.id), upd);
      toast('Información guardada.'); track('business_update'); openBusinessPanel(b.id);
    } catch (err) { toast(errMsg(err)); btn.disabled = false; btn.textContent = 'Guardar información'; }
  };
  const f = $('#eventForm');
  const dur = $('#eDur'); dur.onchange = () => { const s = f.elements.date.value; if (!s || dur.value === '') return; const d = new Date(s + 'T12:00:00'); const w = Number(dur.value); if (w) d.setDate(d.getDate() + w * 7 - 1); f.elements.endDate.value = dateISO(d); };
  f.elements.date.onchange = () => { if (!f.elements.endDate.value || f.elements.endDate.value < f.elements.date.value) f.elements.endDate.value = f.elements.date.value; if (dur.value) dur.onchange(); };
  const ce = $('#cancelEdit'); if (ce) ce.onclick = () => { editingEventId = null; openBusinessPanel(b.id); };
  $$('[data-edit]', $('#panel')).forEach(x => x.onclick = () => { editingEventId = x.dataset.edit; openBusinessPanel(b.id).then(() => $('#evFormTitle')?.scrollIntoView()); });
  $$('[data-del]', $('#panel')).forEach(x => x.onclick = async () => { if (!confirm('¿Eliminar este evento?')) return; try { await deleteDoc(doc(db, 'events', x.dataset.del)); toast('Evento eliminado.'); openBusinessPanel(b.id); } catch (e) { toast(errMsg(e)); } });
  f.onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(f);
    const title = String(fd.get('title')).trim(), date = String(fd.get('date')), endDate = String(fd.get('endDate') || date), time = String(fd.get('time') || '');
    if (endDate < date) { toast('La fecha «Hasta» no puede ser anterior a «Desde».'); return; }
    if (descTooLong('eDesc')) { toast(`La descripción del evento admite máximo ${DESC_LIMITS.eDesc} caracteres.`); return; }
    const data = { title, date, endDate, time, description: sanitizeRichHTML($('#eDesc').innerHTML), startAt: startAtOf(date, time), status: 'pending', updatedAt: serverTimestamp() };
    try {
      if (editing) await updateDoc(doc(db, 'events', editing.id), data);
      else { if (evs.filter(x => eventStatus(x) !== 'finalizado').length >= lim.events) { toast(`Tu plan ${b.plan} permite ${lim.events} eventos activos. Mejora tu plan para publicar más.`); return; } await addDoc(collection(db, 'events'), { ...data, businessId: b.id, ownerUid: b.ownerUid, createdAt: serverTimestamp() }); }
      editingEventId = null; toast('Evento enviado a revisión.'); track('event_submit'); openBusinessPanel(b.id);
    } catch (err) { toast(errMsg(err)); }
  };
}
function editorToolbar(id) { return `<div class="flex flex-wrap gap-2 mb-2" role="toolbar" aria-label="Formato de texto"><button type="button" class="soft-btn" data-format="bold" data-target="${id}" aria-label="Negrita"><b>B</b></button><button type="button" class="soft-btn" data-format="italic" data-target="${id}" aria-label="Cursiva"><i>I</i></button><button type="button" class="soft-btn" data-format="insertUnorderedList" data-target="${id}" aria-label="Lista">• Lista</button>${['😊', '🎉', '☕', '❤️'].map(em => `<button type="button" class="soft-btn" data-emoji="${em}" data-target="${id}" aria-label="Insertar emoji ${em}">${em}</button>`).join('')}</div>`; }
const DESC_LIMITS = { pDesc: 250, eDesc: 500 };
const editorTextLen = el => (el.innerText || '').replace(/\n+$/,'').length;
function limitEditor(el, max) {
  if (!el || el.dataset.limited) return; el.dataset.limited = '1';
  const counter = document.createElement('p'); counter.className = 'muted text-xs mt-1'; counter.setAttribute('aria-live', 'polite'); el.after(counter);
  let lastGood = el.innerHTML;
  const update = () => { const n = editorTextLen(el); counter.textContent = `${n} / ${max} caracteres`; counter.style.color = n >= max ? '#dc2626' : ''; };
  if (editorTextLen(el) > max) { el.innerText = (el.innerText || '').slice(0, max); }
  lastGood = el.innerHTML; update();
  el.addEventListener('beforeinput', e => { if (e.inputType.startsWith('insert') && e.inputType !== 'insertFromPaste' && editorTextLen(el) >= max && window.getSelection().isCollapsed) e.preventDefault(); });
  el.addEventListener('paste', e => { e.preventDefault(); const sel = window.getSelection().toString().length; const room = Math.max(0, max - editorTextLen(el) + sel); const text = (e.clipboardData?.getData('text/plain') || '').slice(0, room); if (text) document.execCommand('insertText', false, text); if (room === 0) toast(`Máximo ${max} caracteres.`); });
  el.addEventListener('input', () => { if (editorTextLen(el) > max) { el.innerHTML = lastGood; const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); toast(`Máximo ${max} caracteres.`); } else lastGood = el.innerHTML; update(); });
}
function descTooLong(id) { const el = $('#' + id); return el && editorTextLen(el) > DESC_LIMITS[id]; }
function wireEditor(root) {
  Object.entries(DESC_LIMITS).forEach(([id, max]) => limitEditor($('#' + id), max));
  $$('[data-format]', root).forEach(b => b.onclick = () => { $('#' + b.dataset.target).focus(); document.execCommand(b.dataset.format, false, null); });
  $$('[data-emoji]', root).forEach(b => b.onclick = () => { $('#' + b.dataset.target).focus(); document.execCommand('insertText', false, b.dataset.emoji); });
}

// ---------------------------------------------------------------------------
// Pasarelas de Pago: Yape, Plin, PayPal, Stripe
// ---------------------------------------------------------------------------
async function openPaymentModal(b) {
  if(!state.user){openAuth();return;}
  let settings;try{settings=await getPaymentSettings(db);}catch{toast('No se pudieron consultar los datos de cobro. Revisa la conexión o contacta al administrador.');return;}
  const methods=enabledMethods(settings);if(!methods.length){toast('No hay métodos de cobro habilitados. Contacta al administrador.');return;}
  let plan=b.plan==='Pro'?'Pro':'Standard', method=methods[0], sending=false;
  const render=()=>{
    showModal(`${modalHeader('Planes y suscripción',esc(b.name))}<div class="plan-grid mt-3">${['Standard','Pro'].map(p=>`<button class="plan ${plan===p?'selected':''}" data-buy-plan="${p}"><strong>${planLabel(p)}</strong>S/ ${getAmountPEN(p)} / mes</button>`).join('')}</div><div class="flex gap-2 mt-3">${methods.map(m=>`<button class="soft-btn" data-buy-method="${m}" aria-pressed="${method===m}">${m==='paypal'?'PayPal':m==='yape'?'Yape':'Plin'}</button>`).join('')}</div>${paymentDetails(settings,method,plan)}<form id="paymentForm"><div class="field"><label for="vFile">Comprobante JPG, PNG o WebP</label><input id="vFile" type="file" accept="image/jpeg,image/png,image/webp" required></div><div class="field"><label for="opCode">Código de operación</label><input id="opCode" minlength="3" maxlength="40" required></div><p class="muted text-xs">Verificación administrativa obligatoria antes de activar el plan.</p><button class="main-btn mt-3" id="sendPayBtn">Enviar comprobante</button></form>`);
    const root=$('#modal');wirePaymentCopy(root,toast);
    root.querySelectorAll('[data-buy-plan]').forEach(button=>button.onclick=()=>{if(!sending){plan=button.dataset.buyPlan;render();}});
    root.querySelectorAll('[data-buy-method]').forEach(button=>button.onclick=()=>{if(!sending){method=button.dataset.buyMethod;render();}});
    $('#paymentForm').onsubmit=async event=>{
      event.preventDefault();if(sending)return;
      const file=$('#vFile').files[0],code=$('#opCode').value.trim(),account=state.user;
      if(!account||!file||!/^image\/(jpeg|png|webp)$/.test(file.type)||code.length<3){toast('Verifica la sesión, el comprobante y el código.');return;}
      const button=$('#sendPayBtn');sending=true;button.disabled=true;root.querySelectorAll('[data-buy-plan],[data-buy-method]').forEach(x=>x.disabled=true);
      try{
        const latest=await getPaymentSettings(db);if(paymentRevision(latest)!==paymentRevision(settings))throw new Error('Los datos de cobro cambiaron. Reabre esta ventana; si ya pagaste, contacta al administrador.');
        const voucher=await compressToBudget(file,400*1024);if(voucher.length>600000)throw new Error('Comprobante demasiado pesado.');
        await addDoc(collection(db,'payments'),{businessId:b.id,businessName:b.name,ownerUid:account.uid,ownerEmail:account.email,plan,method,amount:method==='paypal'?getAmountUSD(plan):getAmountPEN(plan),currency:method==='paypal'?'USD':'PEN',operationCode:code,voucher,status:'pending_verification',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        if(button.isConnected)hideModal();toast('Comprobante enviado para verificación.');
      }catch(error){toast(errMsg(error));if(button.isConnected){button.disabled=false;root.querySelectorAll('[data-buy-plan],[data-buy-method]').forEach(x=>x.disabled=false);}}finally{sending=false;}
    };
  };render();
}

// ---------------------------------------------------------------------------
// Panel de administración
// ---------------------------------------------------------------------------
let adminTab = 'resumen';
async function openAdmin(tab = adminTab) {
  if (!isAdmin()) { toast('Necesitas rol de administrador.'); return; }
  adminTab = tab;
  const tabs = [
    ['resumen', 'Resumen'],
    ['negocios', 'Negocios'],
    ['pagos', '💳 Pagos'],
    ['cobros', 'Métodos de cobro'],
    ['eventos', 'Eventos'],
    ['resenas', 'Reseñas'],
    ['usuarios', 'Usuarios'],
    ['categorias', 'Categorías'],
    ['datos', 'Datos']
  ];
  openPanel(`<div class="row-between"><div><p class="muted text-xs">EVENTMAPS · ADMINISTRACIÓN</p><h1 tabindex="-1" class="text-2xl font-extrabold">Panel de administrador</h1></div><button class="soft-btn" id="ax">Cerrar</button></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</div><div id="adminBody" role="tabpanel"><p class="muted p-4">Cargando…</p></div>`, 'Panel de administración');
  $('#ax').onclick = closePanel;
  $$('[data-tab]', $('#panel')).forEach(b => b.onclick = () => openAdmin(b.dataset.tab));
  try {
    await ({
      resumen: adminSummary,
      negocios: adminBusinesses,
      pagos: adminPayments,
      cobros: () => renderPaymentSettings($('#adminBody'), db, toast),
      eventos: adminEvents,
      resenas: adminReviews,
      usuarios: adminUsers,
      categorias: adminCategories,
      datos: adminData
    })[tab]();
  }
  catch (e) { console.error(e); $('#adminBody').innerHTML = `<div class="banner warn">No se pudo cargar: ${esc(errMsg(e))}</div>`; }
}
const allDocs = async (c, ...q) => (await getDocs(q.length ? query(collection(db, c), ...q) : collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() }));

async function adminSummary() {
  const [biz, evs, revs, users, stats, payments] = await Promise.all([
    allDocs('businesses'),
    allDocs('events'),
    allDocs('reviews', orderBy('createdAt', 'desc'), limit(500)),
    allDocs('users', limit(1000)),
    allDocs('stats'),
    allDocs('payments', limit(500)).catch(() => [])
  ]);
  const sum = k => stats.reduce((s, x) => s + (x[k] || 0), 0);
  const top = stats.map(s => ({ ...s, b: biz.find(b => b.id === s.id) })).filter(s => s.b).sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8);
  const pendingPayments = payments.filter(p => p.status === 'pending_verification').length;
  $('#adminBody').innerHTML = `<div class="kpi mt-4">
    <div class="stat-card" style="border-color:#10b981"><strong style="color:#059669">${pendingPayments}</strong><span class="muted text-xs">Pagos por verificar</span></div>
    <div class="stat-card"><strong>${biz.filter(b => b.status === 'pending').length}</strong><span class="muted text-xs">Negocios por aprobar</span></div>
    <div class="stat-card"><strong>${evs.filter(e => e.status === 'pending').length}</strong><span class="muted text-xs">Eventos por aprobar</span></div>
    <div class="stat-card"><strong>${biz.filter(b => b.status === 'approved').length}</strong><span class="muted text-xs">Negocios publicados</span></div>
    <div class="stat-card"><strong>${evs.filter(e => e.status === 'approved' && eventStatus(e) !== 'finalizado').length}</strong><span class="muted text-xs">Eventos activos</span></div>
    <div class="stat-card"><strong>${users.length}</strong><span class="muted text-xs">Usuarios</span></div>
    <div class="stat-card"><strong>${revs.length}</strong><span class="muted text-xs">Reseñas (${revs.filter(r => r.verified).length} verificadas)</span></div>
    <div class="stat-card"><strong>${sum('views')}</strong><span class="muted text-xs">Vistas de fichas</span></div>
    <div class="stat-card"><strong>${sum('routes')}</strong><span class="muted text-xs">Rutas solicitadas</span></div></div>
    <h2 class="font-extrabold mt-6">Negocios más vistos</h2><div class="admin-card"><table class="simple"><thead><tr><th>Negocio</th><th>Vistas</th><th>Rutas</th><th>Asistentes</th><th>Compartidos</th></tr></thead><tbody>${top.map(s => `<tr><td>${esc(s.b.name)}</td><td>${s.views || 0}</td><td>${s.routes || 0}</td><td>${s.going || 0}</td><td>${s.shares || 0}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin datos todavía.</td></tr>'}</tbody></table></div>
    <p class="muted text-xs">Analítica detallada (usuarios activos, embudos, retención) disponible en Google Analytics de Firebase.</p>`;
}

async function adminPayments() {
  const [payments, biz] = await Promise.all([
    allDocs('payments', orderBy('createdAt', 'desc'), limit(100)).catch(() => []),
    allDocs('businesses')
  ]);
  const body = $('#adminBody');
  if (!payments.length) {
    body.innerHTML = '<div class="empty">No hay registros de pagos aún.</div>';
    return;
  }
  const pending = payments.filter(p => p.status === 'pending_verification').length;
  const approved = payments.filter(p => p.status === 'approved').length;
  body.innerHTML = `
    <div class="kpi mt-2 mb-4">
      <div class="stat-card" style="border-color:#f59e0b"><strong style="color:#d97706">${pending}</strong><span class="muted text-xs">Pagos por verificar</span></div>
      <div class="stat-card" style="border-color:#10b981"><strong style="color:#059669">${approved}</strong><span class="muted text-xs">Pagos aprobados</span></div>
    </div>
    ${payments.map(p => {
      const b = biz.find(x => x.id === p.businessId);
      const isPending = p.status === 'pending_verification';
      const statusP = isPending ? '<span class="pill warn">Pendiente de verificación</span>' : p.status === 'approved' ? '<span class="pill ok">Aprobado</span>' : '<span class="pill bad">Rechazado</span>';
      return `
        <div class="admin-card">
          <div class="row-between">
            <div>
              <strong class="text-base">${esc(p.businessName || b?.name || 'Negocio')}</strong>
              <span class="muted text-xs"> · Plan <strong>${esc(p.plan)}</strong></span>
            </div>
            ${statusP}
          </div>
          <p class="muted text-xs mt-1">
            Monto: <strong class="text-sm">${p.currency === 'USD' ? '$' : 'S/.'} ${p.amount}</strong> · Método: <strong>${esc(p.method?.toUpperCase() || 'PAGO')}</strong> · Op: <code>${esc(p.operationCode || '—')}</code>
          </p>
          <p class="muted text-xs mt-1">Usuario: ${esc(p.ownerEmail || p.ownerUid)}</p>
          ${p.voucher ? `
            <div class="mt-2">
              <span class="text-xs font-bold muted">Comprobante / Voucher:</span>
              <div class="mt-1">
                <img src="${esc(p.voucher)}" alt="Voucher" style="max-height:160px;border-radius:10px;border:1px solid var(--line);cursor:pointer" data-zoom-voucher="${esc(p.voucher)}">
              </div>
            </div>
          ` : '<p class="muted text-xs mt-2">Sin comprobante adjunto.</p>'}
          ${isPending ? `
            <div class="flex flex-wrap gap-2 mt-3">
              <button class="soft-btn success" data-payok="${p.id}" data-paybiz="${p.businessId}" data-payplan="${p.plan}">✓ Aprobar pago y activar Plan (+30 días)</button>
              <button class="soft-btn danger" data-payrej="${p.id}">✕ Rechazar pago</button>
            </div>
          ` : ''}
        </div>`;
    }).join('')}`;

  $$('[data-zoom-voucher]', body).forEach(img => {
    img.onclick = () => {
      showModal(`
        ${modalHeader('Comprobante de Pago')}
        <div class="p-2 text-center">
          <img src="${esc(img.dataset.zoomVoucher)}" alt="Comprobante ampliado" style="max-width:100%;max-height:75vh;border-radius:12px;margin:auto">
        </div>`);
    };
  });

  $$('[data-payok]', body).forEach(btn => {
    btn.onclick = async () => {
      const pid = btn.dataset.payok, bid = btn.dataset.paybiz, plan = btn.dataset.payplan;
      btn.disabled = true; btn.textContent = 'Aprobando…';
      try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'payments', pid), {
          status: 'approved',
          approvedAt: serverTimestamp(),
          voucher: '', voucherDeleted: true
        });
        batch.update(doc(db, 'businesses', bid), {
          plan,
          subscriptionActive: true,
          subscriptionEnd: datePlus(30),
          updatedAt: serverTimestamp()
        });
        await batch.commit();
        toast(`¡Pago aprobado! Plan ${plan} activado por 30 días.`);
        openAdmin('pagos');
      } catch (err) {
        toast(errMsg(err));
        btn.disabled = false;
      }
    };
  });

  $$('[data-payrej]', body).forEach(btn => {
    btn.onclick = () => {
      rejectDialog('payments', btn.dataset.payrej, ['Comprobante ilegible', 'Código de operación no encontrado', 'Monto incorrecto', 'Comprobante duplicado'], () => openAdmin('pagos'));
    };
  });
}

async function adminBusinesses() {
  const biz = (await allDocs('businesses')).sort((a, b) => ({ pending: 0, rejected: 2, approved: 1 }[a.status] ?? 3) - ({ pending: 0, rejected: 2, approved: 1 }[b.status] ?? 3));
  $('#adminBody').innerHTML = biz.map(b => `<div class="admin-card"><div class="row-between"><div><strong>${esc(b.name)}</strong> <span class="muted text-xs">· ${esc(b.category)}</span></div><div class="flex gap-1">${statusPill(b.status)}<span class="pill">${esc(b.plan)}</span></div></div>
    <p class="muted text-xs mt-1">${esc(b.address)} · ${esc(b.ownerEmail || b.ownerUid)}</p>
    ${b.status === 'rejected' && b.rejectReason ? `<p class="text-xs mt-1">Motivo: ${esc(b.rejectReason)}</p>` : ''}
    <div class="grid md:grid-cols-4 gap-2 mt-3 items-end">
      <div class="field" style="margin:0"><label for="pl_${b.id}">Plan</label><select id="pl_${b.id}" data-plan="${b.id}">${['Free', 'Standard', 'Pro'].map(p => `<option ${p === b.plan ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label for="se_${b.id}">Suscripción hasta</label><input id="se_${b.id}" type="date" data-subend="${b.id}" value="${esc(b.subscriptionEnd || '')}"></div>
      <label class="flex items-center gap-2 text-xs"><input type="checkbox" data-subact="${b.id}" ${b.subscriptionActive ? 'checked' : ''}> Suscripción activa</label>
      <button class="soft-btn" data-savesub="${b.id}">Guardar plan</button></div>
    <div class="flex flex-wrap gap-2 mt-3">${b.status !== 'approved' ? `<button class="soft-btn success" data-approve="${b.id}">Aprobar y publicar</button>` : ''}${b.status !== 'rejected' ? `<button class="soft-btn danger" data-reject="${b.id}">Rechazar</button>` : ''}<button class="soft-btn" data-pause="${b.id}">${b.paused ? 'Reactivar' : 'Pausar'}</button><button class="soft-btn" data-editbiz="${b.id}">Editar ficha</button><button class="soft-btn" data-view="${b.id}" ${b.status !== 'approved' ? 'disabled' : ''}>Ver en mapa</button><button class="soft-btn danger" data-delbiz="${b.id}">Eliminar</button></div></div>`).join('') || '<div class="empty">No hay negocios registrados.</div>';
  const body = $('#adminBody');
  $$('[data-approve]', body).forEach(x => x.onclick = async () => {
    const b = biz.find(y => y.id === x.dataset.approve);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'businesses', b.id), { status: 'approved', rejectReason: '', approvedAt: serverTimestamp(), subscriptionActive: b.plan !== 'Free', subscriptionEnd: b.plan === 'Free' ? '' : (b.subscriptionEnd && b.subscriptionEnd >= todayISO() ? b.subscriptionEnd : datePlus(30)) });
      const u = await getDoc(doc(db, 'users', b.ownerUid));
      if (u.exists() && u.data().role === 'user') batch.update(doc(db, 'users', b.ownerUid), { role: 'business' });
      await batch.commit(); toast('Negocio aprobado y publicado.'); openAdmin('negocios');
    } catch (e) { toast(errMsg(e)); }
  });
  $$('[data-reject]', body).forEach(x => x.onclick = () => rejectDialog('businesses', x.dataset.reject, ['Información incompleta', 'Ubicación dudosa', 'Contenido inapropiado', 'Negocio duplicado'], () => openAdmin('negocios')));
  $$('[data-pause]', body).forEach(x => x.onclick = async () => { const b = biz.find(y => y.id === x.dataset.pause); try { await updateDoc(doc(db, 'businesses', b.id), { paused: !b.paused }); openAdmin('negocios'); } catch (e) { toast(errMsg(e)); } });
  $$('[data-savesub]', body).forEach(x => x.onclick = async () => { const id = x.dataset.savesub; try { await updateDoc(doc(db, 'businesses', id), { plan: $(`[data-plan="${id}"]`).value, subscriptionEnd: $(`[data-subend="${id}"]`).value, subscriptionActive: $(`[data-subact="${id}"]`).checked }); toast('Plan y suscripción actualizados.'); } catch (e) { toast(errMsg(e)); } });
  $$('[data-editbiz]', body).forEach(x => x.onclick = () => openBusinessPanel(x.dataset.editbiz));
  $$('[data-view]', body).forEach(x => x.onclick = () => { closePanel(); openBusiness(x.dataset.view); });
  $$('[data-delbiz]', body).forEach(x => x.onclick = async () => { if (!confirm('¿Eliminar este negocio definitivamente?')) return; try { await deleteDoc(doc(db, 'businesses', x.dataset.delbiz)); toast('Negocio eliminado.'); openAdmin('negocios'); } catch (e) { toast(errMsg(e)); } });
}
function rejectDialog(col, id, reasons, done) {
  showModal(`${modalHeader('Rechazar')}<div class="field"><label for="rr">Motivo</label><select id="rr">${reasons.map(r => `<option>${r}</option>`).join('')}<option value="__otro">Otro…</option></select></div><div class="field"><label for="rro">Detalle (opcional)</label><input id="rro" maxlength="200"></div><div class="flex gap-2 mt-3"><button class="soft-btn" data-close>Cancelar</button><button class="soft-btn danger" id="rok">Rechazar</button></div>`);
  $('#rok').onclick = async () => { const r = $('#rr').value === '__otro' ? '' : $('#rr').value; const reason = [r, $('#rro').value.trim()].filter(Boolean).join(' — '); try { await updateDoc(doc(db, col, id), { status: 'rejected', rejectReason: reason || 'Sin motivo' }); hideModal(); toast('Rechazado.'); done(); } catch (e) { toast(errMsg(e)); } };
}

async function adminEvents() {
  const [evs, biz] = await Promise.all([allDocs('events'), allDocs('businesses')]);
  evs.sort((a, b) => ((a.status === 'pending') ? -1 : 0) - ((b.status === 'pending') ? -1 : 0) || a.date.localeCompare(b.date));
  $('#adminBody').innerHTML = `<div class="flex gap-2 mt-3"><button class="soft-btn" id="approveAll">Aprobar todos los pendientes</button></div>` + (evs.map(e => { const b = biz.find(x => x.id === e.businessId); return `<div class="admin-card"><div class="row-between"><strong>${esc(e.title)}</strong>${statusPill(e.status)}</div><p class="muted text-xs mt-1">${esc(b?.name || 'Negocio eliminado')} · 📅 ${esc(e.date)}${e.endDate !== e.date ? ' → ' + esc(e.endDate) : ''} ${esc(e.time || '')} · ${eventStatus(e)}</p><div class="text-sm mt-2 rich">${richText(e.description)}</div><div class="flex flex-wrap gap-2 mt-3">${e.status !== 'approved' ? `<button class="soft-btn success" data-eok="${e.id}">Aprobar</button>` : ''}${e.status !== 'rejected' ? `<button class="soft-btn danger" data-erej="${e.id}">Rechazar</button>` : ''}<button class="soft-btn danger" data-edel="${e.id}">Eliminar</button></div></div>`; }).join('') || '<div class="empty">No hay eventos.</div>');
  const body = $('#adminBody');
  const approve = id => updateDoc(doc(db, 'events', id), { status: 'approved', rejectReason: '', approvedAt: serverTimestamp() });
  $$('[data-eok]', body).forEach(x => x.onclick = async () => { try { await approve(x.dataset.eok); toast('Evento aprobado.'); openAdmin('eventos'); } catch (e) { toast(errMsg(e)); } });
  $('#approveAll').onclick = async () => { try { await Promise.all(evs.filter(e => e.status === 'pending').map(e => approve(e.id))); toast('Eventos aprobados.'); openAdmin('eventos'); } catch (e) { toast(errMsg(e)); } };
  $$('[data-erej]', body).forEach(x => x.onclick = () => rejectDialog('events', x.dataset.erej, ['Información incompleta', 'Fecha incorrecta', 'Contenido inapropiado', 'Spam'], () => openAdmin('eventos')));
  $$('[data-edel]', body).forEach(x => x.onclick = async () => { if (!confirm('¿Eliminar evento?')) return; try { await deleteDoc(doc(db, 'events', x.dataset.edel)); openAdmin('eventos'); } catch (e) { toast(errMsg(e)); } });
}

async function adminReviews() {
  const [revs, biz] = await Promise.all([allDocs('reviews', orderBy('createdAt', 'desc'), limit(300)), allDocs('businesses')]);
  $('#adminBody').innerHTML = revs.map(r => `<div class="admin-card"><div class="row-between"><span class="text-amber-500">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span><div class="flex gap-1">${r.verified ? '<span class="pill ok">Verificada</span>' : ''}<span class="pill ${r.status === 'visible' ? 'info' : 'gray'}">${r.status === 'visible' ? 'Visible' : 'Oculta'}</span></div></div><p class="text-sm mt-1">${esc(r.text)}</p><p class="muted text-xs mt-1">${esc(r.displayName || r.uid)} · ${esc(biz.find(b => b.id === r.businessId)?.name || '')}</p><div class="flex gap-2 mt-3"><button class="soft-btn" data-rtog="${r.id}" data-st="${r.status}">${r.status === 'visible' ? 'Ocultar' : 'Mostrar'}</button><button class="soft-btn danger" data-rdel="${r.id}">Eliminar</button></div></div>`).join('') || '<div class="empty">No hay reseñas.</div>';
  $$('[data-rtog]', $('#adminBody')).forEach(x => x.onclick = async () => { try { await updateDoc(doc(db, 'reviews', x.dataset.rtog), { status: x.dataset.st === 'visible' ? 'hidden' : 'visible', moderatedAt: serverTimestamp() }); openAdmin('resenas'); } catch (e) { toast(errMsg(e)); } });
  $$('[data-rdel]', $('#adminBody')).forEach(x => x.onclick = async () => { if (!confirm('¿Eliminar reseña?')) return; try { await deleteDoc(doc(db, 'reviews', x.dataset.rdel)); openAdmin('resenas'); } catch (e) { toast(errMsg(e)); } });
}

async function adminUsers() {
  const users = await allDocs('users', limit(1000));
  $('#adminBody').innerHTML = `<div class="admin-card"><table class="simple"><thead><tr><th>Usuario</th><th>Rol</th></tr></thead><tbody>${users.map(u => `<tr><td><strong>${esc(u.displayName || '—')}</strong><br><span class="muted">${esc(u.email)}</span></td><td><label class="sr-only" for="ro_${u.id}">Rol de ${esc(u.email)}</label><select id="ro_${u.id}" class="input" data-role="${u.id}" ${u.id === state.user.uid ? 'disabled title="No puedes cambiar tu propio rol"' : ''}>${['user', 'business', 'admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${{ user: 'Usuario', business: 'Negocio', admin: 'Admin' }[r]}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-role]', $('#adminBody')).forEach(s => s.onchange = async () => { try { await updateDoc(doc(db, 'users', s.dataset.role), { role: s.value }); toast('Rol actualizado.'); } catch (e) { toast(errMsg(e)); } });
}

async function adminCategories() {
  const cats = (await allDocs('categories')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  $('#adminBody').innerHTML = `<form id="catForm" class="flex gap-2 mt-4"><label for="catName" class="sr-only">Nueva categoría</label><input id="catName" class="input" required maxlength="35" placeholder="Nueva categoría"><button class="soft-btn">＋ Agregar</button></form>
    <div class="admin-card">${cats.map(c => `<div class="list-item"><span class="text-sm font-semibold">${esc(c.name)}</span><span class="flex gap-2"><button class="soft-btn" data-cren="${c.id}">Renombrar</button><button class="soft-btn danger" data-cdel="${c.id}">Eliminar</button></span></div>`).join('') || '<div class="empty">Sin categorías en Firestore: se usan las predeterminadas. Agrega una o usa «Datos → Cargar datos iniciales».</div>'}</div>`;
  $('#catForm').onsubmit = async e => { e.preventDefault(); const name = $('#catName').value.trim(); if (cats.some(c => c.name.toLowerCase() === name.toLowerCase())) { toast('Ya existe.'); return; } try { await addDoc(collection(db, 'categories'), { name, order: cats.length }); openAdmin('categorias'); } catch (err) { toast(errMsg(err)); } };
  $$('[data-cren]', $('#adminBody')).forEach(x => x.onclick = async () => {
    const c = cats.find(y => y.id === x.dataset.cren); const name = prompt('Nuevo nombre:', c.name)?.trim(); if (!name) return;
    try { const batch = writeBatch(db); batch.update(doc(db, 'categories', c.id), { name }); (await allDocs('businesses', where('category', '==', c.name))).forEach(b => batch.update(doc(db, 'businesses', b.id), { category: name })); await batch.commit(); openAdmin('categorias'); } catch (e) { toast(errMsg(e)); }
  });
  $$('[data-cdel]', $('#adminBody')).forEach(x => x.onclick = async () => {
    const c = cats.find(y => y.id === x.dataset.cdel);
    if ((await allDocs('businesses', where('category', '==', c.name))).length) { toast('Hay negocios con esta categoría. Renómbrala o reasígnalos primero.'); return; }
    if (!confirm(`¿Eliminar «${c.name}»?`)) return; try { await deleteDoc(doc(db, 'categories', c.id)); openAdmin('categorias'); } catch (e) { toast(errMsg(e)); }
  });
}

async function adminData() {
  $('#adminBody').innerHTML = `<div class="admin-card"><h2 class="font-extrabold">Datos iniciales</h2><p class="muted text-sm mt-1">Carga las categorías base y los 5 negocios de demostración (Café Aurora, Bar Neón, etc.) como documentos reales de Firestore, aprobados y a tu nombre. Puedes editarlos o eliminarlos después.</p><button class="main-btn mt-3" id="seed" style="max-width:340px">Cargar datos iniciales</button></div>
    <div class="admin-card"><h2 class="font-extrabold">Estado de servicios</h2><ul class="text-sm mt-2" style="list-style:disc;padding-left:20px"><li>Authentication: activo</li><li>Firestore: activo</li><li>Fotos: guardadas en Firestore (sin Cloud Storage, plan gratuito)</li><li>Notificaciones push: ${messaging ? 'activas (Cloud Messaging + GitHub Actions)' : appSettings.vapidKey ? 'no compatibles con este navegador' : 'sin clave VAPID configurada'}</li><li>App Check: ${appSettings.appCheckSiteKey ? 'activo (reCAPTCHA Enterprise)' : 'sin clave configurada'}</li><li>Analytics: ${analytics ? 'activo' : 'no disponible en este navegador'}</li></ul></div>`;
  $('#seed').onclick = async () => {
    if (!confirm('¿Cargar categorías y negocios de demostración en Firestore?')) return;
    try { await seedDemo(); toast('Datos cargados.'); openAdmin('resumen'); } catch (e) { toast(errMsg(e)); }
  };
}
async function seedDemo() {
  const uid = state.user.uid, email = state.user.email;
  const batch = writeBatch(db);
  const existing = await allDocs('categories');
  if (!existing.length) DEFAULT_CATEGORIES.forEach((name, i) => batch.set(doc(collection(db, 'categories')), { name, order: i }));
  const demo = [
    ['Café Aurora', 'Gastronomía', 'Pro', 'Colima 145, Roma Norte, CDMX', 19.4195, -99.1638, 'Brunch & café de especialidad', 0, '10:00', 'Café de origen, pan artesanal y música acústica.', true],
    ['Bar Neón', 'Entretenimiento', 'Standard', 'Álvaro Obregón 88, Roma Norte, CDMX', 19.4174, -99.1602, 'Noche de vinilos', 2, '20:00', 'DJ invitado, clásicos en vinilo y coctelería de autor.', false],
    ['Taquería El Faro', 'Gastronomía', 'Free', 'Av. Michoacán 62, Condesa, CDMX', 19.4119, -99.1712, 'Martes de tacos', 0, '13:00', 'Tacos al pastor y salsas hechas en casa.', true],
    ['Librería Tinta', 'Tienda', 'Standard', 'Calle Orizaba 129, Roma Norte, CDMX', 19.4212, -99.1583, 'Club de lectura: nuevas voces', 4, '18:30', 'Encuentro abierto sobre literatura contemporánea.', false],
    ['Cine Terraza', 'Entretenimiento', 'Pro', 'Av. Nuevo León 110, Condesa, CDMX', 19.4105, -99.1701, 'Cine bajo las estrellas', 3, '19:30', 'Proyección al aire libre. Trae una manta.', false]
  ];
  for (const [name, category, plan, address, lat, lng, evTitle, plus, time, evDesc, promo] of demo) {
    const bref = doc(collection(db, 'businesses'));
    batch.set(bref, { ownerUid: uid, ownerEmail: email, name, category, plan, address, lat, lng, description: `✨ Bienvenidos a ${name}. Descubre nuestras novedades y actividades.`, hours: 'Lunes a domingo · 09:00 a 21:00', socials: { wa: '', fb: '', ig: '', tt: '', web: '' }, photos: [], promo, paused: false, status: 'approved', subscriptionActive: plan !== 'Free', subscriptionEnd: plan === 'Free' ? '' : datePlus(60), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), approvedAt: serverTimestamp() });
    const date = datePlus(plus);
    batch.set(doc(collection(db, 'events')), { businessId: bref.id, ownerUid: uid, title: evTitle, date, endDate: date, time, description: evDesc, startAt: startAtOf(date, time), status: 'approved', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), approvedAt: serverTimestamp() });
  }
  await batch.commit();
  map.setView(LIMA_CENTER, 12);
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------
renderChips();
subscribePublic();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { redraw(); checkReminders(); } });
setInterval(redraw, 60e3);
navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'open' && e.data.bid) openBusiness(e.data.bid); });
// Centrar en la ubicación del usuario al abrir (si ya concedió permiso)
navigator.permissions?.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') $('#gpsBtn').click(); }).catch(() => {});
