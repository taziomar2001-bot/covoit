-- ============================================================================
-- CoVoit — database schema, Row-Level Security, functions & triggers
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Safe to re-run: it drops and recreates policies/functions.
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------

-- One row per user, keyed to Supabase Auth. Phone lives here and is protected.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  first_name    text not null default '',
  last_name     text not null default '',
  phone         text not null default '',
  photo_url     text,
  has_car       boolean not null default false,
  vehicle_model text,
  vehicle_color text,
  vehicle_seats int  default 4,
  created_at    timestamptz not null default now()
);

create table if not exists public.groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  dest_name    text not null,
  dest_addr    text,
  dest_lat     double precision not null,
  dest_lng     double precision not null,
  invite_code  text not null unique,
  created_by   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member' check (role in ('member','admin')),
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- A ride = the template. Recurring rides use weekdays[]; one-time rides use ride_date.
-- Display fields (creator_name/photo) are denormalised snapshots so cards never
-- need to read the profiles table (which keeps phone numbers private).
create table if not exists public.rides (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups(id) on delete cascade,
  creator_id     uuid not null references public.profiles(id) on delete cascade,
  creator_name   text not null default '',
  creator_photo  text,
  type           text not null check (type in ('driver','taxi')),
  pickup_name    text not null,
  pickup_addr    text,
  pickup_lat     double precision not null,
  pickup_lng     double precision not null,
  dest_name      text not null,
  dest_addr      text,
  dest_lat       double precision not null,
  dest_lng       double precision not null,
  depart_time    text not null,                 -- 'HH:MM'
  seats_total    int  not null check (seats_total between 1 and 8),
  frequency      text not null check (frequency in ('onetime','recurring')),
  weekdays       int[] not null default '{}',   -- 0=Sun .. 6=Sat
  ride_date      date,                          -- for one-time rides
  has_return     boolean not null default false,
  return_time    text,
  fuel_share     boolean not null default false,
  notes          text,
  status         text not null default 'active' check (status in ('active','cancelled')),
  created_at     timestamptz not null default now()
);
create index if not exists rides_group_idx  on public.rides(group_id);
create index if not exists rides_status_idx on public.rides(status);

-- Per-date edits/cancellations of a recurring ride ("just this Monday").
create table if not exists public.ride_exceptions (
  ride_id       uuid not null references public.rides(id) on delete cascade,
  service_date  date not null,
  cancelled     boolean not null default false,
  depart_time   text,                            -- overrides ride.depart_time for this date
  primary key (ride_id, service_date)
);

-- A booking. service_date NULL = the whole recurring series (a standing seat).
-- service_date set = one specific day. direction handles outbound/return/both.
create table if not exists public.bookings (
  id             uuid primary key default gen_random_uuid(),
  ride_id        uuid not null references public.rides(id) on delete cascade,
  passenger_id   uuid not null references public.profiles(id) on delete cascade,
  passenger_name text not null default '',
  passenger_photo text,
  service_date   date,
  direction      text not null check (direction in ('outbound','return','both')),
  status         text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_at     timestamptz not null default now()
);
-- one active booking per passenger per ride per date-slot
create unique index if not exists bookings_unique
  on public.bookings(ride_id, passenger_id, coalesce(service_date, '0001-01-01'::date))
  where status = 'confirmed';
create index if not exists bookings_ride_idx on public.bookings(ride_id);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  ride_id     uuid references public.rides(id) on delete set null,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- HELPER FUNCTIONS (SECURITY DEFINER to avoid RLS recursion)
-- ---------------------------------------------------------------------------

create or replace function public.is_group_member(gid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid());
$$;

