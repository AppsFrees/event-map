import {doc, getDocFromServer, setDoc, serverTimestamp} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js';
export const getAmountPEN = plan => plan === 'Pro' ? 49 : 19;
export const getAmountUSD = plan => plan === 'Pro' ? 15 : 5;
export const planLabel = plan => plan === 'Pro' ? 'Gold' : plan;
const names = {yape:'Yape', plin:'Plin', paypal:'PayPal'};
const defaults = {yapeEnabled:false,yapeNumber:'',yapeHolder:'',plinEnabled:false,plinNumber:'',plinHolder:'',paypalEnabled:false,paypalEmail:'',paypalUrl:''};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function paypalLink(value) {
  if (!value) return '';
  try {const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && (!u.port || u.port==='443') && ['paypal.me','www.paypal.me','paypal.com','www.paypal.com'].includes(u.hostname) ? u.href : '';} catch {return '';}
}
function validate(data) {
  for (const method of ['yape','plin']) {
    if (data[method+'Enabled'] && (!/^9\d{8}$/.test(data[method+'Number']) || !data[method+'Holder'].trim())) throw new Error(`${names[method]} necesita un celular peruano de 9 dígitos que empiece con 9 y un titular.`);
  }
  if (data.paypalUrl && !paypalLink(data.paypalUrl)) throw new Error('Usa un enlace HTTPS de paypal.me o paypal.com, sin usuario, contraseña ni puerto personalizado.');
  if (data.paypalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.paypalEmail)) throw new Error('El correo de PayPal no es válido.');
  if (data.paypalEnabled && !data.paypalEmail && !data.paypalUrl) throw new Error('PayPal necesita un correo o un enlace público de cobro.');
  return data;
}
export async function getPaymentSettings(db) {
  const snap=await getDocFromServer(doc(db,'settings','payments'));
  const raw=snap.exists()?snap.data():{};
  const data={...defaults};
  for (const key of Object.keys(defaults)) {
    if (key in raw && typeof raw[key]!==typeof defaults[key]) throw new Error('Configuración de cobro inválida. Contacta al administrador.');
    if (key in raw) data[key]=raw[key];
  }
  return validate(data);
}
export const enabledMethods = settings => ['yape','plin'].filter(k=>settings[k+'Enabled']); // Solo Perú: Yape y Plin
export const paymentRevision = settings => JSON.stringify(Object.keys(defaults).map(k=>settings[k]));
export function paymentDetails(settings, method, plan) {
  if (!enabledMethods(settings).includes(method)) return '<div class="banner warn">Método no disponible. Contacta al administrador.</div>';
  const amount=method==='paypal'?`USD ${getAmountUSD(plan)}.00`:`S/ ${getAmountPEN(plan)}.00`;
  if (method==='paypal') return `<div class="admin-card"><h3 class="font-bold">PayPal · ${amount}</h3>${settings.paypalEmail?`<p class="mt-2">Correo receptor: <strong>${esc(settings.paypalEmail)}</strong></p>`:''}${settings.paypalUrl?`<a class="main-btn inline-flex items-center justify-center mt-3" href="${esc(paypalLink(settings.paypalUrl))}" target="_blank" rel="noopener noreferrer">Abrir PayPal</a>`:''}<p class="muted text-xs mt-2">Comprueba el destinatario, el importe y la moneda antes de pagar. Abrir el enlace no confirma ni activa tu plan.</p></div>`;
  return `<div class="admin-card"><h3 class="font-bold">${names[method]} · ${amount}</h3><p class="text-xl font-extrabold mt-2">${esc(settings[method+'Number'])}</p><p class="muted text-sm mt-1">Titular: ${esc(settings[method+'Holder'])}</p><button type="button" class="soft-btn mt-3" data-copy-payment="${esc(settings[method+'Number'])}">Copiar número</button><p class="muted text-xs mt-2">Transfiere desde tu aplicación y verifica el titular antes de confirmar.</p></div>`;
}
export function wirePaymentCopy(root, notify) {
  root.querySelectorAll('[data-copy-payment]').forEach(button=>button.onclick=async()=>{try {await navigator.clipboard.writeText(button.dataset.copyPayment);notify('Número copiado.');}catch {notify('No se pudo copiar. Selecciona el número manualmente.');}});
}
export async function renderPaymentSettings(root, db, notify) {
  root.innerHTML='<p role="status">Consultando configuración de cobro…</p>';
  let settings;
  try {settings=await getPaymentSettings(db);}catch {root.innerHTML='<div class="banner warn">No se pudo consultar la configuración. Comprueba la conexión y el despliegue de las reglas de Firestore. No se han cargado destinatarios de ejemplo.</div>';return;}
  root.innerHTML=`<div class="admin-card card"><h2 class="text-lg font-extrabold">Métodos de cobro</h2><p class="muted text-sm mt-2">Estos datos son públicos para que los negocios puedan pagarte. Nunca ingreses contraseñas, claves secretas ni códigos de acceso.</p><form id="paymentSettingsForm" class="space-y-4 mt-4">${['yape','plin'].map(method=>`<fieldset class="field"><legend class="font-bold">${names[method]}</legend><label><input type="checkbox" name="${method}Enabled" ${settings[method+'Enabled']?'checked':''}> Habilitar ${names[method]}</label><label for="${method}Number">Número de celular peruano</label><input class="input" id="${method}Number" name="${method}Number" inputmode="tel" maxlength="20" value="${esc(settings[method+'Number'])}"><label for="${method}Holder">Titular</label><input class="input" id="${method}Holder" name="${method}Holder" maxlength="100" value="${esc(settings[method+'Holder'])}"></fieldset>`).join('')}${settings.paypalEnabled?'<input type="hidden" name="paypalEnabled" value="on">':''}<input type="hidden" name="paypalEmail" value="${esc(settings.paypalEmail)}"><input type="hidden" name="paypalUrl" value="${esc(settings.paypalUrl)}"><p class="muted text-xs">Los precios actuales no cambian. La activación sigue siendo manual tras verificar el comprobante. Por ahora EventMaps opera solo en Perú: se cobran únicamente Yape y Plin en soles.</p><button class="main-btn" type="submit">Guardar métodos de cobro</button><p id="paymentSettingsStatus" role="status" aria-live="polite"></p></form></div>`;
  const form=root.querySelector('form');
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button[type=submit]');const status=form.querySelector('#paymentSettingsStatus');
    const fields=new FormData(form);const next={...defaults};
    for(const key of Object.keys(defaults)) next[key]=typeof defaults[key]==='boolean'?fields.has(key):String(fields.get(key)||'').trim();
    for(const method of ['yape','plin']) next[method+'Number']=next[method+'Number'].replace(/[\s()-]/g,'').replace(/^\+?51(?=9\d{8}$)/,'');
    try {
      validate(next);
      const lines=['Se publicarán estos destinatarios:',`Yape: ${next.yapeEnabled?next.yapeNumber+' · '+next.yapeHolder:'Deshabilitado'}`,`Plin: ${next.plinEnabled?next.plinNumber+' · '+next.plinHolder:'Deshabilitado'}`,];
      if(!confirm(lines.join('\n')))return;
      button.disabled=true;status.textContent='Guardando…';
      const current=await getPaymentSettings(db);
      if(paymentRevision(current)!==paymentRevision(settings)) throw new Error('Otro administrador cambió los datos. Vuelve a abrir esta sección antes de guardar.');
      await setDoc(doc(db,'settings','payments'),{...next,updatedAt:serverTimestamp()});
      settings=next;status.textContent='Datos de cobro guardados.';notify(status.textContent);
    }catch(error){status.textContent=error.code==='permission-denied'?'Sin permisos. Comprueba el rol admin y las reglas desplegadas.':error.message;notify(status.textContent);}finally{button.disabled=false;}
  };
}
export function whatsappURL(business) {
  let raw=String(business.socials?.wa||'').trim();
  if (/^https?:/i.test(raw)) {try {const u=new URL(raw);if(!['wa.me','api.whatsapp.com','web.whatsapp.com'].includes(u.hostname))return '';raw=u.hostname==='wa.me'?u.pathname.slice(1):u.searchParams.get('phone')||'';}catch{return '';}}
  else if (!/^[+\d\s().-]+$/.test(raw)) return '';
  let number=raw.replace(/\D/g,'').replace(/^00/,'');
  if (/^9\d{8}$/.test(number) && (!business.country || business.country==='Perú')) number='51'+number;
  if (!/^[1-9]\d{9,14}$/.test(number)) return '';
  return `https://wa.me/${number}?text=${encodeURIComponent('Hola '+business.name+', vi su negocio en EventMaps y deseo información.')}`;
}
export function installMapEffects() {
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./map-premium.css?v=11',import.meta.url).href;document.head.append(link);
  const pause=()=>document.documentElement.classList.toggle('em-map-paused',document.hidden);document.addEventListener('visibilitychange',pause);pause();
}

