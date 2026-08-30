import './styles.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase, CONFIG_OK } from './lib/supabase.js';
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
  if(!CONFIG_OK){
    document.getElementById('topbar').hidden=true; document.getElementById('nav').hidden=true;
    document.getElementById('screen').innerHTML =
      '<div style="padding:48px 24px;text-align:center;max-width:360px;margin:0 auto;color:var(--ink)">'+
      '<div style="font-size:20px;font-weight:700;margin-bottom:8px">Almost there</div>'+
      '<div style="color:var(--ink-3);font-size:14px;line-height:1.5">This build is missing its Supabase settings. In Netlify set <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b>, then redeploy with “Clear cache and deploy site”.</div></div>';
    return;
  }
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

supabase.auth.onAuthStateChange((event, session) => {
  store.session = session; store.user = session?.user || null;
  if(!booted){ booted=true; boot(session); return; }
  if(event === 'SIGNED_IN'){ boot(session); }        // login or sign-up completed → enter app
  else if(event === 'SIGNED_OUT'){ location.reload(); }
  // ignore INITIAL_SESSION / TOKEN_REFRESHED / USER_UPDATED — no reload
});

// Clear any previously-registered service worker + caches (they could serve a stale blank page).
// PWA offline caching can be re-added later once the app is stable.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
  if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
}

// initial check in case the event fired before listener (rare)
(async()=>{
  const session = (await supabase.auth.getSession()).data.session;
  if(!booted){ booted=true; boot(session); }
})();
