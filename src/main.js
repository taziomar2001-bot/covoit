import './styles.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from './lib/supabase.js';
import { store, loadAll } from './lib/store.js';
import * as api from './lib/api.js';
import { CV, enterApp, renderTopbar, render } from './app.js';
import { AV, renderAuth } from './auth.js';

// expose inline-handler namespaces
window.CV = CV;
window.AV = AV;

// theme
try { const t=localStorage.getItem('cv_theme'); if(t) store.theme=t;
  else if(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) store.theme='dark';
} catch(e){}
document.documentElement.setAttribute('data-theme', store.theme);

let booted=false;
async function boot(session){
  if(!session){ renderAuth(); return; }
  // handle post-signup extras once
  if(window.__pendingSignup){
    const { photoFile, hasCar, code } = window.__pendingSignup; window.__pendingSignup=null;
    try{
      const patch={ id:session.user.id, has_car:!!hasCar };
      if(photoFile){ try{ patch.photo_url = await api.uploadAvatar(session.user.id, photoFile); }catch(e){} }
      await api.upsertProfile(patch);
      if(code){ try{ await api.joinGroup(code); }catch(e){} }
    }catch(e){}
  }
  const ok = await loadAll();
  if(!ok){ renderAuth(); return; }
  store.tab='home'; enterApp();
  subscribeRealtime(session.user.id);
}

// live notification badge + list updates
let channel=null;
function subscribeRealtime(uid){
  if(channel) return;
  channel = supabase.channel('notif')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications', filter:`user_id=eq.${uid}` },
      async () => { store.notifications = await api.myNotifications(); renderTopbar(); if(store.tab==='notif') render(); })
    .subscribe();
}

supabase.auth.onAuthStateChange((_event, session) => {
  store.session = session; store.user = session?.user || null;
  if(!booted){ booted=true; boot(session); }
  else if(!session){ location.reload(); }
});

// PWA service worker (installability + offline shell)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// initial check in case the event fired before listener (rare)
(async()=>{
  const session = (await supabase.auth.getSession()).data.session;
  if(!booted){ booted=true; boot(session); }
})();
