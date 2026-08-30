import { MAPTILER_KEY } from './supabase.js';

// Address autocomplete. Uses MapTiler if a key is set, otherwise the free
// keyless Photon (OSM) geocoder. Returns [{name, detail, lat, lng}].
let ctrl;
export async function geocode(query, near) {
  const q = query.trim();
  if (q.length < 2) return [];
  if (ctrl) ctrl.abort();
  ctrl = new AbortController();
  try {
    if (MAPTILER_KEY) return await maptiler(q, near, ctrl.signal);
    return await photon(q, near, ctrl.signal);
  } catch (e) {
    if (e.name === 'AbortError') return [];
    return [];
  }
}

async function photon(q, near, signal) {
  let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`;
  if (near) url += `&lat=${near.lat}&lon=${near.lng}`;
  const r = await fetch(url, { signal });
  const j = await r.json();
  return (j.features || []).map(f => {
    const p = f.properties || {}, c = f.geometry.coordinates;
    const name = p.name || p.street || p.city || 'Location';
    const detail = [p.street && p.housenumber ? p.street+' '+p.housenumber : p.street, p.city, p.state]
      .filter(Boolean).join(', ');
    return { name, detail: detail || p.country || '', lat: c[1], lng: c[0] };
  });
}

async function maptiler(q, near, signal) {
  let url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${MAPTILER_KEY}&limit=6&language=en`;
  if (near) url += `&proximity=${near.lng},${near.lat}`;
  const r = await fetch(url, { signal });
  const j = await r.json();
  return (j.features || []).map(f => ({
    name: f.text || f.place_name,
    detail: (f.place_name || '').replace(f.text ? f.text + ', ' : '', ''),
    lat: f.center[1], lng: f.center[0],
  }));
}
