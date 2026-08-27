# CUM + BLOW — Project Handoff

Last updated: 2026-08-27

This document is the single source of truth for the CentralizedUnitManagement
(CUM) app and the BLOW messaging feature built inside it. It captures the
architecture, the database, the security model, what was built, how to run it,
and — importantly — the outstanding deployment items that are still blocking
production.

---

## 1. What this project is

CUM is a personal dashboard web app (React + Vite frontend, FastAPI backend on
Vercel serverless, Supabase Postgres + Auth). It has tabs for Dashboard,
Assignments (Tasks), Schedule (Google Calendar + shared calendars), Calories
(meals), Spotify, and **BLOW** — a 1:1 messaging feature whose entire visual
language is an HTTP transaction (methods, status codes, request bar, etc.).

BLOW was originally scoped as a separate app in the old handoff brief, but the
decision was made to build it as a **tab inside CUM**, sharing CUM's auth,
deploy, and database.

---

## 2. Stack & repo layout

```
frontend/           React 19 + Vite + react-router-dom, Supabase JS client
  src/
    lib/
      api.js         axios instance -> backend; attaches Supabase JWT (interceptor)
      supabase.js    Supabase client (publishable key)
      auth.jsx       AuthProvider / useAuth (Supabase email auth)
    components/       NavBar, Layout, ProtectedRoute
    pages/            Dashboard, Assignments, Schedule, Calories, Spotify, Login, Blow
backend/            FastAPI (Vercel Python serverless)
  main.py            mounts routers: /spotify, /calendar, /shared-calendar
  api/index.py       Vercel ASGI entrypoint (imports main.app)
  token_store.py     Supabase service_role client for OAuth token storage
  routers/
    spotify.py       Spotify integration
    calendar.py      Google Calendar (per-user, JWT-scoped)
    shared_calendar.py  Shared calendars (per-user, JWT-scoped, NOT Google)
    system.py         hardware stats (NOT mounted on serverless)
supabase/
  migrations/        version-controlled SQL (0001..0004)
```

### Supabase project
- Project ref: `tuypeumfbfaiqutjsfur` (name: CentralizedUnitforManagement, us-east-2)
- URL: `https://tuypeumfbfaiqutjsfur.supabase.co`
- Frontend uses the **publishable** key (`sb_publishable_...`) via `VITE_SUPABASE_ANON_KEY`.
- There is also a legacy JWT anon key (`eyJ...` role=anon) — either works for the anon role.
- Backend uses the **service_role / secret** key for `token_store` (OAuth tokens) and
  a **user JWT** (not service_role) for shared calendars / per-user calendar reads.

### Deployed URLs
- Frontend: `https://frontend-pranav-9815.vercel.app` (Vercel project `frontend`)
- Backend:  `https://backend-pranav-9815.vercel.app` (Vercel project `backend`)

---

## 3. Security model (READ THIS)

The **database is the security boundary**, enforced by Postgres Row-Level
Security (RLS) keyed to `auth.uid()`. The browser only ever holds the anon/
publishable key + the logged-in user's JWT — never a privileged key. This means
even hand-crafted API calls cannot bypass per-user isolation.

- **Personal data** (`Tasks`, `calendars`, `meals`, `user_settings`) is scoped
  to the owner via a `user_id` column defaulting to `auth.uid()` and an RLS
  policy `user_id = auth.uid()`.
- **BLOW** conversations/messages/reactions/receipts are visible only to the two
  participants; you can only edit/delete your OWN messages; DELETE is a
  soft-delete tombstone (struck-through, never hard-removed). Email discovery is
  an exact-match `SECURITY DEFINER` RPC (no user enumeration). Open-inbox abuse
  controls: pending "message requests" (accept/decline) + block list.
- **Shared calendars** are visible only to members; owner-only membership
  management; events are member-writable.
- **Backend** shared-calendar / calendar endpoints authenticate the caller's
  Supabase JWT and run queries AS that user (RLS applies) rather than using the
  service_role key.

### Pen-test results (2026-08-26) — all PASS
1. Unauthenticated (anon key only, no user): every protected table returns `[]`.
   Grabbing the public key via "inspect element" yields zero data.
2. Authenticated as a 3rd-party account (member of nothing): `messages=0`,
   `conversations=0`, sees only its own profile. Cannot read random messages.
3. Cross-user: user B sees only conversations they participate in; 0 of user A's
   meals/tasks/calendars.
4. Write-side injection: attacker INSERT into a foreign conversation is blocked
   by RLS (0 injected).

---

## 4. Database schema (applied to project tuypeumfbfaiqutjsfur)

Migrations live in `supabase/migrations/` and were applied via the Supabase
Management API. They are idempotent-ish; re-running is generally safe.

### 0001_blow_messaging.sql — BLOW
- `profiles(id=auth.uid, email unique, display_name, created_at)` — mirror of
  auth.users, auto-populated by trigger `on_auth_user_created`; existing users backfilled.
