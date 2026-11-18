from pathlib import Path
import hashlib,re,subprocess
expected={'app.js':'343feda780a236a0e522df5cef480bcca6352c29','admin/index.html':'15f2abbe14a1bcf9fccdb6d2c42096129b66bdba','firestore.rules':'f3682247b793d3a6aa579af0c6f8836146e49167','service-worker.js':'ae894ad17536899adbdeae6b33d5b7eee7a9dcc5'}
for name,want in expected.items():
 data=Path(name).read_bytes()
 if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!=want:raise SystemExit('Source changed: '+name)
files={name:Path(name).read_text() for name in expected}
def change(name,old,new):
 if files[name].count(old)!=1:raise SystemExit('Anchor changed in '+name+': '+old[:80])
 files[name]=files[name].replace(old,new,1)
change('app.js',"import { firebaseConfig, appSettings } from './firebase-config.js';","import { firebaseConfig, appSettings } from './firebase-config.js';\nimport {getPaymentSettings, enabledMethods, paymentDetails, wirePaymentCopy, paymentRevision, renderPaymentSettings, whatsappURL, installMapEffects, getAmountPEN, getAmountUSD, planLabel} from './payment-settings.js';")
change('app.js','applyPrefs();\n\n// ---------------------------------------------------------------------------\n// Mapa','applyPrefs();\ninstallMapEffects();\n\n// ---------------------------------------------------------------------------\n// Mapa')
change('app.js',"    ['pagos', '💳 Pagos'],","    ['pagos', '💳 Pagos'],\n    ['cobros', 'Métodos de cobro'],")
change('app.js','      pagos: adminPayments,',"      pagos: adminPayments,\n      cobros: () => renderPaymentSettings($('#adminBody'), db, toast),")
change('app.js','${markerVisual}${esc(label)}',"${markerVisual}<span class=\"marker-name\">${esc(label)}</span>${b.plan !== 'Free' ? `<span class=\"marker-plan\">${esc(planLabel(b.plan))}</span>` : ''}${whatsappURL(b) ? `<a class=\"marker-wa\" href=\"${esc(whatsappURL(b))}\" target=\"_blank\" rel=\"noopener noreferrer\" aria-label=\"WhatsApp de ${esc(b.name)}\">WhatsApp ↗</a>` : ''}")
change('app.js','iconSize: [100, 58], iconAnchor: [50, 54]','iconSize: [112, whatsappURL(b) ? 112 : 78], iconAnchor: [56, whatsappURL(b) ? 108 : 74]')
change('app.js',"    m.on('click', () => openBusiness(b.id));", "    m.on('click', e => {if(!e.originalEvent?.target?.closest?.('.marker-wa'))openBusiness(b.id);});\n    const wa=m.getElement()?.querySelector('.marker-wa');if(wa){L.DomEvent.disableClickPropagation(wa);L.DomEvent.disableScrollPropagation(wa);wa.addEventListener('keydown',event=>event.stopPropagation());}")
change('app.js',"    m.on('keypress', e => { if (e.originalEvent.key", "    m.on('keypress', e => { if(e.originalEvent.target?.closest?.('.marker-wa'))return; if (e.originalEvent.key")
change('admin/index.html',"    import { firebaseConfig } from './firebase-config.js';","    import { firebaseConfig } from './firebase-config.js';\n    import {renderPaymentSettings} from '../payment-settings.js';")
change('admin/index.html','        <button class="soft-btn whitespace-nowrap" data-tab="datos">','        <button class="soft-btn whitespace-nowrap" data-tab="cobros">Métodos de cobro</button>\n        <button class="soft-btn whitespace-nowrap" data-tab="datos">')
change('admin/index.html',"        else if (tab === 'pagos') await renderPagos(container);","        else if (tab === 'pagos') await renderPagos(container);\n        else if (tab === 'cobros') await renderPaymentSettings(container, db, toast);")
change('admin/index.html',"if (role !== 'admin')","if (role !== 'admin' || userDoc.data().disabled === true)")
start=files['app.js'].index('function openPaymentModal(b) {')
end=files['app.js'].index('// ---------------------------------------------------------------------------\n// Panel de administración',start)
checkout=r"""async function openPaymentModal(b) {
  if(!state.user){openAuth();return;}
  let settings;try{settings=await getPaymentSettings(db);}catch{toast('No se pudieron consultar los datos de cobro. Revisa la conexión o contacta al administrador.');return;}
  const methods=enabledMethods(settings);if(!methods.length){toast('No hay métodos de cobro habilitados. Contacta al administrador.');return;}
  let plan=b.plan==='Pro'?'Pro':'Standard', method=methods[0], sending=false;
  const render=()=>{
    showModal(`${modalHeader('Planes y suscripción',esc(b.name))}<div class="plan-grid mt-3">${['Standard','Pro'].map(p=>`<button class="plan ${plan===p?'selected':''}" data-buy-plan="${p}"><strong>${planLabel(p)}</strong>S/ ${getAmountPEN(p)} / mes<br>USD ${getAmountUSD(p)}</button>`).join('')}</div><div class="flex gap-2 mt-3">${methods.map(m=>`<button class="soft-btn" data-buy-method="${m}" aria-pressed="${method===m}">${m==='paypal'?'PayPal':m==='yape'?'Yape':'Plin'}</button>`).join('')}</div>${paymentDetails(settings,method,plan)}<form id="paymentForm"><div class="field"><label for="vFile">Comprobante JPG, PNG o WebP</label><input id="vFile" type="file" accept="image/jpeg,image/png,image/webp" required></div><div class="field"><label for="opCode">Código de operación</label><input id="opCode" minlength="3" maxlength="40" required></div><p class="muted text-xs">Verificación administrativa obligatoria antes de activar el plan.</p><button class="main-btn mt-3" id="sendPayBtn">Enviar comprobante</button></form>`);
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

"""
files['app.js']=files['app.js'][:start]+checkout+files['app.js'][end:]
change('app.js',"  const pos = wireLocationPicker();\n  const updateRegistrationPlan",r"""  const pos = wireLocationPicker();
  let registrationSettings=null,registrationSending=false,registrationDraft=null,registeredBusiness=null;
  const regSelect=$('#regMethod'),details=document.createElement('div');regSelect.closest('.field').after(details);
  regSelect.innerHTML='<option value="">Consultando cobros…</option>';
  const updateRegPayment=()=>{details.innerHTML=registrationSettings?paymentDetails(registrationSettings,regSelect.value,$('#modal input[name=plan]:checked')?.value||'Standard'):'<p class="muted text-xs">Cobros no disponibles. El registro gratuito sigue disponible.</p>';wirePaymentCopy(details,toast);};
  regSelect.onchange=updateRegPayment;
  getPaymentSettings(db).then(data=>{if(!regSelect.isConnected)return;registrationSettings=data;regSelect.innerHTML=enabledMethods(data).map(m=>`<option value="${m}">${m==='paypal'?'PayPal':m==='yape'?'Yape':'Plin'}</option>`).join('')||'<option value="">Sin métodos habilitados</option>';updateRegPayment();}).catch(()=>{if(regSelect.isConnected){regSelect.innerHTML='<option value="">Cobros no disponibles</option>';updateRegPayment();}});
  const updateRegistrationPlan""")