create or replace function public.ride_group(rid uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select group_id from rides where id = rid;
$$;

-- ---------------------------------------------------------------------------
-- ENABLE RLS
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.rides          enable row level security;
alter table public.ride_exceptions enable row level security;
alter table public.bookings       enable row level security;
alter table public.notifications  enable row level security;

-- profiles: a user reads/writes ONLY their own row (phone stays private).
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select using (id = auth.uid());
drop policy if exists profiles_self_upsert on public.profiles;
create policy profiles_self_upsert on public.profiles for insert with check (id = auth.uid());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update using (id = auth.uid());

-- groups: members can read; creator can update; anyone signed-in can create.
drop policy if exists groups_member_select on public.groups;
create policy groups_member_select on public.groups for select using (public.is_group_member(id));
drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert with check (created_by = auth.uid());
drop policy if exists groups_creator_update on public.groups;
create policy groups_creator_update on public.groups for update using (created_by = auth.uid());
drop policy if exists groups_creator_delete on public.groups;
create policy groups_creator_delete on public.groups for delete using (created_by = auth.uid());

-- group_members: you can see the membership rows of groups you belong to; you can
-- add yourself (join is normally done via join_group RPC); you can remove yourself.
drop policy if exists gm_select on public.group_members;
create policy gm_select on public.group_members for select using (public.is_group_member(group_id));
drop policy if exists gm_self_insert on public.group_members;
create policy gm_self_insert on public.group_members for insert with check (user_id = auth.uid());
drop policy if exists gm_self_delete on public.group_members;
create policy gm_self_delete on public.group_members for delete using (user_id = auth.uid());

-- rides: group members read; creator writes.
drop policy if exists rides_select on public.rides;
create policy rides_select on public.rides for select using (public.is_group_member(group_id));
drop policy if exists rides_insert on public.rides;
create policy rides_insert on public.rides for insert with check (creator_id = auth.uid() and public.is_group_member(group_id));
drop policy if exists rides_update on public.rides;
create policy rides_update on public.rides for update using (creator_id = auth.uid());
drop policy if exists rides_delete on public.rides;
create policy rides_delete on public.rides for delete using (creator_id = auth.uid());

-- ride_exceptions: only the ride creator manages them; members can read.
drop policy if exists rex_select on public.ride_exceptions;
create policy rex_select on public.ride_exceptions for select using (public.is_group_member(public.ride_group(ride_id)));
drop policy if exists rex_write on public.ride_exceptions;
create policy rex_write on public.ride_exceptions for all
  using (exists (select 1 from rides where id = ride_id and creator_id = auth.uid()))
  with check (exists (select 1 from rides where id = ride_id and creator_id = auth.uid()));

-- bookings: group members can read (names + counts). Inserts go through join_ride
-- RPC (security definer). Passengers can cancel their own booking.
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings for select using (public.is_group_member(public.ride_group(ride_id)));
drop policy if exists bookings_self_delete on public.bookings;
create policy bookings_self_delete on public.bookings for delete using (passenger_id = auth.uid());
drop policy if exists bookings_self_update on public.bookings;
create policy bookings_self_update on public.bookings for update using (passenger_id = auth.uid());

-- notifications: you see and update only your own. Inserts happen via triggers.
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPC: create profile row automatically on signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name, last_name, phone, photo_url)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'first_name',''),
                   new.raw_user_meta_data->>'given_name',
                   split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name',''),' ',1),
                   ''),
          coalesce(nullif(new.raw_user_meta_data->>'last_name',''),
                   new.raw_user_meta_data->>'family_name',
                   ''),
          coalesce(new.raw_user_meta_data->>'phone',''),
          coalesce(new.raw_user_meta_data->>'picture', new.raw_user_meta_data->>'avatar_url'))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPC: join a group by invite code
-- ---------------------------------------------------------------------------
create or replace function public.join_group(p_code text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  select * into g from groups where upper(invite_code) = upper(trim(p_code));
  if not found then raise exception 'INVALID_CODE'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid())
    on conflict do nothing;
  return g;
end; $$;

-- ---------------------------------------------------------------------------
-- RPC: atomic seat claim  (prevents two people taking the last seat)
--   p_service_date NULL  -> join the recurring series (standing seat)
--   p_service_date set   -> join that single day
-- ---------------------------------------------------------------------------
create or replace function public.join_ride(p_ride_id uuid, p_service_date date, p_direction text)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare
  r public.rides;
  used_out int;
  used_ret int;
  me uuid := auth.uid();
  myname text;
  myphoto text;
  b public.bookings;
