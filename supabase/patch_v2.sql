-- ============================================================================
-- CoVoit schema patch v2 — per-date cancellations, passenger seat-skips,
-- recurring end dates, per-occurrence time edits. Paste into Supabase SQL editor.
-- Safe to re-run.
-- ============================================================================

alter table public.rides add column if not exists end_date date;
alter table public.ride_exceptions add column if not exists out_cancelled boolean not null default false;
alter table public.ride_exceptions add column if not exists ret_cancelled boolean not null default false;
alter table public.ride_exceptions add column if not exists return_time text;

-- passenger cancels their seat for a single date/direction of a recurring booking
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

-- Atomic seat claim, now honouring per-date cancellations + passenger skips.
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
  from bookings
  where ride_id = p_ride_id and status = 'confirmed'
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

-- Driver cancels one occurrence (outbound|return|both) -> cancels it for everyone.
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

-- Driver changes the time of a single occurrence.
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

-- Passenger cancels their own seat for one date/direction (frees the seat).
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
grant execute on function public.join_ride(uuid,date,text) to anon, authenticated;
grant execute on function public.cancel_occurrence(uuid,date,text) to authenticated;
grant execute on function public.edit_occurrence(uuid,date,text,text) to authenticated;
grant execute on function public.skip_my_booking(uuid,date,text) to authenticated;