change('app.js',"$$('.plan', $('#modal')).forEach(p => p.classList.toggle('selected', p.querySelector('input').checked)); };","$$('.plan', $('#modal')).forEach(p => p.classList.toggle('selected', p.querySelector('input').checked)); updateRegPayment(); };")
change('app.js',"  $('#registerForm').onsubmit = async e => {\n    e.preventDefault(); const fd = new FormData(e.target);","  $('#registerForm').onsubmit = async e => {\n    e.preventDefault();if(registrationSending)return; const fd = registrationDraft || new FormData(e.target);")
change('app.js',"    try {\n      const created = await addDoc(collection(db, 'businesses'), {",r"""    if(plan!=='Free'&&(!registrationSettings||!enabledMethods(registrationSettings).includes(method))){toast('Selecciona un método de cobro habilitado.');return;}
    const submit=e.target.querySelector('button[type=submit]');registrationSending=true;submit.disabled=true;
    try {
      let voucher='';
      if(plan!=='Free'){
        const latest=await getPaymentSettings(db);if(paymentRevision(latest)!==paymentRevision(registrationSettings))throw new Error('Los datos de cobro cambiaron. Contacta al administrador si ya pagaste.');
        if(!/^image\/(jpeg|png|webp)$/.test(paymentFile.type))throw new Error('Usa JPG, PNG o WebP.');
        voucher=await compressToBudget(paymentFile,400*1024);if(voucher.length>600000)throw new Error('Comprobante demasiado pesado.');
      }
      const created = registeredBusiness || await addDoc(collection(db, 'businesses'), {""")