- `conversations(id, user_low, user_high, created_by, status pending|accepted, created_at)`
  canonical pair ordering (user_low < user_high) + unique index => one convo per pair.
- `messages(id, conversation_id, sender_id, method POST|PATCH|DELETE, body,
  created_at, edited_at, deleted_at)` — deleted_at = tombstone.
- `reactions(id, message_id, user_id, code in 200/201/404/429/500/418, unique(message,user,code))`
- `read_receipts(conversation_id, user_id, last_read_at)` PK(conversation,user)
- `blocks(blocker_id, blocked_id)` PK
- RPCs: `find_user_by_email(p_email)` (exact match, no self, no blocked),
  `start_conversation(p_other)` (canonical pairing + block check).
- Helpers (SECURITY DEFINER): `is_conversation_participant`, `is_blocked_between`.
- RLS ON for all tables; Realtime publication includes messages/reactions/
  read_receipts/conversations.

### 0002_user_isolation.sql — per-user isolation (SECURITY FIX)
Before this, `Tasks/calendars/meals/user_settings` had RLS ON but the only
policy was `auth.uid() IS NOT NULL` — i.e. every logged-in user saw EVERYONE's
data. This migration:
- adds `user_id uuid` (FK auth.users, default `auth.uid()`, NOT NULL) to each,
- backfills existing rows to the primary user `pranav.takrani@gmail.com`,
- replaces the permissive policy with owner-scoped `{table}_owner` using
  `user_id = auth.uid()`,
- adds a unique index on `user_settings.user_id` (one settings row per user).

### 0003_shared_calendars.sql — shared calendars (backend-sourced, per-color)
- `shared_calendars(id, name, color hex default #cc0000, owner_id default auth.uid(), created_at)`
- `shared_calendar_members(calendar_id, user_id, role owner|member)` PK
- `shared_calendar_events(id, calendar_id, title, location, starts_at, ends_at,
  created_by default auth.uid(), created_at)`
- Trigger `on_shared_calendar_created` auto-adds creator as owner-member.
- Helpers: `is_shared_calendar_member`, `is_shared_calendar_owner`.
- RPC: `add_shared_calendar_member(p_calendar, p_email)` (owner-only, by email).
- RLS: members can read; members can CRUD events; owner manages membership /
  deletes calendar. Realtime includes shared_calendar_events + shared_calendars.
- Also added later: `conversations_delete_participant` DELETE policy (for BLOW
  decline).

### 0004_perf_indexes.sql — performance
Indexes on the per-user columns so RLS-filtered queries don't full-scan:
- `meals(user_id, logged_at desc)`, `Tasks(user_id)`, `calendars(user_id)`.

### Users (as of handoff)
- `pranav.takrani@gmail.com` — a52d07e3-e8cc-4811-9a33-270e1e7b3517 (primary; owns backfilled data)
- `agneyat2@gmail.com` — 1d773d94-50a2-4e75-9ff4-e35b34066a9e
- `test@gmail.com` — 544bebd2-... (pre-existing)

---

## 5. Feature notes

### BLOW (frontend/src/pages/Blow.jsx, route /blow)
- HTTP-transaction UI: method-coded messages (POST green / PATCH amber / DELETE
  red tombstone), status-code reactions, composer as a request bar, delivery
  lifecycle (202 → 200 OK · Nms → read), presence (101 Switching Protocols),
  collapsible Postman-style headers panel.
- Email-based "CONNECT" to open a 1:1. First contact is a **pending request**;
  recipient sees a "PENDING REQUESTS" sidebar section with 200 Accept / 403
  Decline. Accept => status=accepted; Decline => delete conversation.
- Realtime: single debounced (250ms) reload coalesces bursts; read-receipt write
  is separated from loadThread to avoid a feedback loop.
- Mobile: `.blow-grid/.blow-sidebar/.blow-thread` classes in index.css stack the
  layout at <=720px so the message widget is reachable (sidebar capped 45dvh).

### Schedule (frontend/src/pages/Schedule.jsx)
- Personal Google calendars (backend `/calendar/upcoming`, JWT-scoped per user).
- Shared calendars via backend `/shared-calendar/*`: create with a color picker,
  invite members by email, add events; shared events render in the week grid
  colored per calendar.
- Responses are coerced to arrays (`Array.isArray(...) ? ... : []`) so a bad/
  unreachable backend cannot crash the page (it degrades to an empty calendar).

### Dashboard (frontend/src/pages/Dashboard.jsx)
- "Today" widget scales to fill the whole tile (flex rows + %-positioned events).
- user_settings read uses `.maybeSingle()` (no crash for users without a row).

### Backend routers
- `calendar.py`: `_user_calendar_ids(authorization)` builds an anon-key client +
  `postgrest.auth(token)` so it reads only the caller's calendars. `/today` and
  `/upcoming` accept the Authorization header.
