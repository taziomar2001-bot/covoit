import * as api from './api.js';
import { getSession } from './api.js';

export const store = {
  session: null, user: null, profile: null,
  groups: [], currentGroup: null,
  rides: [], notifications: [],
  myLoc: null,                 // {lat,lng} once geolocation granted
  theme: 'light',
  // group screen ui state
  groupView: 'map', filterAvail: true, filterType: 'all', timeFrom: '06:00', timeTo: '10:00',
  tab: 'home',
};

export async function refreshSession() {
  store.session = await getSession();
  store.user = store.session?.user || null;
  return store.user;
}

export async function loadProfile() {
  if (!store.user) return null;
  store.profile = await api.getProfile(store.user.id);
  return store.profile;
}

export async function loadGroups() {
  store.groups = await api.myGroups();
  // attach member counts
  await Promise.all(store.groups.map(async g => { g.members = await api.groupMemberCount(g.id); }));
  if (!store.currentGroup || !store.groups.find(g => g.id === store.currentGroup)) {
    store.currentGroup = store.groups[0]?.id || null;
  }
  return store.groups;
}

export function currentGroupObj() { return store.groups.find(g => g.id === store.currentGroup) || null; }

export function decorate(rides, bookings, uid) {
  rides.forEach(r => {
    const bk = bookings.filter(b => b.ride_id === r.id);
    r._usedOut = bk.filter(b => b.direction === 'outbound' || b.direction === 'both').length;
    r._usedRet = bk.filter(b => b.direction === 'return' || b.direction === 'both').length;
    const mine = bk.find(b => b.passenger_id === uid);
    r._joinedByMe = mine ? dirLabel(mine.direction) : null;
    r._participants = bk.filter(b => b.passenger_id !== uid)
      .map(b => ({ name: b.passenger_name, photo: b.passenger_photo, direction: b.direction }));
    r._mine = r.creator_id === uid;
    r._seatsLeft = Math.max(0, r.seats_total - r._usedOut);
  });
  return rides;
}

export async function loadRides() {
  if (!store.currentGroup) { store.rides = []; return []; }
  const rides = await api.ridesForGroup(store.currentGroup);
  const bookings = await api.bookingsForRides(rides.map(r => r.id));
  store.rides = decorate(rides, bookings, store.user.id);
  return store.rides;
}

// Rides across ALL of the user's groups where they drive or are booked.
export async function loadMyRides() {
  const uid = store.user.id;
  const created = await api.myCreatedRides(uid);
  const bookedRides = await api.myBookedRides(uid);
  const byId = {};
  [...created, ...bookedRides].forEach(r => { byId[r.id] = r; });
  const list = Object.values(byId);
  const bookings = await api.bookingsForRides(list.map(r => r.id));
  return decorate(list, bookings, uid);
}

export async function loadNotifications() {
  store.notifications = await api.myNotifications();
  return store.notifications;
}

export function dirLabel(d){ return d==='both'?'Outbound + return':d==='return'?'Return':'Outbound'; }

export async function loadAll() {
  await refreshSession();
  if (!store.user) return false;
  await loadProfile();
  await loadGroups();
  await Promise.all([loadRides(), loadNotifications()]);
  return true;
}

export function requestLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => { store.myLoc = { lat: p.coords.latitude, lng: p.coords.longitude }; resolve(store.myLoc); },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });
}
