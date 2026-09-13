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
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
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
    .from('group_members').select('group:groups(*)')
    .order('joined_at', { ascending: true });
  if (error) throw error;
  const seen = new Set();
  return (data || []).map(r => r.group).filter(g => g && !seen.has(g.id) && seen.add(g.id));
}
export async function groupMembers(groupId) {
  const { data, error } = await supabase.rpc('group_directory', { p_group_id: groupId });
  if (error) throw error;
  return data || [];
}
export async function deleteAccount() {
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;
  await supabase.auth.signOut();
}
export async function groupMemberCount(groupId) {
  const { count } = await supabase.from('group_members').select('*', { count: 'exact', head: true }).eq('group_id', groupId);
  return count || 0;
}
export async function updateGroup(id, patch) {
  const { error } = await supabase.from('groups').update(patch).eq('id', id);
  if (error) throw error;
}
export async function deleteGroup(id) {
  const { error } = await supabase.from('groups').delete().eq('id', id);
  if (error) throw error;
}
export async function joinGroup(code) {
  const { data, error } = await supabase.rpc('join_group', { p_code: code });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
export async function createGroup({ name, description, dest }) {
  const session = await getSession();
  const id = (crypto.randomUUID && crypto.randomUUID()) ||
             ('10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
               (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  const code = Math.random().toString(36).slice(2, 7).toUpperCase();
  // Generate the id client-side so we don't need to read the row back (RLS blocks
  // reading a group before the creator's membership row exists).
  const row = {
    id, name, description, invite_code: code, created_by: session.user.id,
    dest_name: dest.name, dest_addr: dest.detail || '', dest_lat: dest.lat, dest_lng: dest.lng,
  };
  const { error } = await supabase.from('groups').insert(row);
  if (error) throw error;
  const { error: e2 } = await supabase.from('group_members').insert({ group_id: id, user_id: session.user.id, role: 'admin' });
  if (e2) throw e2;
  return row;
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
export async function cancelOccurrence(rideId, serviceDate, direction) {
  const { error } = await supabase.rpc('cancel_occurrence', { p_ride_id: rideId, p_service_date: serviceDate, p_direction: direction });
  if (error) throw error;
}
export async function editOccurrence(rideId, serviceDate, departTime, returnTime) {
  const { error } = await supabase.rpc('edit_occurrence', { p_ride_id: rideId, p_service_date: serviceDate, p_depart_time: departTime, p_return_time: returnTime });
  if (error) throw error;
}
export async function skipMyBooking(rideId, serviceDate, direction) {
  const { error } = await supabase.rpc('skip_my_booking', { p_ride_id: rideId, p_service_date: serviceDate, p_direction: direction });
  if (error) throw error;
}
export async function rideExceptions(rideIds) {
  if (!rideIds.length) return [];
  const { data, error } = await supabase.from('ride_exceptions').select('*').in('ride_id', rideIds);
  if (error) throw error;
  return data || [];
}
export async function myBookingSkips(uid) {
  const { data, error } = await supabase.from('booking_skips').select('*').eq('passenger_id', uid);
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
