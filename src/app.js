import { I } from './lib/icons.js';
import { $, el, DAYN, DAYF, esc, attr, inits, haversine, distLabel, toast, haptic,
         openMaps, waLink, showSheet, closeSheet, nextServiceDate, freqLabel } from './lib/util.js';
import * as api from './lib/api.js';
import { geocode } from './lib/geocode.js';
import { store, currentGroupObj, loadRides, loadNotifications, loadGroups, loadMyRides,
         requestLocation, dirLabel } from './lib/store.js';
// MapLibre is lazy-loaded the first time the map opens (keeps initial load light).
let maplibregl = null;
async function ensureMapLibre(){ if(!maplibregl){ maplibregl = (await import('maplibre-gl')).default; } return maplibregl; }

/* ---------- derived helpers over a ride row ---------- */
const isFull = r => r._seatsLeft <= 0;
const destShort = r => r.dest_name === (currentGroupObj()?.dest_name) ? 'Campus'
  : (r.dest_name || '').replace('IESE ','').replace(' Campus','').split(',')[0];
const gShort = g => (g?.dest_name||'').replace('IESE ','').replace(' Campus','').split(',')[0] || 'Campus';
const meName = () => `${store.profile?.first_name||''} ${store.profile?.last_name||''}`.trim() || 'You';
const meInits = () => inits(meName());
function distTo(r){ return store.myLoc ? haversine(store.myLoc, {lat:r.pickup_lat,lng:r.pickup_lng}) : null; }
function inTime(r){ return r.depart_time >= store.timeFrom && r.depart_time <= store.timeTo; }

function visibleRides(){
  let rs = store.rides.filter(inTime);
  if (store.filterType !== 'all') rs = rs.filter(r => r.type === store.filterType);
  if (store.filterAvail) rs = rs.filter(r => !isFull(r) || r._mine);
  if (store.myLoc) rs.sort((a,b) => (distTo(a)??1e9) - (distTo(b)??1e9));
  else rs.sort((a,b) => a.depart_time.localeCompare(b.depart_time));
  return rs;
}

/* ===================== SHELL ===================== */
export function renderTopbar(){
  const tb = $('#topbar');
  const themeBtn = `<button class="iconbtn" onclick="CV.toggleTheme()">${store.theme==='dark'?I.sun:I.moon}</button>`;
  const bellBtn  = `<button class="iconbtn" onclick="CV.go('notif')">${I.bell}${store.notifications.some(n=>!n.read)?'<span class="dot"></span>':''}</button>`;
  const t = store.tab;
  if (t==='home') tb.innerHTML = `<div class="logo"><div class="mark">Co</div><div><div class="tb-title">CoVoit</div><div class="tb-sub">Hi, ${esc(store.profile?.first_name||'there')}</div></div></div><div class="spacer"></div>${themeBtn}${bellBtn}`;
  else if (t==='group'){ const g=currentGroupObj();
    tb.innerHTML = `<button class="tb-switch" onclick="CV.openGroupSwitcher()"><div style="text-align:left"><div class="tb-title">${esc(g?g.name.split('·')[0].trim():'No group')}</div><div class="tb-sub">→ ${esc(gShort(g))} · tap to switch</div></div>${I.chevd}</button><div class="spacer"></div>${themeBtn}${bellBtn}`; }
  else if (t==='rides') tb.innerHTML = `<div><div class="tb-title">My Rides</div><div class="tb-sub">Your commute schedule</div></div><div class="spacer"></div>${themeBtn}${bellBtn}`;
  else if (t==='profile') tb.innerHTML = `<div><div class="tb-title">Profile</div></div><div class="spacer"></div>${themeBtn}`;
  else if (t==='notif') tb.innerHTML = `<button class="iconbtn" onclick="CV.go('home')">${I.back}</button><div><div class="tb-title">Notifications</div></div><div class="spacer"></div><button class="btn sm ghost" onclick="CV.markAllRead()">Mark read</button>`;
}
export function renderNav(){
  const a=(t,l,ic)=>`<a class="${store.tab===t?'active':''}" onclick="CV.go('${t}')">${ic}<span>${l}</span></a>`;
  $('#nav').innerHTML = a('home','Home',I.home)+a('group','Map',I.map)+
    `<div class="fab-wrap"><button class="fab" onclick="CV.openCreate()">${I.plus}</button></div>`+
    a('rides','My Rides',I.rides)+a('profile','Profile',I.profile);
}
export function enterApp(){ $('#topbar').hidden=false; $('#nav').hidden=false; renderTopbar(); renderNav(); render(); }

export async function go(tab){
  store.tab = tab; haptic(); renderTopbar(); renderNav();
  if (tab==='group') await loadRides();
  if (tab==='notif') { await api.markAllRead(); }
  render(); $('#screen').scrollTop = 0;
  if (tab==='home' || tab==='rides') refreshDynamic(tab);
}
async function refreshDynamic(tab){
  if (tab==='home'){ await loadRides(); if(store.tab==='home') render(); }
  if (tab==='rides'){ const list = await loadMyRides(); if(store.tab==='rides'){ store._myrides=list; render(); } }
}
export function render(){
  const sc = $('#screen'); sc.className = 'screen' + (store.tab==='group' ? ' nopad' : '');
  const t = store.tab;
  if (t==='home') sc.innerHTML = viewHome();
  else if (t==='group') renderGroup();
  else if (t==='rides') sc.innerHTML = viewRides();
  else if (t==='profile') sc.innerHTML = viewProfile();
  else if (t==='notif') sc.innerHTML = viewNotif();
  if (t!=='group') sc.classList.add('pop');
}