begin
  if p_direction not in ('outbound','return','both') then raise exception 'BAD_DIRECTION'; end if;

  select * into r from rides where id = p_ride_id for update;   -- row lock
  if not found or r.status <> 'active' then raise exception 'RIDE_UNAVAILABLE'; end if;
  if not public.is_group_member(r.group_id) then raise exception 'NOT_A_MEMBER'; end if;
  if r.creator_id = me then raise exception 'OWN_RIDE'; end if;

  -- bookings that consume capacity for this slot: standing (date null) always count;
  -- if joining a specific date, that date's bookings also count.
  select
    count(*) filter (where direction in ('outbound','both')),
    count(*) filter (where direction in ('return','both'))
  into used_out, used_ret
  from bookings
  where ride_id = p_ride_id and status = 'confirmed'
    and (service_date is null or service_date is not distinct from p_service_date);

  if p_direction in ('outbound','both') and used_out >= r.seats_total then raise exception 'FULL'; end if;
  if p_direction in ('return','both')   and used_ret >= r.seats_total then raise exception 'FULL'; end if;

  select coalesce(nullif(trim(first_name||' '||last_name),''),'A rider'), photo_url
    into myname, myphoto from profiles where id = me;

  insert into bookings (ride_id, passenger_id, passenger_name, passenger_photo, service_date, direction)
  values (p_ride_id, me, myname, myphoto, p_service_date, p_direction)
  returning * into b;
  return b;
exception when unique_violation then
  raise exception 'ALREADY_BOOKED';
end; $$;

-- ---------------------------------------------------------------------------
-- RPC: contacts for a ride (names + phones) — only for confirmed participants
-- ---------------------------------------------------------------------------
create or replace function public.ride_contacts(p_ride_id uuid)
returns table(user_id uuid, name text, phone text, photo_url text, role text)
language plpgsql security definer set search_path = public as $$
declare r public.rides; me uuid := auth.uid(); am_participant boolean;
begin
  select * into r from rides where id = p_ride_id;
  if not found then raise exception 'NO_RIDE'; end if;
  am_participant := (r.creator_id = me) or exists (
    select 1 from bookings where ride_id = p_ride_id and passenger_id = me and status='confirmed');
  if not am_participant then raise exception 'NOT_A_PARTICIPANT'; end if;

  return query
    select p.id, nullif(trim(p.first_name||' '||p.last_name),''), p.phone, p.photo_url, 'driver'::text
    from profiles p where p.id = r.creator_id
    union all
    select p.id, coalesce(nullif(trim(p.first_name||' '||p.last_name),''), bk.passenger_name), p.phone, p.photo_url, 'passenger'::text
    from bookings bk join profiles p on p.id = bk.passenger_id
    where bk.ride_id = p_ride_id and bk.status = 'confirmed';
end; $$;

-- ---------------------------------------------------------------------------
-- TRIGGERS: notifications (run as definer so they can insert for other users)
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.rides;
begin
  select * into r from rides where id = new.ride_id;
  if r.creator_id <> new.passenger_id then
    insert into notifications (user_id, kind, title, body, ride_id)
    values (r.creator_id, 'booking_joined',
            new.passenger_name || ' joined your ride',
            r.pickup_name || ' → ' || r.dest_name || ' (' || new.direction || ')', r.id);
  end if;
  return new;
end; $$;
drop trigger if exists trg_notify_booking on public.bookings;
create trigger trg_notify_booking after insert on public.bookings
  for each row when (new.status = 'confirmed') execute function public.notify_on_booking();

create or replace function public.notify_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.rides;
begin
  select * into r from rides where id = old.ride_id;
  if r.creator_id <> old.passenger_id then
    insert into notifications (user_id, kind, title, body, ride_id)
    values (r.creator_id, 'booking_left',
            old.passenger_name || ' left your ride',
            r.pickup_name || ' → ' || r.dest_name, r.id);
  end if;
  return old;
end; $$;
drop trigger if exists trg_notify_leave on public.bookings;
create trigger trg_notify_leave after delete on public.bookings
  for each row execute function public.notify_on_leave();

-- Ride changed (time/pickup/cancel) -> notify all confirmed passengers.
create or replace function public.notify_on_ride_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare title text; body text;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    title := 'Ride cancelled';
    body  := new.pickup_name || ' → ' || new.dest_name || ' was cancelled by the driver';
  elsif new.depart_time <> old.depart_time then
    title := 'Departure time changed';
    body  := new.pickup_name || ' now leaves at ' || new.depart_time;
  elsif new.pickup_name <> old.pickup_name then
    title := 'Pick-up changed';
    body  := 'Now departing from ' || new.pickup_name;
  else
    return new;
  end if;
  insert into notifications (user_id, kind, title, body, ride_id)
  select distinct b.passenger_id, 'ride_change', title, body, new.id
  from bookings b where b.ride_id = new.id and b.status = 'confirmed';
  return new;
