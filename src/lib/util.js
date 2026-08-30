// Small DOM + formatting helpers, sheet/toast primitives.
export const $ = s => document.querySelector(s);
export const el = h => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
export const DAYN = ['S','M','T','W','T','F','S'];
export const DAYF = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const attr = s => String(s ?? '').replace(/'/g, '’');
export const inits = n => (n||'').trim().split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase() || '?';

export function haversine(a, b) {
  const R=6371, dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180,
    la1=a.lat*Math.PI/180, la2=b.lat*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
export const distLabel = km => km==null ? null : (km<1 ? Math.round(km*1000)+' m' : km.toFixed(1)+' km');

export function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('on'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('on'),2400); }
export function haptic(){ if(navigator.vibrate) navigator.vibrate(7); }

export function openMaps(lat,lng,label){
  const iOS=/iPad|iPhone|iPod/.test(navigator.userAgent||'');
  const url=iOS?`https://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`
               :`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  toast('Opening maps to '+label+'…'); try{ window.open(url,'_blank'); }catch(e){}
}
export const waLink = phone => 'https://wa.me/'+String(phone||'').replace(/[^0-9]/g,'');

// bottom-sheet
export function showSheet(head, body, foot){
  const sh=$('#sheet');
  sh.innerHTML=`<div class="sheet-grab"></div>${head}<div class="sheet-body">${body}</div>${foot?`<div class="sheet-foot">${foot}</div>`:''}`;
  $('#scrim').classList.add('on'); requestAnimationFrame(()=>sh.classList.add('on'));
}
export function closeSheet(){ $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); }

// service date helper: next occurrence of a recurring ride (weekday in weekdays[])
export function nextServiceDate(weekdays){
  const today=new Date();
  for(let i=0;i<14;i++){ const d=new Date(today); d.setDate(today.getDate()+i);
    if(weekdays.includes(d.getDay())) return d.toISOString().slice(0,10); }
  return today.toISOString().slice(0,10);
}
export const freqLabel = r => r.frequency==='onetime'
  ? (r.ride_date ? new Date(r.ride_date+'T00:00').toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}) : 'One-time')
  : (r.weekdays||[]).slice().sort().map(d=>DAYF[d]).join(' ');