/* ===================== HOME ===================== */
function viewHome(){
  const g = currentGroupObj();
  const avail = store.rides.filter(r => !r._mine && !isFull(r));
  const near = avail.slice().sort((a,b)=>(distTo(a)??1e9)-(distTo(b)??1e9)).slice(0,3);
  const myNext = store.rides.find(r => r._mine) || store.rides.find(r => r._joinedByMe);
  const hero = myNext ? `
    <div class="hero">
      <div class="hl">YOUR NEXT COMMUTE</div>
      <div class="hbig">${esc(myNext.pickup_name)} → ${esc(destShort(myNext))}</div>
      <div class="hrow"><span class="hi">${I.clock} ${myNext.depart_time}</span><span class="hi">${I.users} ${myNext._mine?(myNext._participants.length+' aboard'):'You + '+myNext._participants.length}</span><span class="hi">${myNext.frequency==='recurring'?I.repeat+' '+freqLabel(myNext):I.clock+' one-time'}</span></div>
      <div class="hbtns"><button class="hbtn solid" onclick="CV.openRide('${myNext.id}')">View ride</button><button class="hbtn" onclick="CV.go('group')">Group map</button></div>
    </div>` : `
    <div class="hero">
      <div class="hl">GET TO CAMPUS</div>
      <div class="hbig">No trips booked yet</div>
      <div class="hrow"><span class="hi">${I.info} Find a ride near you or offer one</span></div>
      <div class="hbtns"><button class="hbtn solid" onclick="CV.go('group')">Find a ride</button><button class="hbtn" onclick="CV.openCreate()">Offer a ride</button></div>
    </div>`;
  return `<div class="wrap">
    ${hero}
    <div class="quickrow">
      <div class="qcard tap" onclick="CV.go('group')"><div class="qn tnum">${avail.length}</div><div class="qt">rides available now</div></div>
      <div class="qcard tap" onclick="CV.go('rides')"><div class="qn tnum">${store.rides.filter(r=>r._mine||r._joinedByMe).length}</div><div class="qt">your upcoming trips</div></div>
    </div>
    <div class="section-h">Your groups</div>
    <div class="card">
      ${store.groups.length? store.groups.map(g=>`<div class="grouprow tap" onclick="CV.enterGroup('${g.id}')"><div class="gicon">🎓</div><div style="flex:1;min-width:0"><div class="gname">${esc(g.name)}</div><div class="gmeta">${g.members||0} members · → ${esc(gShort(g))}</div></div>${I.chev}</div>`).join('')
        : `<div class="sr">You're not in any group yet.</div>`}
      <div style="padding-top:12px"><button class="btn ghost sm" style="width:100%" onclick="CV.openGroupSwitcher()">${I.add} Join or create a group</button></div>
    </div>
    <div class="section-h">Nearby & leaving soon <a class="more" onclick="CV.go('group')">See all</a></div>
    ${near.length? near.map(rideCard).join('') : `<div class="card"><div class="sr">No available rides in this group right now.</div></div>`}
  </div>`;
}

/* ===================== RIDE CARD ===================== */
function rideCard(r){
  const left=r._seatsLeft, full=isFull(r), d=distLabel(distTo(r));
  const type = r.type==='taxi'?`<span class="chip taxi">${I.taxi} Shared taxi</span>`:`<span class="chip driver">${I.car} Driver</span>`;
  const seat = full?`<span class="chip seats none">Full</span>`:`<span class="chip seats">${left} seat${left>1?'s':''}</span>`;
  return `<div class="card ride tap ${full?'full':''}" onclick="CV.openRide('${r.id}')">
    <div class="ride-top">
      <div class="pin ${r.type}">${r.type==='taxi'?I.taxi:I.car}</div>
      <div class="ride-head">
        <div class="route-min">${esc(r.pickup_name)} ${r._mine?'<span class="chip you">You</span>':''}<span class="arw">→</span><span class="dst">${esc(destShort(r))}</span></div>
        <div class="ride-sub">${esc(r.pickup_addr||'')}</div>
      </div>
      <div class="time-badge tnum">${r.depart_time}</div>
    </div>
    <div class="chips">${type}${seat}${r.has_return?`<span class="chip">${I.repeat} Return ${r.return_time}</span>`:''}${r.type==='driver'?`<span class="chip">${I.fuel} ${r.fuel_share?'Fuel share':'Free'}</span>`:''}<span class="chip">${r.frequency==='recurring'?I.repeat+' '+freqLabel(r):I.clock+' '+freqLabel(r)}</span></div>
    <div class="ride-foot">
      <div class="who"><span class="ava" ${r.creator_photo?`style="background-image:url(${esc(r.creator_photo)})"`:''}>${inits(r.creator_name)}</span>${r._mine?'Your ride':esc(r.creator_name)}</div>
      ${d?`<span class="dist">${I.loc} ${d}</span>`:(r._joinedByMe?`<span class="tag-you">Joined</span>`:'')}
    </div>
  </div>`;
}

/* ===================== GROUP (MAP/LIST) ===================== */
let map, markers=[], selfMarker=null;
function renderGroup(){
  const sc=$('#screen');
  if (!currentGroupObj()){ sc.innerHTML = viewNoGroup(); return; }
  sc.innerHTML = `
    <div class="mapscreen" id="mapscreen" style="${store.groupView==='list'?'display:none':''}">
      <div id="map"></div>
      <div class="map-overlay-top">
        <div class="seg"><button class="${store.groupView==='map'?'on':''}" onclick="CV.setView('map')">Map</button><button class="${store.groupView==='list'?'on':''}" onclick="CV.setView('list')">List</button></div>
        ${filterBar()}
      </div>
      <div class="map-count" id="mapcount"></div>
      <button class="locbtn ${store.myLoc?'on':''}" onclick="CV.toggleLoc()">${I.loc}</button>
    </div>
    <div id="listview" class="wrap" style="${store.groupView==='map'?'display:none':''}">
      <div class="seg" style="margin-bottom:12px"><button class="${store.groupView==='map'?'on':''}" onclick="CV.setView('map')">Map</button><button class="${store.groupView==='list'?'on':''}" onclick="CV.setView('list')">List</button></div>
      ${filterBar()}<div style="height:12px"></div><div id="listcards"></div>
    </div>`;
  if (store.groupView==='map') setTimeout(initMap,30); else renderList();
}
function viewNoGroup(){ return `<div class="wrap"><div class="empty"><div class="ei">${I.users}</div><div class="et">Join your class group</div><div class="ed">Enter the invite code a classmate shared to see everyone's rides.</div><div class="ebtns"><button class="btn primary" onclick="CV.openGroupSwitcher()">${I.add} Enter a group code</button></div></div></div>`; }
function filterBar(){ return `<div class="filterbar">
    <button class="fpill ${store.filterAvail?'on':''}" onclick="CV.toggleAvail()">${store.filterAvail?I.check:''} Available only</button>
    <button class="fpill ${store.filterType!=='all'?'on':''}" onclick="CV.cycleType()">${I.car} ${store.filterType==='all'?'All types':store.filterType==='driver'?'Drivers':'Shared taxis'}</button>
    <button class="fpill" onclick="CV.openTimeFilter()">${I.clock} ${store.timeFrom}–${store.timeTo}</button>
  </div>`; }
function setView(v){ store.groupView=v; renderGroup(); }
function toggleAvail(){ store.filterAvail=!store.filterAvail; refreshGroup(); }
function cycleType(){ store.filterType = store.filterType==='all'?'driver':store.filterType==='driver'?'taxi':'all'; refreshGroup(); }
function refreshGroup(){ document.querySelectorAll('.filterbar').forEach(f=>f.outerHTML=filterBar()); if(store.groupView==='map'){drawMarkers();updateCount();} else renderList(); }
function renderList(){
  const rs=visibleRides(), box=$('#listcards'); if(!box) return;
  if(!rs.length){ box.innerHTML=emptyRides(); return; }
  const note = store.myLoc?'Sorted by distance from you':'Enable location to sort by distance';
  box.innerHTML = `<div class="sr" style="text-align:left;padding:0 2px 12px">${rs.length} ride${rs.length>1?'s':''} · ${note}</div>` + rs.map(rideCard).join('');
}
function emptyRides(){ return `<div class="empty"><div class="ei">${I.clock}</div><div class="et">No rides around ${store.timeFrom}–${store.timeTo}</div><div class="ed">Nobody's offered a ride in this window yet. Be the first — or widen your search.</div><div class="ebtns"><button class="btn primary" onclick="CV.openCreate()">${I.plus} Create a ride</button><button class="btn ghost" onclick="CV.openCreate('taxi')">${I.taxi} Split a taxi</button><button class="btn ghost" onclick="CV.widenTime()">Widen time range</button></div></div>`; }
function widenTime(){ store.timeFrom='05:00'; store.timeTo='12:00'; refreshGroup(); }
function updateCount(){ const c=$('#mapcount'); if(!c)return; const n=visibleRides().filter(r=>!r._mine).length; c.innerHTML=`${I.pin} ${n} ride${n!==1?'s':''} shown`; }

/* ---- map ---- */
function mapStyle(){ return store.theme==='dark'?'https://tiles.openfreemap.org/styles/dark':'https://tiles.openfreemap.org/styles/bright'; }
async function initMap(){
  const c=document.getElementById('map'); if(!c) return;
  await ensureMapLibre();
  if(!document.getElementById('map')) return; // user navigated away while loading
  if(map){ try{map.remove()}catch(e){} map=null; markers=[]; selfMarker=null; }
  const g=currentGroupObj();
  try{
    map=new maplibregl.Map({container:'map',style:mapStyle(),center:[g.dest_lng,g.dest_lat],zoom:11.3,attributionControl:false});
    map.addControl(new maplibregl.AttributionControl({compact:true}));
    map.on('load',()=>{ drawMarkers(); updateCount(); fitRides(); });
    map.on('error',()=>{});
  }catch(e){
    c.innerHTML=`<div class="empty" style="padding-top:90px"><div class="ei">${I.map}</div><div class="et">Map needs internet</div><div class="ed">List view works offline.</div><div class="ebtns"><button class="btn primary" onclick="CV.setView('list')">Switch to List</button></div></div>`;
  }
}
function marker(cls, inner, lng, lat, onclick){
  const node=el(`<div class="mk ${cls}"><div class="mk-body">${inner}</div><div class="mk-tip"></div></div>`);
  if(onclick) node.onclick=onclick;
  return new maplibregl.Marker({element:node,anchor:'bottom'}).setLngLat([lng,lat]).addTo(map);
}
function drawMarkers(){
  if(!map) return; markers.forEach(m=>m.remove()); markers=[];
  const g=currentGroupObj();
  markers.push(marker('campus',`<div class="mk-ic">${I.flag}</div>${esc(gShort(g))}`, g.dest_lng, g.dest_lat));
  visibleRides().forEach(r=>{
    const full=isFull(r);
    markers.push(marker(`${r.type} ${full?'full':''} ${r._mine?'you':''}`,
      `<div class="mk-ic">${r.type==='taxi'?I.taxi:I.car}</div>${r._mine?'You':esc(r.pickup_name.split(' ')[0])}<span class="mk-seat">· ${full?'full':r._seatsLeft}</span>`,
      r.pickup_lng, r.pickup_lat, ()=>openRide(r.id)));
  });
  if(store.myLoc) drawSelf();
}
function drawSelf(){ if(selfMarker){selfMarker.remove();selfMarker=null;} if(!store.myLoc||!map)return;
  selfMarker=new maplibregl.Marker({element:el('<div class="selfdot"></div>')}).setLngLat([store.myLoc.lng,store.myLoc.lat]).addTo(map); }
function fitRides(){ if(!map)return; const g=currentGroupObj();
  const pts=visibleRides().map(r=>[r.pickup_lng,r.pickup_lat]).concat([[g.dest_lng,g.dest_lat]]);
  if(pts.length<2)return; const b=pts.reduce((a,p)=>a.extend(p),new maplibregl.LngLatBounds(pts[0],pts[0]));
  map.fitBounds(b,{padding:{top:130,bottom:80,left:50,right:50},maxZoom:13.5,duration:600}); }
async function toggleLoc(){
  if(store.myLoc){ store.myLoc=null; document.querySelector('.locbtn')?.classList.remove('on'); drawSelf(); drawMarkers(); updateCount(); toast('Location off'); return; }
  const loc=await requestLocation();
  if(!loc){ toast('Location permission denied'); return; }
  document.querySelector('.locbtn')?.classList.add('on'); drawSelf(); drawMarkers(); updateCount();
  if(map) map.easeTo({center:[loc.lng,loc.lat],zoom:12.8,duration:700});
  toast('Location on · rides sorted by distance');
}

/* ===================== RIDE DETAIL ===================== */
async function openRide(id){
  let r = store.rides.find(x=>x.id===id) || (store._myrides||[]).find(x=>x.id===id);
  if(!r) return; haptic();
  const left=r._seatsLeft, full=isFull(r), member=r._mine||r._joinedByMe;
  const total=r._participants.length+(r._joinedByMe?1:0);
  const badge = r.type==='taxi'?`<span class="chip taxi">${I.taxi} Shared taxi</span>`:`<span class="chip driver">${I.car} Driver ride</span>`;
  const vehicle = r.type==='driver'?`<div class="kv"><div class="k">${I.car}</div><div><div class="kk">VEHICLE</div><div class="vv">${r._mine&&store.profile?.vehicle_model?esc(store.profile.vehicle_model+' · '+(store.profile.vehicle_color||'')):'Registered vehicle'}</div></div></div>`:'';
  const body=`
    <div class="route-line">
      <div class="rl-row"><div class="rl-dots"><div class="rl-dot"></div><div class="rl-bar"></div></div>
        <div class="rl-txt"><div class="p">${esc(r.pickup_name)}</div><div class="t">${esc(r.pickup_addr||'')} · departs ${r.depart_time}</div></div>
        <button class="navbtn" onclick="event.stopPropagation();CV.openMaps(${r.pickup_lat},${r.pickup_lng},'${attr(r.pickup_name)}')">${I.nav} Go</button></div>
      <div class="rl-row"><div class="rl-dots"><div class="rl-dot b"></div></div>
        <div class="rl-txt" style="padding-bottom:2px"><div class="p">${esc(r.dest_name)}</div><div class="t">${esc(r.dest_addr||'')}</div></div>
        <button class="navbtn" onclick="event.stopPropagation();CV.openMaps(${r.dest_lat},${r.dest_lng},'${attr(r.dest_name)}')">${I.nav} Go</button></div>
    </div>
    ${r.has_return?`<div class="banner accent">${I.repeat}<div><b>Return trip available</b> · ${esc(destShort(r))} → ${esc(r.pickup_name)} at ${r.return_time}</div></div>`:''}
    <div class="kv"><div class="k">${I.clock}</div><div><div class="kk">WHEN</div><div class="vv">${r.frequency==='recurring'?'Every '+freqLabel(r)+' · '+r.depart_time:freqLabel(r)+' · '+r.depart_time}</div></div></div>
    <div class="kv"><div class="k">${I.users}</div><div><div class="kk">SEATS</div><div class="vv">${full?'<span style="color:var(--danger)">Full</span>':left+' of '+r.seats_total+' available'}</div></div></div>
    ${r.type==='driver'?`<div class="kv"><div class="k">${I.fuel}</div><div><div class="kk">FUEL COST</div><div class="vv">${r.fuel_share?'Contribution expected (split among riders)':'No contribution required'}</div></div></div>`:`<div class="kv"><div class="k">${I.taxi}</div><div><div class="kk">TAXI COST</div><div class="vv">Split equally among participants</div></div></div>`}
    ${vehicle}
    ${r.notes?`<div class="kv"><div class="k">${I.info}</div><div><div class="kk">NOTES</div><div class="vv" style="font-weight:500">${esc(r.notes)}</div></div></div>`:''}
    <div class="section-h" style="margin-top:20px">${r.type==='taxi'?'Participants':'Passengers'} · ${total}/${r.seats_total}</div>
    <div id="ridepeople">${member?`<div class="sr">Loading contacts…</div>`:peopleGated(r,total)}</div>
    <div style="height:6px"></div>`;
  let footer;
  if(r._mine) footer=`<button class="btn ghost" onclick="CV.openEdit('${r.id}')">${I.edit} Edit</button><button class="btn danger" onclick="CV.confirmCancelRide('${r.id}')">Cancel ride</button>`;
  else if(r._joinedByMe) footer=`<button class="btn" onclick="CV.closeSheet()">Close</button><button class="btn danger" onclick="CV.leaveRide('${r.id}')">Leave ride</button>`;
  else if(full) footer=`<button class="btn" disabled>Ride is full</button>`;
  else footer=`<button class="btn primary" onclick="CV.openJoin('${r.id}')">Join ride · ${left} seat${left>1?'s':''} left</button>`;
  showSheet(`<div class="sheet-head"><div class="pin ${r.type}">${r.type==='taxi'?I.taxi:I.car}</div><div style="flex:1"><div class="sheet-title">${esc(r.pickup_name)} → ${esc(destShort(r))}</div><div style="margin-top:6px">${badge}</div></div><button class="closex" onclick="CV.closeSheet()">${I.x}</button></div>`, body, footer);
  if(member) loadContacts(r, total);
}
function peopleGated(r,total){
  if(total===0) return `<div class="sr" style="text-align:left;padding:8px 0">No ${r.type==='taxi'?'participants':'passengers'} yet — be the first to join.</div>`;
  const rows = r._participants.map(p=>`<div class="person"><span class="ava mut">${inits(p.name)}</span><div><div class="nm">${esc(p.name)}</div><div class="rl">${p.direction==='both'?'Outbound + return':p.direction==='return'?'Return':'Outbound'}</div></div></div>`).join('');
  return `<div class="people">${rows}</div><div style="margin-top:14px"><div class="banner">${I.info}<div>Contact details unlock <b>after you join</b>. Phone numbers are never public to the group.</div></div></div>`;
}
async function loadContacts(r, total){
  try{
    const contacts = await api.rideContacts(r.id);
    const box=$('#ridepeople'); if(!box) return;
    const waGroup = total>0?`<div class="wa-group" onclick="CV.startWaGroup('${r.id}')"><div class="wi">${I.chat}</div><div><div class="wt">Start WhatsApp group</div><div class="wd">${contacts.length} people on this ride</div></div><div class="go">${I.chev}</div></div>`:'';
    const rows = contacts.map(c=>{
      const me = c.user_id===store.user.id;
      const contact = c.phone?`<div class="contact"><a class="cbtn wa" onclick="event.stopPropagation();window.open('${waLink(c.phone)}','_blank')">${I.chat}</a><a class="cbtn call" onclick="event.stopPropagation();window.location.href='tel:${esc((c.phone||'').replace(/\\s/g,''))}'">${I.phone}</a></div>`:'';
      return `<div class="person"><span class="ava ${me?'':'mut'}" ${c.photo_url?`style="background-image:url(${esc(c.photo_url)})"`:''}>${inits(c.name)}</span><div><div class="nm">${esc(c.name)||'Rider'}${me?' <span class="tag-you">You</span>':''}</div><div class="rl ph">${c.role==='driver'?'Driver':'Passenger'}${c.phone?' · '+esc(c.phone):''}</div></div>${me?'':contact}</div>`;
    }).join('');
    box.innerHTML = waGroup + `<div class="people">${rows}</div><div style="margin-top:14px"><div class="banner good">${I.info}<div>You're on this ride, so everyone's details are shared. Message the group or reach anyone directly.</div></div></div>`;
  }catch(e){ const box=$('#ridepeople'); if(box) box.innerHTML=peopleGated(r,total); }
}
function startWaGroup(id){
  closeSheet();
  setTimeout(()=>{ toast('Opening WhatsApp to start a group…'); try{window.open('https://wa.me/','_blank');}catch(e){} },200);
}

/* ---- join ---- */
let joinChoice='both', joinDate='all';
function openJoin(id){ const r=store.rides.find(x=>x.id===id); joinChoice=r.has_return?'both':'out'; joinDate=r.frequency==='recurring'?'all':'one'; renderJoin(id); }
function renderJoin(id){
  const r=store.rides.find(x=>x.id===id);
  const dir=r.has_return?`<div class="section-h" style="margin-top:0">Which journey?</div>
    <div class="opt ${joinChoice==='both'?'on':''}" onclick="CV.setJoin('${id}','both')"><div class="radio"></div><div><div class="ot">Outbound + return</div><div class="od">${esc(r.pickup_name)} → ${esc(destShort(r))} ${r.depart_time} · back ${r.return_time}</div></div></div>
    <div class="opt ${joinChoice==='out'?'on':''}" onclick="CV.setJoin('${id}','out')"><div class="radio"></div><div><div class="ot">Outbound only</div><div class="od">${esc(r.pickup_name)} → ${esc(destShort(r))} · ${r.depart_time}</div></div></div>
    <div class="opt ${joinChoice==='ret'?'on':''}" onclick="CV.setJoin('${id}','ret')"><div class="radio"></div><div><div class="ot">Return only</div><div class="od">${esc(destShort(r))} → ${esc(r.pickup_name)} · ${r.return_time}</div></div></div>`
    :`<div class="banner accent">${I.pin}<div>${esc(r.pickup_name)} → ${esc(destShort(r))} · departs ${r.depart_time}</div></div>`;
  const date=r.frequency==='recurring'?`<div class="section-h">How often?</div>
    <div class="opt ${joinDate==='all'?'on':''}" onclick="CV.setJoinDate('${id}','all')"><div class="radio"></div><div><div class="ot">Join the recurring ride</div><div class="od">Every ${freqLabel(r)}</div></div></div>
    <div class="opt ${joinDate==='one'?'on':''}" onclick="CV.setJoinDate('${id}','one')"><div class="radio"></div><div><div class="ot">Just the next date</div><div class="od">${new Date(nextServiceDate(r.weekdays)+'T00:00').toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short'})} only</div></div></div>`:'';
  showSheet(`<div class="sheet-head"><div style="flex:1" class="sheet-title">Join ride</div><button class="closex" onclick="CV.openRide('${id}')">${I.x}</button></div>`,
    `${dir}${date}<div class="banner" style="margin-top:14px">${I.info}<div>After joining, ${esc(r.creator_name)}'s contact details unlock and you'll appear in the passenger list.</div></div>`,
    `<button class="btn ghost" onclick="CV.openRide('${id}')">Back</button><button class="btn primary" id="joinbtn" onclick="CV.doJoin('${id}')">Confirm join</button>`);
}
function setJoin(id,v){ joinChoice=v; renderJoin(id); }
function setJoinDate(id,v){ joinDate=v; renderJoin(id); }
async function doJoin(id){
  const r=store.rides.find(x=>x.id===id);
  const btn=$('#joinbtn'); if(btn){btn.textContent='Joining…';btn.disabled=true;}
  const direction = !r.has_return?'outbound':(joinChoice==='both'?'both':joinChoice==='out'?'outbound':'return');
  const serviceDate = (r.frequency==='recurring' && joinDate==='one') ? nextServiceDate(r.weekdays)
                    : (r.frequency==='onetime' ? (r.ride_date||nextServiceDate(r.weekdays||[])) : null);
  try{
    await api.joinRide(id, serviceDate, direction);
    haptic(); closeSheet();
    await loadRides();
    setTimeout(()=>{ toast('Joined! '+r.creator_name+' has been notified'); renderTopbar(); if(store.tab==='group')refreshGroup(); else render(); },220);
  }catch(e){
    const msg = String(e.message||e);
    closeSheet();
    setTimeout(()=>{ toast(msg.includes('FULL')?'Sorry — that seat was just taken':msg.includes('ALREADY')?'You already booked this ride':'Could not join — please try again'); loadRides().then(()=>{ if(store.tab==='group')refreshGroup(); else render(); }); },220);
  }
}
async function leaveRide(id){
  const r=store.rides.find(x=>x.id===id)||(store._myrides||[]).find(x=>x.id===id);
  try{ await api.leaveRide(id); }catch(e){}
  closeSheet(); await loadRides(); if(store.tab==='rides'){store._myrides=await loadMyRides();}
  setTimeout(()=>{ toast('You left the ride'); if(store.tab==='group')refreshGroup(); else render(); },220);
}
function confirmCancelRide(id){
  const r=store.rides.find(x=>x.id===id)||(store._myrides||[]).find(x=>x.id===id);
  showSheet(`<div class="sheet-head"><div style="flex:1" class="sheet-title">Cancel this ride?</div><button class="closex" onclick="CV.openRide('${id}')">${I.x}</button></div>`,
    `${r.frequency==='recurring'?`<div class="banner">${I.info}<div>This cancels the whole recurring ride. (Per-date cancellation is coming — for now use Edit to change a single day.)</div></div>`:`<div class="banner danger">${I.info}<div>This one-time ride will be cancelled.</div></div>`}
     <div class="banner" style="margin-top:12px">${I.users}<div>${r._participants.length} passenger${r._participants.length!==1?'s':''} will be notified immediately.</div></div>`,
    `<button class="btn ghost" onclick="CV.openRide('${id}')">Keep ride</button><button class="btn danger" onclick="CV.doCancel('${id}')">Confirm cancel</button>`);
}
async function doCancel(id){
  try{ await api.cancelRide(id); }catch(e){}
  closeSheet(); await loadRides(); if(store.tab==='rides'){store._myrides=await loadMyRides();}
  setTimeout(()=>{ toast('Ride cancelled · passengers notified'); render(); },220);
}

/* ===================== CREATE / EDIT RIDE ===================== */
let draft=null, editingId=null;
function openCreate(preType){
  const g=currentGroupObj();
  if(!g){ toast('Join a group first'); openGroupSwitcher(); return; }
  editingId=null;
  draft={ type:preType||'driver', pickup:null,
    dest:{name:g.dest_name, detail:g.dest_addr, lat:g.dest_lat, lng:g.dest_lng}, destIsDefault:true,
    time:'08:00', seats:3, freq:'recurring', days:[1,2,3,4,5], date:'', fuel:false, ret:false, retTime:'18:30', notes:'' };
  renderCreate();
}
function openEdit(id){
  const r=store.rides.find(x=>x.id===id)||(store._myrides||[]).find(x=>x.id===id); if(!r)return;
  editingId=id;
  draft={ type:r.type, pickup:{name:r.pickup_name, detail:r.pickup_addr, lat:r.pickup_lat, lng:r.pickup_lng},
    dest:{name:r.dest_name, detail:r.dest_addr, lat:r.dest_lat, lng:r.dest_lng}, destIsDefault:false,
    time:r.depart_time, seats:r.seats_total, freq:r.frequency, days:(r.weekdays||[]).slice(),
    date:r.ride_date||'', fuel:r.fuel_share, ret:r.has_return, retTime:r.return_time||'18:30', notes:r.notes||'' };
  renderCreate();
}
function renderCreate(){
  const d=draft;
  const body=`
    <div class="field"><label class="label">Ride type</label>
      <div class="typepick">
        <div class="typecard ${d.type==='driver'?'on':''}" onclick="CV.cd('type','driver')"><div class="ti">🚗</div><div class="tt">I'm driving</div><div class="td">Offer seats in your car</div></div>
        <div class="typecard ${d.type==='taxi'?'on':''}" onclick="CV.cd('type','taxi')"><div class="ti">🚕</div><div class="tt">Shared taxi</div><div class="td">Split an Uber / Cabify</div></div>
      </div></div>
    <div class="field ac-wrap"><label class="label">Pick-up location</label>
      <input class="inp" id="pickinp" placeholder="Search address, station, place…" oninput="CV.acSearch('pickup',this.value)" autocomplete="off" value="${d.pickup?esc(d.pickup.name):''}">
      <div id="ac-pickup"></div></div>
    <div class="field ac-wrap"><label class="label">Destination ${d.destIsDefault?'<span class="mut">· group default</span>':''}</label>
      <input class="inp" id="destinp" placeholder="Search destination…" oninput="CV.acSearch('dest',this.value)" autocomplete="off" value="${d.dest?esc(d.dest.name):''}">
      <div id="ac-dest"></div>
      <div class="mut" style="font-size:12px;margin-top:7px;display:flex;gap:7px;align-items:flex-start">${I.info}<span>Pre-filled to your group's campus. Change it for a return trip, an excursion, or any destination.</span></div></div>
    <div class="field"><label class="label">Departure time</label><input class="inp tnum" type="time" value="${d.time}" onchange="CV.cd('time',this.value)"></div>
    <div class="field"><label class="label">${d.type==='driver'?'Available seats':'Max participants'}</label>
      <div class="numpick">${[1,2,3,4,5,6].map(n=>`<button class="day ${d.seats===n?'on':''}" onclick="CV.cd('seats',${n})">${n}</button>`).join('')}</div></div>
    <div class="field"><label class="label">Frequency</label>
      <div class="freqtabs"><button class="${d.freq==='recurring'?'on':''}" onclick="CV.cd('freq','recurring')">Recurring</button><button class="${d.freq==='onetime'?'on':''}" onclick="CV.cd('freq','onetime')">One time</button></div>
      ${d.freq==='recurring'?`<div class="days">${[1,2,3,4,5,6,0].map(i=>`<div class="day ${d.days.includes(i)?'on':''}" onclick="CV.toggleDay(${i})">${DAYN[i]}</div>`).join('')}</div>`:`<input class="inp" type="date" onchange="CV.cd('date',this.value)" value="${d.date}">`}</div>
    ${d.type==='driver'?`<div class="switch" onclick="CV.cd('fuel',${!d.fuel})"><div><div class="st">Share fuel costs</div><div class="sd">Passengers contribute to petrol</div></div><div class="tog ${d.fuel?'on':''}"></div></div>`:''}
    <div class="switch" onclick="CV.cd('ret',${!d.ret})"><div><div class="st">Add return trip</div><div class="sd">Reverses the route back later</div></div><div class="tog ${d.ret?'on':''}"></div></div>
    ${d.ret?`<div class="field" style="margin-top:-2px"><label class="label">Return departure</label><input class="inp tnum" type="time" value="${d.retTime}" onchange="CV.cd('retTime',this.value)"></div>`:''}
    <div class="field"><label class="label">Notes <span class="mut">· optional</span></label><textarea class="inp" placeholder="e.g. meet at the north exit" oninput="CV.cdRaw('notes',this.value)">${esc(d.notes)}</textarea></div>
    <div style="height:2px"></div>`;
  showSheet(`<div class="sheet-head"><div style="flex:1" class="sheet-title">${editingId?'Edit ride':'Create a ride'}</div><button class="closex" onclick="CV.closeSheet()">${I.x}</button></div>`, body,
    `<button class="btn primary" id="pubbtn" onclick="CV.publishRide()">${editingId?'Save changes':'Publish ride'}</button>`);
}
function cd(k,v){ draft[k]=v; renderCreate(); }
function cdRaw(k,v){ draft[k]=v; }
function toggleDay(i){ const x=draft.days.indexOf(i); if(x>=0)draft.days.splice(x,1); else draft.days.push(i); renderCreate(); }
let acTimer;
function acSearch(field,q){
  const box=$('#ac-'+field); if(!box) return;
  if(!q){ box.innerHTML=''; return; }
  clearTimeout(acTimer);
  acTimer=setTimeout(async()=>{
    box.innerHTML=`<div class="ac-list"><div class="ac-item"><span class="aci">${I.search}</span><div><div class="acn">Searching…</div></div></div></div>`;
    const res=await geocode(q, store.myLoc);
    if(!res.length){ box.innerHTML=`<div class="ac-list"><div class="ac-item"><span class="aci">${I.info}</span><div><div class="acn">No matches</div><div class="acd">Try a nearby street or station</div></div></div></div>`; return; }
    window._ac=res;
    box.innerHTML=`<div class="ac-list">${res.map((s,i)=>`<div class="ac-item" onclick="CV.pickAddr('${field}',${i})"><span class="aci">${I.pin}</span><div><div class="acn">${esc(s.name)}</div><div class="acd">${esc(s.detail||'')}</div></div></div>`).join('')}</div>`;
  },250);
}
function pickAddr(field,i){
  const s=(window._ac||[])[i]; if(!s) return;
  if(field==='pickup') draft.pickup=s;
  else { draft.dest={name:s.name, detail:s.detail, lat:s.lat, lng:s.lng}; draft.destIsDefault=false; }
  renderCreate();
}
async function publishRide(){
  const d=draft;
  if(!d.pickup){ toast('Pick a pick-up location first'); return; }
  if(!d.dest){ toast('Choose a destination'); return; }
  if(d.freq==='recurring' && !d.days.length){ toast('Choose at least one day'); return; }
  if(d.freq==='onetime' && !d.date){ toast('Pick a date'); return; }
  const btn=$('#pubbtn'); if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const g=currentGroupObj();
  const payload={
    group_id:g.id, creator_id:store.user.id,
    creator_name:meName(), creator_photo:store.profile?.photo_url||null,
    type:d.type, pickup_name:d.pickup.name, pickup_addr:d.pickup.detail||'', pickup_lat:d.pickup.lat, pickup_lng:d.pickup.lng,
    dest_name:d.dest.name, dest_addr:d.dest.detail||'', dest_lat:d.dest.lat, dest_lng:d.dest.lng,
    depart_time:d.time, seats_total:d.seats, frequency:d.freq, weekdays:d.freq==='recurring'?d.days:[],
    ride_date:d.freq==='onetime'?d.date:null, has_return:!!d.ret, return_time:d.ret?d.retTime:null,
    fuel_share:d.type==='driver'?!!d.fuel:false, notes:d.notes||null,
  };
  try{
    if(editingId) await api.updateRide(editingId, payload);
    else await api.createRide(payload);
    haptic(); closeSheet(); await loadRides();
    setTimeout(()=>{ toast(editingId?'Ride updated · passengers notified':'Ride published · live on the group map'); store.tab='group'; renderTopbar(); renderNav(); render(); },240);
  }catch(e){ if(btn){btn.disabled=false;btn.textContent=editingId?'Save changes':'Publish ride';} toast('Could not save: '+(e.message||'error')); }
}

/* ===================== MY RIDES ===================== */
function viewRides(){
  const list=store._myrides||[];
  const sec=(title,arr,empty)=>`<div class="section-h">${title}</div>`+(arr.length?arr.map(myRow).join(''):`<div class="card"><div class="sr">${empty}</div></div>`);
  return `<div class="wrap">
    ${sec('Recurring commutes', list.filter(r=>r.frequency==='recurring'), 'No recurring rides yet')}
    ${sec('One-time trips', list.filter(r=>r.frequency==='onetime'), 'No one-time trips booked')}
    <div style="height:8px"></div><button class="btn primary" onclick="CV.openCreate()">${I.plus} Create a ride</button>
  </div>`;
}
function myRow(r){
  const role=r._mine?(r.type==='taxi'?'You organise':'You drive'):(r.type==='taxi'?'Taxi participant':'Passenger');
  const col=r._mine?'background:var(--accent-weak);color:var(--accent-ink)':'background:var(--good-weak);color:var(--good)';
  return `<div class="card ride tap" onclick="CV.openRide('${r.id}')">
    <div class="ride-top"><div class="pin ${r.type}">${r.type==='taxi'?I.taxi:I.car}</div>
      <div class="ride-head"><div class="route-min">${esc(r.pickup_name)}<span class="arw">→</span><span class="dst">${esc(destShort(r))}</span></div>
        <div class="ride-sub"><span class="tag-role" style="${col}">${role}</span> · ${r.frequency==='recurring'?freqLabel(r):freqLabel(r)}${r._joinedByMe?' · '+r._joinedByMe:''}</div></div>
      <div class="time-badge tnum">${r.depart_time}</div></div>
    <div class="ride-foot"><div class="who">${r._mine?`${I.users} ${r._participants.length} aboard · ${r._seatsLeft} seat${r._seatsLeft!==1?'s':''} left`:`<span class="ava mut">${inits(r.creator_name)}</span>${esc(r.creator_name)}`}</div>${r.has_return?`<span class="chip">${I.repeat} Return ${r.return_time}</span>`:''}</div>
  </div>`;
}

/* ===================== PROFILE ===================== */
function viewProfile(){
  const p=store.profile||{};
  return `<div class="wrap">
    <div class="prof-head">
      <div class="prof-ava" onclick="CV.pickPhoto('profile')" style="${p.photo_url?`background-image:url(${esc(p.photo_url)})`:''}">${p.photo_url?'':meInits()}<span class="cam-badge">${I.cam}</span></div>
      <div style="flex:1;min-width:0"><div class="prof-name">${esc(meName())}</div><div class="prof-sub">${esc(store.user?.email||'')}</div></div>
      <button class="btn sm ghost" onclick="CV.openEditProfile()">${I.edit} Edit</button>
    </div>
    <div class="section-h">Vehicle</div>
    ${p.has_car?`<div class="listrow tap" onclick="CV.openEditProfile()"><span class="lri">${I.car}</span><div><div class="lrt">${esc(p.vehicle_model||'My car')}</div><div class="prof-sub">${esc(p.vehicle_color||'')}${p.vehicle_seats?' · '+p.vehicle_seats+' seats':''}</div></div><span class="lrv">${I.chev}</span></div>`
      :`<div class="listrow tap" onclick="CV.openEditProfile()"><span class="lri">${I.add}</span><div class="lrt">Add a vehicle</div><span class="lrv">${I.chev}</span></div>`}
    <div class="section-h">Groups</div>
    ${store.groups.map(g=>`<div class="listrow tap" onclick="CV.enterGroup('${g.id}')"><span class="lri" style="font-size:19px">🎓</span><div><div class="lrt">${esc(g.name)}</div><div class="prof-sub">Code ${esc(g.invite_code)} · ${g.members||0} members</div></div><span class="lrv">${I.chev}</span></div>`).join('')}
    <button class="btn ghost sm" style="width:100%;margin-top:2px" onclick="CV.openGroupSwitcher()">${I.add} Join or create a group</button>
    <div class="section-h">Settings</div>
    <div class="listrow tap" onclick="CV.openEditProfile()"><span class="lri">${I.phone}</span><div class="lrt">Phone & personal info</div><span class="lrv">${I.chev}</span></div>
    <div class="listrow tap" onclick="CV.go('notif')"><span class="lri">${I.bell}</span><div class="lrt">Notifications</div><span class="lrv">${I.chev}</span></div>
    <div class="listrow tap" onclick="CV.toggleTheme()"><span class="lri">${store.theme==='dark'?I.sun:I.moon}</span><div class="lrt">Appearance</div><span class="lrv">${store.theme==='dark'?'Dark':'Light'} ${I.chev}</span></div>
    <div style="height:10px"></div>
    <div class="listrow tap" style="color:var(--danger)" onclick="CV.confirmLogout()"><span class="lri" style="color:var(--danger)">${I.logout}</span><div class="lrt">Log out</div></div>
    <div class="sr">CoVoit</div>
  </div>`;
}
let editDraft=null;
function openEditProfile(keep){
  const p=store.profile||{};
  if(!keep) editDraft={ first:p.first_name||'', last:p.last_name||'', phone:p.phone||'', photo:p.photo_url||null,
    car:!!p.has_car, model:p.vehicle_model||'', color:p.vehicle_color||'', seats:p.vehicle_seats||4 };
  const d=editDraft;
  showSheet(`<div class="sheet-head"><div style="flex:1" class="sheet-title">Edit profile</div><button class="closex" onclick="CV.closeSheet()">${I.x}</button></div>`,
    `<div class="photo-pick" onclick="CV.pickPhoto('edit')"><div class="pp-ava" style="${d.photo?`background-image:url(${esc(d.photo)});border-style:solid`:''}">${d.photo?'':I.cam}</div><div><div class="pp-t">Change photo</div><div class="pp-d">Tap to upload</div></div></div>
     <div class="grid2"><div class="field"><label class="label">First name</label><input class="inp" id="e-first" value="${esc(d.first)}"></div><div class="field"><label class="label">Last name</label><input class="inp" id="e-last" value="${esc(d.last)}"></div></div>
     <div class="field"><label class="label">Phone number</label><input class="inp" id="e-phone" type="tel" value="${esc(d.phone)}"></div>
     <div class="switch" onclick="CV.editToggleCar()"><div><div class="st">I have a car</div></div><div class="tog ${d.car?'on':''}"></div></div>
     ${d.car?`<div class="grid2"><div class="field"><label class="label">Model</label><input class="inp" id="e-model" value="${esc(d.model)}"></div><div class="field"><label class="label">Colour</label><input class="inp" id="e-color" value="${esc(d.color)}"></div></div>
     <div class="field"><label class="label">Passenger capacity</label><div class="numpick">${[1,2,3,4,5,6].map(n=>`<button class="day ${d.seats===n?'on':''}" onclick="CV.editSeats(${n})">${n}</button>`).join('')}</div></div>`:''}`,
    `<button class="btn ghost" onclick="CV.closeSheet()">Cancel</button><button class="btn primary" onclick="CV.saveProfile()">Save changes</button>`);
}
function editToggleCar(){ editDraft.car=!editDraft.car; openEditProfile(true); }
function editSeats(n){ editDraft.seats=n; openEditProfile(true); }
async function saveProfile(){
  const g=id=>$('#'+id)?.value;
  const patch={ id:store.user.id, first_name:g('e-first')||'', last_name:g('e-last')||'', phone:g('e-phone')||'',
    photo_url:editDraft.photo, has_car:editDraft.car,
    vehicle_model:editDraft.car?(g('e-model')||''):null, vehicle_color:editDraft.car?(g('e-color')||''):null, vehicle_seats:editDraft.car?editDraft.seats:null };
  try{ await api.upsertProfile(patch); store.profile={...store.profile,...patch}; closeSheet();
    setTimeout(()=>{ toast('Profile saved'); render(); renderTopbar(); },220);
  }catch(e){ toast('Could not save profile'); }
}
function pickPhoto(target){
  const inp=$('#filepick'); inp.value='';
  inp.onchange=async()=>{ const f=inp.files[0]; if(!f) return;
    toast('Uploading photo…');
    try{
      const url=await api.uploadAvatar(store.user.id, f);
      if(target==='edit'){ editDraft.photo=url; openEditProfile(true); }
      else { await api.upsertProfile({id:store.user.id, photo_url:url}); store.profile.photo_url=url; render(); toast('Photo updated'); }
    }catch(e){ toast('Upload failed'); }
  };
  inp.click();
}
function confirmLogout(){
  showSheet(`<div class="sheet-head"><div style="flex:1" class="sheet-title">Log out?</div><button class="closex" onclick="CV.closeSheet()">${I.x}</button></div>`,
    `<div class="banner">${I.info}<div>You'll need to sign in again to see your groups and rides.</div></div>`,
    `<button class="btn ghost" onclick="CV.closeSheet()">Stay</button><button class="btn danger" onclick="CV.doLogout()">Log out</button>`);
}
async function doLogout(){ closeSheet(); await api.signOut(); location.reload(); }

/* ===================== NOTIFICATIONS ===================== */
function notifIcon(kind){ return kind==='ride_change'?I.clock:kind==='booking_left'?I.users:kind==='booking_joined'?I.users:I.bell; }
function notifTone(kind){ return kind==='ride_change'?'taxi':kind==='booking_joined'?'accent':'good'; }
function viewNotif(){
  const ns=store.notifications;
  const tone=t=>({accent:['var(--accent-weak)','var(--accent-ink)'],taxi:['var(--taxi-weak)','var(--taxi)'],good:['var(--good-weak)','var(--good)']}[t]||['var(--surface-2)','var(--ink-2)']);
  if(!ns.length) return `<div class="wrap"><div class="empty"><div class="ei">${I.bell}</div><div class="et">You're all caught up</div><div class="ed">Ride updates and reminders show up here.</div></div></div>`;
  return `<div class="wrap">${ns.map(n=>{ const [bg,fg]=tone(notifTone(n.kind)); const when=new Date(n.created_at).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    return `<div class="notif ${n.read?'':'unread'}"><div class="nic" style="background:${bg};color:${fg}">${notifIcon(n.kind)}</div><div style="flex:1"><div class="ntt"><b>${esc(n.title)}</b>${n.body?'<br>'+esc(n.body):''}</div><div class="ntime">${when}</div></div></div>`;
  }).join('')}</div>`;
}
async function markAllRead(){ await api.markAllRead(); store.notifications.forEach(n=>n.read=true); renderTopbar(); render(); toast('All caught up'); }

/* ===================== GROUPS ===================== */
async function enterGroup(id){ store.currentGroup=id; await loadRides(); go('group'); }
function openGroupSwitcher(){
  showSheet(`<div class="sheet-head"><div style="flex:1" class="sheet-title">Your groups</div><button class="closex" onclick="CV.closeSheet()">${I.x}</button></div>`,
    `${store.groups.map(g=>`<div class="listrow tap" onclick="CV.switchGroup('${g.id}')" style="${g.id===store.currentGroup?'border-color:var(--accent)':''}"><span class="lri" style="font-size:20px">🎓</span><div><div class="lrt">${esc(g.name)}</div><div class="prof-sub">${g.members||0} members · code ${esc(g.invite_code)}</div></div><span class="lrv">${g.id===store.currentGroup?'<span style="color:var(--accent)">'+I.check+'</span>':I.chev}</span></div>`).join('')||'<div class="sr">No groups yet</div>'}
     <div class="divider"></div>
     <div class="field"><label class="label">Join with an invite code</label><div style="display:flex;gap:9px"><input class="inp" id="gc" placeholder="e.g. MIM27" style="text-transform:uppercase"><button class="btn primary" style="width:auto;padding:0 18px" onclick="CV.tryJoinGroup()">Join</button></div></div>
     <button class="btn ghost" onclick="CV.openCreateGroup()">${I.add} Create a new group</button>`,'');
}
async function switchGroup(id){ store.currentGroup=id; closeSheet(); await loadRides(); store.tab='group'; renderTopbar(); renderNav(); render(); }
async function tryJoinGroup(){
  const c=($('#gc').value||'').toUpperCase().trim();
  if(!c){ toast('Enter a code'); return; }
  try{ const g=await api.joinGroup(c); await loadGroups(); store.currentGroup=g.id; closeSheet();
    setTimeout(async()=>{ toast('Joined '+g.name); await loadRides(); store.tab='group'; renderTopbar(); renderNav(); render(); },200);
  }catch(e){ closeSheet(); setTimeout(()=>toast(String(e.message||'').includes('INVALID')?'That invite code isn’t valid':'Could not join group'),200); }
}
let cgDraft=null;
function openCreateGroup(){
  cgDraft={name:'',desc:'',dest:null};
  showSheet(`<div class="sheet-head"><div style="flex:1" class="sheet-title">Create a group</div><button class="closex" onclick="CV.closeSheet()">${I.x}</button></div>`,
    `<div class="field"><label class="label">Group name</label><input class="inp" id="cg-name" placeholder="e.g. IESE MiM · Class of 2027"></div>
     <div class="field"><label class="label">Description <span class="mut">· optional</span></label><input class="inp" id="cg-desc" placeholder="Short description"></div>
     <div class="field ac-wrap"><label class="label">Default destination</label><input class="inp" id="cg-dest" placeholder="Search your campus…" oninput="CV.acSearchG(this.value)" autocomplete="off"><div id="ac-cg"></div>
       <div class="mut" style="font-size:12px;margin-top:7px;display:flex;gap:7px;align-items:flex-start">${I.info}<span>Rides in this group default to this destination. You'll get a shareable invite code.</span></div></div>`,
    `<button class="btn primary" id="cgbtn" onclick="CV.doCreateGroup()">Create group</button>`);
}
function acSearchG(q){
  const box=$('#ac-cg'); if(!box) return; if(!q){box.innerHTML='';return;}
  clearTimeout(acTimer); acTimer=setTimeout(async()=>{
    const res=await geocode(q, store.myLoc); window._acg=res;
    box.innerHTML=res.length?`<div class="ac-list">${res.map((s,i)=>`<div class="ac-item" onclick="CV.pickAddrG(${i})"><span class="aci">${I.pin}</span><div><div class="acn">${esc(s.name)}</div><div class="acd">${esc(s.detail||'')}</div></div></div>`).join('')}</div>`:'';
  },250);
}
function pickAddrG(i){ const s=(window._acg||[])[i]; if(!s)return; cgDraft.dest=s; $('#cg-dest').value=s.name; $('#ac-cg').innerHTML=''; }
async function doCreateGroup(){
  const name=$('#cg-name').value.trim(); cgDraft.desc=$('#cg-desc').value.trim();
  if(!name){ toast('Name your group'); return; }
  const btn=$('#cgbtn'); if(btn){btn.disabled=true;btn.textContent='Creating…';}
  try{
    // If they typed a destination but didn't tap a suggestion, resolve it now.
    if(!cgDraft.dest){
      const q=($('#cg-dest')?.value||'').trim();
      if(q){ const res=await geocode(q, store.myLoc); if(res.length) cgDraft.dest=res[0]; }
    }
    if(!cgDraft.dest){ if(btn){btn.disabled=false;btn.textContent='Create group';} toast('Type a destination and pick a suggestion'); return; }
    const g=await api.createGroup({name, description:cgDraft.desc, dest:cgDraft.dest});
    await loadGroups(); store.currentGroup=g.id; closeSheet();
    setTimeout(async()=>{ toast('Group created · code '+g.invite_code); await loadRides(); store.tab='group'; renderTopbar(); renderNav(); render(); },220);
  }catch(e){ if(btn){btn.disabled=false;btn.textContent='Create group';} toast('Could not create group: '+(e.message||e.code||'error')); }
}

/* ===================== TIME FILTER / THEME ===================== */
function openTimeFilter(){
  const times=[]; for(let h=5;h<=23;h++) for(const m of ['00','30']) times.push((h<10?'0':'')+h+':'+m);
  const opt=sel=>times.map(t=>`<option ${t===sel?'selected':''}>${t}</option>`).join('');
  showSheet(`<div class="sheet-head"><div style="flex:1" class="sheet-title">Departure time</div><button class="closex" onclick="CV.closeSheet()">${I.x}</button></div>`,
    `<div class="banner accent">${I.clock}<div>Show rides leaving in this window — the "who's leaving around 8?" filter.</div></div>
     <div style="display:flex;gap:12px;align-items:center"><div class="field" style="flex:1"><label class="label">From</label><select class="inp tnum" id="tf">${opt(store.timeFrom)}</select></div><div style="padding-top:18px;color:var(--ink-3)">→</div><div class="field" style="flex:1"><label class="label">To</label><select class="inp tnum" id="tt">${opt(store.timeTo)}</select></div></div>
     <div style="display:flex;gap:8px;flex-wrap:wrap">${[['07:00','08:00','Early'],['07:30','08:30','~8am'],['08:00','09:00','~8:30'],['17:30','19:30','Evening']].map(([a,b,l])=>`<button class="fpill" onclick="CV.quickTime('${a}','${b}')">${l}</button>`).join('')}</div>`,
    `<button class="btn primary" onclick="CV.applyTimeFilter()">Apply</button>`);
}
function quickTime(a,b){ $('#tf').value=a; $('#tt').value=b; }
function applyTimeFilter(){ store.timeFrom=$('#tf').value; store.timeTo=$('#tt').value; closeSheet(); refreshGroup(); }
function toggleTheme(){
  store.theme=store.theme==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',store.theme);
  try{ localStorage.setItem('cv_theme',store.theme); }catch(e){}
  renderTopbar();
  if(store.tab==='group'&&store.groupView==='map'&&map){ map.setStyle(mapStyle()); map.once('styledata',()=>drawMarkers()); }
  else render();
}

/* ===================== EXPORT HANDLERS ===================== */
export const CV = {
  go, toggleTheme, openRide, openJoin, setJoin, setJoinDate, doJoin, leaveRide,
  confirmCancelRide, doCancel, openCreate, openEdit, cd, cdRaw, toggleDay, acSearch, pickAddr, publishRide,
  setView, toggleAvail, cycleType, openTimeFilter, quickTime, applyTimeFilter, widenTime, toggleLoc,
  openGroupSwitcher, switchGroup, tryJoinGroup, enterGroup, openCreateGroup, doCreateGroup, acSearchG, pickAddrG,
  markAllRead, openEditProfile, saveProfile, pickPhoto, editToggleCar, editSeats, confirmLogout, doLogout,
  startWaGroup, openMaps, closeSheet,
};