// ---------- Vencimiento de planes ----------
export const REMIND_DAYS = 7;
export function planDaysLeft(business) {
  const end = String(business?.subscriptionEnd || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const [y, m, d] = end.split('-').map(Number);
  const now = new Date(); const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86400000);
}
export const formatDateES = iso => { const [y, m, d] = String(iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : ''; };
export function planStatus(business) {
  if (!business || business.plan === 'Free') return { label: 'Plan gratuito', tone: 'gray', days: null };
  const days = planDaysLeft(business);
  if (days === null) return { label: 'Sin fecha de vencimiento', tone: 'gray', days };
  if (days < 0) return { label: `Venció hace ${-days} ${-days === 1 ? 'día' : 'días'}`, tone: 'bad', days };
  if (days === 0) return { label: 'Vence hoy', tone: 'bad', days };
  if (days <= REMIND_DAYS) return { label: `Vence en ${days} ${days === 1 ? 'día' : 'días'}`, tone: 'warn', days };
  return { label: `Quedan ${days} días`, tone: 'ok', days };
}
export function renewalBase(business) {
  const days = planDaysLeft(business);
  return days !== null && days > 0 ? business.subscriptionEnd : null;
}
export function addDaysISO(baseISO, n) {
  const d = baseISO ? new Date(baseISO + 'T12:00:00') : new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function reminderWhatsAppURL(business) {
  const base = whatsappURL(business); if (!base) return '';
  const st = planStatus(business); const end = formatDateES(business.subscriptionEnd);
  const plan = planLabel(business.plan);
  const when = st.days === null ? '' : st.days < 0 ? `venció el ${end}` : st.days === 0 ? `vence hoy (${end})` : `vence el ${end} (quedan ${st.days} ${st.days === 1 ? 'día' : 'días'})`;
  const msg = `Hola ${business.name}, te saludamos de EventMaps. Tu plan ${plan} ${when}. Para mantener tu negocio destacado en el mapa, renueva desde EventMaps → Mis negocios → Renovar plan, pagando por Yape o Plin y enviando tu comprobante. ¡Gracias!`;
  return base.replace(/\?text=.*$/, '?text=' + encodeURIComponent(msg));
}