end; $$;
drop trigger if exists trg_notify_ride_change on public.rides;
create trigger trg_notify_ride_change after update on public.rides
  for each row execute function public.notify_on_ride_change();

-- ---------------------------------------------------------------------------
-- STORAGE: public bucket for profile photos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('avatars','avatars', true)
  on conflict (id) do nothing;
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists avatars_write on storage.objects;
create policy avatars_write on storage.objects for insert
  with check (bucket_id = 'avatars' and owner = auth.uid());
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update using (bucket_id = 'avatars' and owner = auth.uid());

-- ---------------------------------------------------------------------------
-- RPC: group directory (member names + photos, NO phone) for any group member
-- ---------------------------------------------------------------------------
create or replace function public.group_directory(p_group_id uuid)
returns table(user_id uuid, name text, photo_url text, is_admin boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_member(p_group_id) then raise exception 'NOT_A_MEMBER'; end if;
  return query
    select p.id,
           coalesce(nullif(trim(p.first_name||' '||p.last_name),''),'Member'),
           p.photo_url,
           (gm.role = 'admin')
    from group_members gm join profiles p on p.id = gm.user_id
    where gm.group_id = p_group_id
    order by (gm.role = 'admin') desc, p.first_name nulls last;
end; $$;

-- ---------------------------------------------------------------------------
-- RPC: delete my account and all my data (cascades from auth.users)
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();
end; $$;

-- ---------------------------------------------------------------------------
-- GRANTS — the app's roles need table/function privileges (RLS still governs
-- which rows). Without these, writes fail with "permission denied for table".
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- Live in-app notifications via Realtime.
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when others then null; end $$;

-- ============================================================================
-- v2: per-date cancellations, passenger seat-skips, recurring end date, edits
-- ============================================================================
alter table public.rides add column if not exists start_date date;
alter table public.rides add column if not exists end_date date;
alter table public.ride_exceptions add column if not exists out_cancelled boolean not null default false;
alter table public.ride_exceptions add column if not exists ret_cancelled boolean not null default false;
alter table public.ride_exceptions add column if not exists return_time text;

create table if not exists public.booking_skips (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  service_date date not null,
  direction text not null check (direction in ('outbound','return')),
  created_at timestamptz not null default now(),
  unique(ride_id, passenger_id, service_date, direction)
);
alter table public.booking_skips enable row level security;
drop policy if exists bskip_self on public.booking_skips;
create policy bskip_self on public.booking_skips for all
  using (passenger_id = auth.uid()) with check (passenger_id = auth.uid());

create or replace function public.join_ride(p_ride_id uuid, p_service_date date, p_direction text)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare
  r public.rides; used_out int; used_ret int; me uuid := auth.uid();
  myname text; myphoto text; b public.bookings; ex_out boolean; ex_ret boolean;
begin
  if p_direction not in ('outbound','return','both') then raise exception 'BAD_DIRECTION'; end if;
  select * into r from rides where id = p_ride_id for update;
  if not found or r.status <> 'active' then raise exception 'RIDE_UNAVAILABLE'; end if;
  if not public.is_group_member(r.group_id) then raise exception 'NOT_A_MEMBER'; end if;
  if r.creator_id = me then raise exception 'OWN_RIDE'; end if;
  if p_service_date is not null then
    select out_cancelled, ret_cancelled into ex_out, ex_ret
      from ride_exceptions where ride_id = p_ride_id and service_date = p_service_date;
    if p_direction in ('outbound','both') and coalesce(ex_out,false) then raise exception 'OCC_CANCELLED'; end if;
    if p_direction in ('return','both')   and coalesce(ex_ret,false) then raise exception 'OCC_CANCELLED'; end if;
  end if;
  select
    count(*) filter (where direction in ('outbound','both')),
    count(*) filter (where direction in ('return','both'))
  into used_out, used_ret
  from bookings where ride_id = p_ride_id and status = 'confirmed'
    and (service_date is null or service_date is not distinct from p_service_date);
  if p_service_date is not null then
    used_out := used_out - (select count(*) from booking_skips where ride_id=p_ride_id and service_date=p_service_date and direction='outbound');
    used_ret := used_ret - (select count(*) from booking_skips where ride_id=p_ride_id and service_date=p_service_date and direction='return');
  end if;
  if p_direction in ('outbound','both') and used_out >= r.seats_total then raise exception 'FULL'; end if;
  if p_direction in ('return','both')   and used_ret >= r.seats_total then raise exception 'FULL'; end if;
  select coalesce(nullif(trim(first_name||' '||last_name),''),'A rider'), photo_url into myname, myphoto from profiles where id = me;
  insert into bookings (ride_id, passenger_id, passenger_name, passenger_photo, service_date, direction)
  values (p_ride_id, me, myname, myphoto, p_service_date, p_direction) returning * into b;
  return b;
