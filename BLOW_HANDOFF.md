# CUM + BLOW — Project Handoff

Last updated: 2026-08-27 (per-user Google Calendar OAuth + calendar sharing)

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
- Frontend: `https://centralized-unit-for-management.vercel.app` (Vercel project **`cum`**,
  root directory `frontend`). This is the project that's actually live — it has
  the real `VITE_API_URL`/Supabase env vars and auto-deploys from `main`.
  `https://frontend-pranav-9815.vercel.app` is a STALE/orphaned alias from an
  earlier, differently-named project; ignore it — do not diagnose against it.
  There is also an empty, unused `frontend` Vercel project (no deployments,
  no domain) created by accident during a 2026-08-27 session; safe to delete
  from the Vercel dashboard whenever, has zero effect either way.
- Backend:  `https://backend-pranav-9815.vercel.app` (Vercel project `backend`,
  aliases also include `backend-ten-delta-74.vercel.app` and
  `backend-git-main-pranav-9815.vercel.app` — all point at the same deploys).

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

### 0005_per_user_google_oauth.sql — per-user Google OAuth + calendar sharing
Replaces the single shared Google refresh token with one per user, and
replaces the old "create a shared calendar, manually add events" feature
with "send one of your connected Google calendars to another user."
- `oauth_tokens` gains `user_id`; PK becomes `(provider, user_id)`. The
  pre-existing single row was backfilled to the primary account.
- `oauth_pending_state(state pk, user_id, created_at)` — service_role only;
  short-lived state→user mapping used during the OAuth redirect round-trip.
- `calendar_shares(id, owner_id, grantee_id, calendar_id, label, created_at)`
  — RLS: owner can insert/delete their own; select allowed for owner OR
  grantee. Reuses `find_user_by_email` from 0001 for the email lookup.
