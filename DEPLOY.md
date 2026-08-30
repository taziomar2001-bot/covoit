# Shipping CoVoit — step by step

You'll go from this folder to a live URL you can share with your cohort. Budget ~20 minutes.
You need your **Supabase**, **GitHub**, and **Netlify** accounts. No other accounts required.

---

## 1 · Set up the database (Supabase) — ~5 min

1. Go to https://supabase.com → **New project**. Pick a name (e.g. `covoit`), a strong database password, and the region closest to you (e.g. *EU West*). Wait ~2 min for it to provision.
2. In the project, open **SQL Editor** → **New query**.
3. Open `supabase/schema.sql` from this repo, copy the **entire** file, paste it in, and click **Run**. You should see "Success".
   - This creates every table, all the security rules, the atomic seat-claim function, and the notification triggers.
4. Open **Project Settings → API** and copy two values:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long token — safe to expose in the browser)
5. Open **Authentication → Providers → Email** and make sure **Email** is enabled.
   - *Optional but recommended for a smoother demo:* under **Authentication → Providers → Email**, you can turn **"Confirm email"** off so people can log in immediately after signing up. Leave it **on** for stricter security (users must click a link in their email first).

---

## 2 · Put the code on GitHub — ~5 min

From this folder, in a terminal:

```bash
git init
git add .
git commit -m "CoVoit MVP"
git branch -M main
# create an empty repo on github.com first (no README), then:
git remote add origin https://github.com/YOUR-USERNAME/covoit.git
git push -u origin main
```

> `.gitignore` already excludes `node_modules`, `dist`, and any `.env` files, so no secrets get committed.

---

## 3 · Deploy on Netlify — ~5 min

1. Go to https://app.netlify.com → **Add new site → Import an existing project → GitHub** → pick your `covoit` repo.
2. Netlify auto-detects the settings from `netlify.toml` (build command `npm run build`, publish dir `dist`). Leave them as-is.
3. Before the first deploy, open **Site configuration → Environment variables** and add:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL from step 1 |
   | `VITE_SUPABASE_ANON_KEY` | your anon public key from step 1 |
   | `VITE_MAPTILER_KEY` | *(leave empty — keyless maps)* |

4. Click **Deploy**. In ~1 minute you get a URL like `https://covoit-xyz.netlify.app`.
   - *(Optional)* Rename it under **Site configuration → Change site name**, or add a custom domain later.

---

## 4 · Point Supabase auth at your live URL — ~2 min

So confirmation / reset emails link back to your app:

1. Supabase → **Authentication → URL Configuration**.
2. Set **Site URL** to your Netlify URL (`https://covoit-xyz.netlify.app`).
3. Add the same URL under **Redirect URLs**. Save.

---

## 5 · Create the first group & invite your cohort — ~2 min

1. Open your live URL, **Create an account** (your details + phone).
2. Go to **Map** (or Profile) → **Join or create a group** → **Create a new group**.
   - Name it (e.g. *IESE MiM · Class of 2027*), search your campus as the default destination.
3. You'll get a 5-character **invite code**. Share it (or the app URL) in your class WhatsApp.
   - New members enter that code during sign-up or from **Join or create a group** — and instantly see everyone's rides.

That's it — you're live. 🎉

---

## Local development (optional)

```bash
cp .env.example .env.local     # then fill in your Supabase URL + anon key
npm install
npm run dev                    # http://localhost:5173
```

## Later, if you want sharper address search
Create a free https://maptiler.com account, copy the API key, and set `VITE_MAPTILER_KEY`
in Netlify (and `.env.local`). Redeploy. No code change needed — the app switches automatically.

## Adding browser push notifications later
The schema already has a `push_subscriptions` table and all notifications flow through one
`notifications` table + Realtime (live in-app already). To add Web Push, register a push
subscription on the client and send from a Supabase Edge Function on new notification rows.
Nothing else needs to change.