- `shared_calendar.py`: `/list`, `/create`, `/{id}` (delete), `/events` (GET/POST),
  `/events/{id}` (delete), `/members` (POST). All via a per-request user-JWT
  client so RLS applies. Requires `SUPABASE_URL` + `SUPABASE_ANON_KEY` env.
- `frontend/src/lib/api.js`: axios request interceptor attaches
  `Authorization: Bearer <supabase access_token>` to every backend call.

---

## 6. Environment variables

### frontend project (Vercel) — build-time, inlined by Vite (redeploy to apply)
- `VITE_API_URL` = `https://backend-pranav-9815.vercel.app`   <-- REQUIRED, see Outstanding
- `VITE_SUPABASE_URL` = `https://tuypeumfbfaiqutjsfur.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = `sb_publishable_a8mJLf3I_CC0d0cN1o9Y5w_UCmwkv75`

### backend project (Vercel) — runtime (os.getenv)
- `SUPABASE_URL` = `https://tuypeumfbfaiqutjsfur.supabase.co`
- `SUPABASE_ANON_KEY` = legacy anon JWT (role=anon)  <-- REQUIRED for shared calendars
- `SUPABASE_SERVICE_ROLE_KEY` = secret key (used by token_store; keep SENSITIVE)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (calendar), Spotify creds.

Notes:
- Use the Vercel **Environment Variables UI**, not vercel.json (keeps keys out of git).
- `VITE_*` values are public (inlined into the client bundle) — plaintext is fine.
- The anon key is safe to expose in a browser; the service_role/secret key is NOT.
- `backend/.env` and `frontend/.env` are gitignored (`.env*`); local dev only.

---

## 7. Run locally

Backend:
```
cd backend
python -m venv ../.venv ; ../.venv/Scripts/activate   (Windows)
pip install -r requirements.txt
# set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_*, SPOTIFY_* in backend/.env
uvicorn main:app --reload --port 8000
```

Frontend:
```
cd frontend
npm install
# frontend/.env: VITE_API_URL=http://localhost:8000, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev
# build check: npm run build   (runs tsc && vite build)
```

Applying migrations: run the SQL in `supabase/migrations/` via the Supabase SQL
editor, or via the Management API `POST /v1/projects/<ref>/database/query`.

---

## 8. Git history (main)

- d76fa49 fix: guard calendar/shared responses against non-array (blank Schedule/Dashboard)
- f397e47 perf: fix BLOW realtime reload loop + add user_id indexes; scale dashboard Today widget
- d69c670 Per-user data isolation, shared calendars, BLOW requests + mobile
- c9a355e BLOW: 1:1 messaging tab with HTTP-transaction UI

---

## 9. OUTSTANDING / BLOCKERS (verified 2026-08-27 ~11:55 ET)

These were checked with curl against the live deployments and are STILL not
working. Production calendar + shared-calendar data will not load until fixed.

1. **Backend deployment protection is STILL ON.**
   `GET https://backend-pranav-9815.vercel.app/` and `/calendar/today` both
   return `302 -> vercel.com/sso-api` (Vercel Authentication gate). The frontend
   cannot reach the API through this gate.
   FIX: Vercel -> backend project -> Settings -> Deployment Protection ->
   set **Vercel Authentication = Disabled** for Production (or Preview-only).
   Verify: `curl https://backend-pranav-9815.vercel.app/` should return
   `{"status":"CUM is online"}`, not a 302.

2. **Frontend `VITE_API_URL` is NOT applied.**
   The deployed frontend bundle (`index-DF7pVyXj.js`) contains NO backend URL —
   only the Supabase URL. So `api.js` falls back to `http://localhost:8000` in
   production and all backend calls fail. The redeploy did not pick up the var
   (same bundle hash => same build).
   FIX: Vercel -> frontend project -> Settings -> Environment Variables -> add
   `VITE_API_URL = https://backend-pranav-9815.vercel.app` for Production, then
   trigger a fresh **redeploy** (Vite inlines env at build time). Verify: the new
   bundle should contain the backend URL and Schedule/Dashboard should load
   calendar data.

3. **Confirm backend env vars** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) are set on
   the backend project so `/shared-calendar/*` works (otherwise those endpoints
   return 500 "SUPABASE_URL / SUPABASE_ANON_KEY must be set").

### Security follow-ups
- **Rotate the Supabase management PAT** (`sbp_...`) that was shared in chat
  during setup — it grants full account control. Rotate in Supabase -> Account ->
  Access Tokens.
- Consider rotating the Spotify client secret (it was committed in backend/.env
  historically; .env is now gitignored).

### After the 3 blockers are fixed, re-verify end to end:
```
curl https://backend-pranav-9815.vercel.app/                 # {"status":"CUM is online"}
curl https://backend-pranav-9815.vercel.app/calendar/today   # 401 without auth (expected) or JSON with auth
# In the app: Schedule shows Google + shared events; BLOW send/accept works.
```