- Dropped `shared_calendars` / `shared_calendar_members` /
  `shared_calendar_events` and their RPC/triggers (fully replaced; tables
  were empty when dropped).

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
- Personal Google calendars, per-user OAuth. "Connect Google Calendar" starts
  a real Google consent flow (`POST /calendar/oauth/start` → redirect →
  `GET /calendar/oauth/callback`); once connected, a checkbox picker
  (`GET /calendar/google-calendars`, live from the user's own token) replaces
  manual calendar_id entry. Enabled calendars are still tracked in the
  per-user `calendars` table via `/calendar/enabled` (GET/POST/DELETE).
- Calendar sharing: send one of your connected Google calendars to another
  CUM user by email (`POST /calendar/share`, resolves via
  `find_user_by_email`). Recipient sees it under "Shared with me"
  (`GET /calendar/shared-with-me`) and its live events merge into their week
  grid (`GET /calendar/shared-events` — backend fetches using the SHARER's
  stored token server-side; that token never reaches the recipient or the
  frontend). Revoke via `DELETE /calendar/share/{id}` (owner only).
- Responses are coerced to arrays (`Array.isArray(...) ? ... : []`) so a bad/
  unreachable backend cannot crash the page (it degrades to an empty calendar).

### Dashboard (frontend/src/pages/Dashboard.jsx)
- "Today" widget scales to fill the whole tile (flex rows + %-positioned events).
- user_settings read uses `.maybeSingle()` (no crash for users without a row).

### Backend routers
- `calendar.py`: `_user_calendar_ids(authorization)` builds an anon-key client +
  `postgrest.auth(token)` so it reads only the caller's calendars. `/today` and
  `/upcoming` accept the Authorization header. Caller identity for Google-token
  lookups is resolved via `_verified_user_id` (`supabase.auth.get_user(token)`)
  — a Supabase-verified user id, never a client-decoded JWT, since that id
  decides whose Google refresh token gets used.
  - OAuth: `POST /oauth/start`, `GET /oauth/callback`, `GET /status`,
    `GET /google-calendars`.
  - Enabled calendars: `GET/POST /enabled`, `DELETE /enabled/{id}`.
  - Sharing: `POST /share`, `GET /my-shares`, `GET /shared-with-me`,
    `DELETE /share/{id}`, `GET /shared-events`.
  - Requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
    `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FRONTEND_URL` env.
- `spotify.py`: single-tenant (app owner's account only); uses a fixed
  `OWNER_USER_ID` constant rather than a per-request caller, since
  `token_store` is now keyed by `(provider, user_id)`.
- `frontend/src/lib/api.js`: axios request interceptor attaches
  `Authorization: Bearer <supabase access_token>` to every backend call.
- The old `shared_calendar.py` router (create-your-own shared calendar,
  manual events, invite-by-email) is removed — replaced by calendar sharing
  above.

---

## 6. Environment variables

### frontend — Vercel project **`cum`** (root directory `frontend`) — build-time, inlined by Vite
- `VITE_API_URL` = `https://backend-pranav-9815.vercel.app`
- `VITE_SUPABASE_URL` = `https://tuypeumfbfaiqutjsfur.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = `sb_publishable_a8mJLf3I_CC0d0cN1o9Y5w_UCmwkv75`

All three are already set correctly on `cum` and confirmed baked into the live
bundle. Do NOT set these on the separate `frontend` Vercel project — that one
is stale/orphaned, not what serves traffic.

### backend project (Vercel `backend`) — runtime (os.getenv)
- `SUPABASE_URL` = `https://tuypeumfbfaiqutjsfur.supabase.co`
- `SUPABASE_ANON_KEY` = legacy anon JWT (role=anon)  <-- REQUIRED for shared calendars
- `SUPABASE_SERVICE_ROLE_KEY` = secret key (used by token_store; keep SENSITIVE)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (calendar OAuth + Google API), Spotify creds.
- `FRONTEND_URL` = `https://centralized-unit-for-management.vercel.app` — where
  `/calendar/oauth/callback` redirects after a successful Google connect.

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
# set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_*, SPOTIFY_*,
# FRONTEND_URL (defaults to http://localhost:5173 if unset) in backend/.env
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

Connecting Google Calendar locally requires the OAuth client (the one behind
`GOOGLE_CLIENT_ID`) to be a **Web application** type with
`http://localhost:8000/calendar/oauth/callback` registered as an authorized
redirect URI, and — if the consent screen is still in Testing mode — your
Google account listed as a test user. Both are Console-only; there's no
gcloud/API path for editing a standard OAuth client's redirect URIs or the
consent screen's test-user list.

---

## 8. Git history (main)

- (pending) fix: correct oauth_tokens backfill + drop order in 0005 migration
- (pending) feat: per-user Google Calendar OAuth + calendar sharing between users
- d76fa49 fix: guard calendar/shared responses against non-array (blank Schedule/Dashboard)
- f397e47 perf: fix BLOW realtime reload loop + add user_id indexes; scale dashboard Today widget
- d69c670 Per-user data isolation, shared calendars, BLOW requests + mobile
- c9a355e BLOW: 1:1 messaging tab with HTTP-transaction UI

---

## 9. OUTSTANDING (verified 2026-08-27/28)

The two Vercel-side blockers previously listed here (deployment protection,
missing `VITE_API_URL`) turned out to be misdiagnosed against the stale
`frontend` project, not the real `cum` one — the live site was already fine
on both. Verified end to end:
```
curl https://backend-pranav-9815.vercel.app/                # {"status":"CUM is online"}
curl https://backend-pranav-9815.vercel.app/calendar/status # 401 without auth (expected)
```
`cum`'s live bundle contains the new Schedule.jsx ("Connect Google Calendar" UI).

Still open:
1. **Google Cloud Console setup for OAuth** (Console-only, no gcloud/API path):
   - Add `https://backend-pranav-9815.vercel.app/calendar/oauth/callback` as an
     authorized redirect URI on the `GOOGLE_CLIENT_ID` OAuth 2.0 Client (must be
     "Web application" type).
   - If the consent screen is still in Testing mode, add every non-owner user
     (`agneyat2@gmail.com`, `test@gmail.com`, ...) as a test user, or their
     consent attempt will be rejected.
2. **Empty stray `frontend` Vercel project** — created by accident, zero
   deployments/domain, harmless. Delete from the dashboard whenever, or leave it.

### Security follow-ups (still open)
- **Rotate the Supabase management PAT** (`sbp_...`) that was shared in chat
  during setup — it grants full account control. Rotate in Supabase -> Account ->
  Access Tokens.
- Consider rotating the Spotify client secret (it was committed in backend/.env
  historically; .env is now gitignored).
