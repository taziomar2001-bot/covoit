# CoVoit

A private carpooling & shared-commute app for a closed university cohort. Members see who's
driving to campus, from where, at what time, and whether seats are free — and join in seconds.

**Stack:** Vite (vanilla JS SPA · tiny bundle, lazy-loaded map) · Supabase (Postgres, Auth,
Row-Level Security, Realtime, Storage) · MapLibre GL + OpenFreeMap tiles (keyless) · Photon/OSM
geocoding (keyless, optional MapTiler) · deploys as static files on Netlify. PWA-installable.

## What it does
- Email/password accounts with a profile (name, phone, photo, vehicle).
- Private **groups** joined by invite code; each group has a default destination (the campus).
- Create **driver rides** or **shared-taxi** proposals — one-time or recurring (weekdays), with an
  optional return trip. Destination is pre-filled to the group's campus but editable (return trips,
  excursions, any place).
- **Map** and **List** views; list sorts by distance from your location. Filter by availability,
  type, and departure-time window.
- **Join** a ride choosing outbound / return / both, and the recurring series or a single date.
  Seat claims are **atomic** (no double-booked last seat).
- After joining, participants see each other's **phone numbers** and can WhatsApp/call individually
  or start a WhatsApp group. Phones are never visible to the wider group.
- Edit / cancel your rides; affected passengers are notified.
- In-app **notifications** (live via Realtime): joins, leaves, time/pickup changes, cancellations.

## Security model
- Supabase Auth (passwords hashed by Supabase; we never store them).
- **Row-Level Security on every table** enforces access in the database, not just the UI:
  members only see their groups' rides; you only edit rides you created and bookings you own.
- **Phone privacy** is enforced server-side: card/list display uses denormalised names only; phone
  numbers are returned exclusively by the `ride_contacts()` function, and only to confirmed
  participants of that ride.
- The only key shipped to the browser is the Supabase **anon** key (safe by design — RLS is the
  real gate). The `service_role` key is never used in the frontend.

## Structure
```
supabase/schema.sql   tables, RLS policies, RPCs (join_group, join_ride, ride_contacts), triggers
src/lib/              supabase client, api (DB calls), store (state), geocode, util, icons
src/app.js            all app screens + handlers (exposed as window.CV for inline events)
src/auth.js           login / sign-up screens (window.AV)
src/main.js           boot, auth state, realtime, service worker
public/               manifest, icons, service worker
```

See **DEPLOY.md** to ship it. Local dev: copy `.env.example` → `.env.local`, `npm install`, `npm run dev`.
