<p align="center">
  <img src="public/icon-192.png" width="96" height="96" alt="CoVoit" style="border-radius:22px">
</p>

<h1 align="center">CoVoit</h1>

<p align="center">
  <b>Organise your university commute in seconds.</b><br>
  A private, mobile-first carpooling and shared-commute app for a closed university cohort.
</p>

<p align="center">
  <a href="https://covoit-uni.netlify.app/"><b>Live app: covoit-uni.netlify.app</b></a>
</p>

---

## What is CoVoit?

Getting to campus is usually organised in a chaos of WhatsApp messages: *"Who's driving tomorrow?"*, *"Anyone leaving from Moncloa around 8?"*, *"Got a spare seat?"*. CoVoit replaces that with a single, structured place where classmates can see who is going to campus, from where, at what time, and whether there's a seat, then join in a couple of taps.

It's built for a closed community (a class, a residence, a team). You join a **private group** with an invite code, and only then can you see and offer rides. It's a responsive web app that installs to your phone's home screen like a native app, with no app store required.

**Try it:** [covoit-uni.netlify.app](https://covoit-uni.netlify.app/)

## Features

**Accounts and groups**
- Email and password sign-up with a light profile: name, phone number (with country code), and an optional photo.
- **Private groups** joined by a short invite code or a shareable link (`/?join=CODE`). Each group has a default destination (typically the campus). Nothing is visible until you're in a group.
- **Group management**: the creator can edit a group's name, description and default destination, or delete the group entirely (behind a type-to-confirm safeguard). A group details view lists every member.

**Offering a ride**
- Create a **driver ride** (offer seats in your car) or a **shared-taxi** proposal (split an Uber, Cabify or Bolt).
- **One-time** or **recurring** rides. For recurring, pick the weekdays plus a start and end date for the window.
- Destination is pre-filled to the group's campus but fully editable, with a one-tap **reverse-route** swap that makes return trips and excursions effortless.
- Optional **return trip**, fuel-cost-sharing preference, seat count, and notes.

**Finding and joining a ride**
- An interactive **map** centred on the group, with pickup markers that distinguish driver from shared-taxi and show remaining seats (full rides are muted).
- A **list view** sorted by distance from your current location, with filters for availability, ride type, and a departure-time window ("who's leaving around 8?").
- **Join** choosing outbound, return or both, and either the whole recurring series or just one date. Seat claims are **atomic**, so the last seat can never be double-booked.
- Rides that are past their date or time automatically drop off the map and lists.

**Your schedule**
- **My Rides** in two forms: a chronological **Schedule** (soonest first) and a **Calendar** with a **Month** view (ride counts per day) and an Outlook-style **Day** timeline.
- **Per-date control**: a driver can cancel or re-time a single occurrence of a recurring ride (for everyone, with notifications) without touching the rest of the schedule. A passenger can drop their seat for a single date, freeing it for someone else, while staying on the ride every other day. Outbound and return are handled independently.

**Communication and privacy**
- Phone numbers are **never** visible to the wider group. Once you share a confirmed ride, participants can see each other's numbers and reach out by **WhatsApp or phone** directly.
- Joining pops a friendly prompt recommending you message the driver to confirm pickup details, with a one-tap **"Message [driver]"** WhatsApp button.
- Live **in-app notifications**: someone joined or left your ride, a time or pickup changed, or a ride was cancelled.

**Experience**
- **Mobile-first, app-like shell**: fixed top bar, scrollable content, bottom navigation, vertical scrolling only (the map is the only surface that pans and zooms), pull-down-to-dismiss sheets, and full **light and dark mode**.
- **Installable PWA** with its own icon and splash screen.
- A profile area to manage your details and photo, notification preferences, and **delete your account** (with a confirmation safeguard).

## How it's built

A deliberately simple, low-cost and maintainable stack: no framework runtime, a tiny bundle, and a single managed backend.

| Layer | Choice |
|---|---|
| **Frontend** | Vanilla JavaScript SPA bundled with **Vite**: small, fast, framework-free. MapLibre is lazy-loaded so the initial payload stays light (around 77 KB gzipped). |
| **Backend** | **Supabase**: Postgres database, Auth, Row-Level Security, Realtime, and Storage (for profile photos). No custom server to run. |
| **Maps** | **MapLibre GL** with keyless **OpenFreeMap** vector tiles (light and dark styles). |
| **Address search** | Keyless **Photon/OpenStreetMap** geocoding, with an optional **MapTiler** key for richer autocomplete, swappable via one environment variable with no code change. |
| **Hosting** | Static files on **Netlify**, auto-deployed from GitHub. |
| **App shell** | Installable **PWA** (web manifest and icons). |

### Data model

The schema (`supabase/schema.sql`) models recurring commuting robustly:

- `profiles`, `groups`, `group_members`: identity and private group membership.
- `rides`: the ride *template* (pickup, destination, time, seats, weekdays, start and end dates, return, fuel).
- `ride_exceptions`: per-date overrides on a recurring ride (a single occurrence cancelled, or re-timed).
- `bookings`: a passenger's seat, per direction, either for the whole series or a single date.
- `booking_skips`: a passenger opting out of a single date of a standing booking, which frees that seat.
- `notifications`: delivered live over Supabase Realtime.

Seat availability and joins run through a `SECURITY DEFINER` Postgres function that locks the row and re-checks capacity, so concurrent joins can't oversell a ride.

### Security model

- **Supabase Auth**: passwords are hashed by Supabase; the app never stores them.
- **Row-Level Security on every table**: access is enforced in the database, not just the UI. You only see rides in groups you belong to, and you can only edit rides you created or bookings you own.
- **Phone privacy is server-enforced**: cards and lists use denormalised display names only. Phone numbers are returned exclusively by the `ride_contacts()` function, and only to confirmed participants of that specific ride.
- The only key shipped to the browser is the Supabase **anon** key, which is safe to expose by design because RLS is the real gate. The `service_role` key is never used in the frontend.

### Project structure

```
supabase/schema.sql     tables, RLS policies, RPCs (join_ride, ride_contacts, cancel/edit occurrence, ...), triggers
supabase/patch_*.sql    incremental migrations
src/lib/                supabase client, api (DB calls), store (state), geocode, util, icons
src/app.js              all in-app screens and handlers
src/auth.js             login and sign-up screens
src/main.js             boot, auth state, realtime, PWA
public/                 web manifest and app icons
```

## Running locally

```bash
cp .env.example .env.local     # add your Supabase URL and anon key
npm install
npm run dev                    # http://localhost:5173
```

Production is a static build (`npm run build`) served on Netlify and auto-deployed from GitHub, backed by a Supabase project created from `supabase/schema.sql`.

---

<p align="center"><sub>CoVoit, your commute organised.</sub></p>