exception when unique_violation then raise exception 'ALREADY_BOOKED';
end; $$;

create or replace function public.cancel_occurrence(p_ride_id uuid, p_service_date date, p_direction text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rides; body text;
begin
  select * into r from rides where id = p_ride_id;
  if not found then raise exception 'NO_RIDE'; end if;
  if r.creator_id <> auth.uid() then raise exception 'NOT_CREATOR'; end if;
  insert into ride_exceptions(ride_id, service_date, out_cancelled, ret_cancelled)
  values (p_ride_id, p_service_date, p_direction in ('outbound','both'), p_direction in ('return','both'))
  on conflict (ride_id, service_date) do update
    set out_cancelled = ride_exceptions.out_cancelled or (p_direction in ('outbound','both')),
        ret_cancelled = ride_exceptions.ret_cancelled or (p_direction in ('return','both'));
  body := r.pickup_name||' → '||r.dest_name||' on '||to_char(p_service_date,'Dy DD Mon')||' ('||p_direction||')';
  insert into notifications(user_id, kind, title, body, ride_id)
  select distinct b.passenger_id, 'ride_change', 'A ride date was cancelled', body, r.id
  from bookings b where b.ride_id = p_ride_id and b.status = 'confirmed' and b.passenger_id <> auth.uid();
end; $$;

create or replace function public.edit_occurrence(p_ride_id uuid, p_service_date date, p_depart_time text, p_return_time text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rides;
begin
  select * into r from rides where id = p_ride_id;
  if not found then raise exception 'NO_RIDE'; end if;
  if r.creator_id <> auth.uid() then raise exception 'NOT_CREATOR'; end if;
  insert into ride_exceptions(ride_id, service_date, depart_time, return_time)
  values (p_ride_id, p_service_date, p_depart_time, p_return_time)
  on conflict (ride_id, service_date) do update
    set depart_time = coalesce(excluded.depart_time, ride_exceptions.depart_time),
        return_time = coalesce(excluded.return_time, ride_exceptions.return_time);
  insert into notifications(user_id, kind, title, body, ride_id)
  select distinct b.passenger_id, 'ride_change', 'A ride time changed',
    r.pickup_name||' on '||to_char(p_service_date,'Dy DD Mon')||' now leaves '||coalesce(p_depart_time,r.depart_time), r.id
  from bookings b where b.ride_id = p_ride_id and b.status = 'confirmed' and b.passenger_id <> auth.uid();
end; $$;

create or replace function public.skip_my_booking(p_ride_id uuid, p_service_date date, p_direction text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); has_standing boolean;
begin
  update bookings set status='cancelled'
    where ride_id=p_ride_id and passenger_id=me and status='confirmed' and service_date = p_service_date;
  select exists(select 1 from bookings where ride_id=p_ride_id and passenger_id=me and status='confirmed' and service_date is null)
    into has_standing;
  if has_standing then
    insert into booking_skips(ride_id, passenger_id, service_date, direction)
    values (p_ride_id, me, p_service_date, p_direction) on conflict do nothing;
  end if;
end; $$;

grant all on public.booking_skips to anon, authenticated;
grant execute on function public.cancel_occurrence(uuid,date,text) to authenticated;
grant execute on function public.edit_occurrence(uuid,date,text,text) to authenticated;
grant execute on function public.skip_my_booking(uuid,date,text) to authenticated;

-- Done.