change('app.js',"      if (plan !== 'Free') { const voucher = await compressToBudget(paymentFile, 400 * 1024); await addDoc","      registeredBusiness=created;registrationDraft=fd;\n      if (plan !== 'Free') { await addDoc")
change('app.js',"    } catch (err) { toast(errMsg(err)); }\n  };\n}\n$('#addBusiness').onclick", "    } catch (err) { toast((registeredBusiness?'Negocio registrado; reintenta el comprobante sin cerrar esta ventana. ':'')+errMsg(err)); }finally{registrationSending=false;if(submit.isConnected)submit.disabled=false;}\n  };\n}\n$('#addBusiness').onclick")
change('firestore.rules','userDoc().data.disabled == true',"userDoc().data.get('disabled', false) == true")
change('firestore.rules','    // Todo lo demás, cerrado.',r"""    match /settings/payments {
      function valid(d) {
        return d.keys().hasAll(['yapeEnabled','yapeNumber','yapeHolder','plinEnabled','plinNumber','plinHolder','paypalEnabled','paypalEmail','paypalUrl','updatedAt'])
          && d.keys().hasOnly(['yapeEnabled','yapeNumber','yapeHolder','plinEnabled','plinNumber','plinHolder','paypalEnabled','paypalEmail','paypalUrl','updatedAt'])
          && d.yapeEnabled is bool && d.plinEnabled is bool && d.paypalEnabled is bool
          && str(d.yapeNumber,0,9) && str(d.plinNumber,0,9) && str(d.yapeHolder,0,100) && str(d.plinHolder,0,100)
          && str(d.paypalEmail,0,254) && str(d.paypalUrl,0,500)
          && (!d.yapeEnabled || (d.yapeNumber.matches('^9[0-9]{8}$') && d.yapeHolder.size()>0))
          && (!d.plinEnabled || (d.plinNumber.matches('^9[0-9]{8}$') && d.plinHolder.size()>0))
          && (d.paypalEmail=='' || d.paypalEmail.matches('^[^ @]+@[^ @]+[.][^ @]+$'))
          && (d.paypalUrl=='' || d.paypalUrl.matches('^https://(www[.])?paypal[.]me/[^ @]*$') || d.paypalUrl.matches('^https://(www[.])?paypal[.]com/[^ @]*$'))
          && (!d.paypalEnabled || d.paypalEmail.size()>0 || d.paypalUrl.size()>0)
          && d.updatedAt == request.time;
      }
      allow get: if true;
      allow create, update: if isAdmin() && valid(request.resource.data);
      allow delete: if false;
    }

    // Todo lo demás, cerrado.""")
change('service-worker.js',"const CACHE_NAME = 'eventmaps-shell-v4-ui';","const CACHE_NAME = 'eventmaps-shell-v5-payments';")
change('service-worker.js',"const APP_SHELL = ['./',","const APP_SHELL = ['./payment-settings.js', './map-premium.css', './',")
for name,text in files.items():Path(name).write_text(text)
for name in ['app.js','payment-settings.js','service-worker.js']:
 test=subprocess.run(['node','--input-type=module','--check'],input=Path(name).read_text(),text=True,capture_output=True)
 if test.returncode:raise SystemExit(test.stderr)
for code in re.findall(r'<script type="module">(.*?)</script>',files['admin/index.html'],re.S):
 test=subprocess.run(['node','--input-type=module','--check'],input=code,text=True,capture_output=True)
 if test.returncode:raise SystemExit(test.stderr)
for fake in ['987654321','987 654 321','paypal.me/eventmaps','test_eventmaps_','0002010102115303604540']:
 if fake in files['app.js']:raise SystemExit('Example recipient remains: '+fake)
print('Syntax and patch checks passed. Browser and Firestore emulator tests were not run. No Firebase deployment performed.')
