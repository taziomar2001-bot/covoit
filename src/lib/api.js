import { supabase } from './supabase.js';

// ---------- AUTH ----------
export async function signUp({ email, password, first, last, phone }) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { first_name: first, last_name: last, phone } },
  });
  if (error) throw error;
  return data;
}
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  if (error) throw error;
}
export async function signOut() { await supabase.auth.signOut(); }
export async function getSession() { return (await supabase.auth.getSession()).data.session; }

// ---------- PROFILE ----------
export async function getProfile(id) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
export async function upsertProfile(p) {
  const { error } = await supabase.from('profiles').upsert(p);
  if (error) throw error;
}
export async function uploadAvatar(userId, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
  if (error) throw error;
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

// ---------- GROUPS ----------
export async function myGroups() {
  const { data, error } = await supabase
    .from('group_members').select('group:groups(*), members:groups(id)')
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(r => r.group).filter(Boolean);
}
export async function groupMemberCount(groupId) {
  const { count } = await supabase.from('group_members').select('*', { count: 'exact', head: true }).eq('group_id', groupId);
  return count || 0;
}
export async function joinGroup(code) {
  const { data, error } = await supabase.rpc('join_group', { p_code: code });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
export async function createGroup({ name, description, dest }) {
  const session = await getSession();
  const code = Math.random().toString(36).slice(2, 7).toUpperCase();
  const { data, error } = await supabase.from('groups').insert({
    name, description, invite_code: code, created_by: session.user.id,
    dest_name: dest.name, dest_addr: dest.detail || '', dest_lat: dest.lat, dest_lng: dest.lng,
  }).select().single();
  if (error) throw error;
  await supabase.from('group_members').insert({ group_id: data.id, user_id: session.user.id, role: 'admin' });
  return data;
}

// ---------- RIDES ----------
export async function ridesForGroup(groupId) {
  const { data, error } = await supabase.from('rides').select('*')
    .eq('group_id', groupId).eq('status', 'active').order('depart_time');
  if (error) throw error;
  return data || [];
}
export async function bookingsForRides(rideIds) {
  if (!rideIds.length) return [];
  const { data, error } = await supabase.from('bookings').select('*')
    .in('ride_id', rideIds).eq('status', 'confirmed');
  if (error) throw error;
  return data || [];
}
export async function myCreatedRides(uid) {
  const { data, error } = await supabase.from('rides').select('*')
    .eq('creator_id', uid).eq('status', 'active');
  if (error) throw error;
  return data || [];
}
export async function myBookedRides(uid) {
  const { data: bks, error } = await supabase.from('bookings').select('ride_id')
    .eq('passenger_id', uid).eq('status', 'confirmed');
  if (error) throw error;
  const ids = [...new Set((bks || []).map(b => b.ride_id))];
  if (!ids.length) return [];
  const { data, error: e2 } = await supabase.from('rides').select('*').in('id', ids).eq('status', 'active');
  if (e2) throw e2;
  return data || [];
}
export async function createRide(ride) {
  const { data, error } = await supabase.from('rides').insert(ride).select().single();
  if (error) throw error;
  return data;
}
export async function updateRide(id, patch) {
  const { error } = await supabase.from('rides').update(patch).eq('id', id);
  if (error) throw error;
}
export async function cancelRide(id) {
  const { error } = await supabase.from('rides').update({ status: 'cancelled' }).eq('id', id);
  if (error) throw error;
}

// ---------- BOOKINGS ----------
export async function joinRide(rideId, serviceDate, direction) {
  const { data, error } = await supabase.rpc('join_ride', {
    p_ride_id: rideId, p_service_date: serviceDate, p_direction: direction,
  });
  if (error) throw error;
  return data;
}
export async function leaveRide(rideId) {
  const session = await getSession();
  const { error } = await supabase.from('bookings').delete()
    .eq('ride_id', rideId).eq('passenger_id', session.user.id).eq('status', 'confirmed');
  if (error) throw error;
}
export async function rideContacts(rideId) {
  const { data, error } = await supabase.rpc('ride_contacts', { p_ride_id: rideId });
  if (error) throw error;
  return data || [];
}

// ---------- NOTIFICATIONS ----------
export async function myNotifications() {
  const { data, error } = await supabase.from('notifications').select('*')
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}
export async function markAllRead() {
  const session = await getSession();
  await supabase.from('notifications').update({ read: true }).eq('user_id', session.user.id).eq('read', false);
}
