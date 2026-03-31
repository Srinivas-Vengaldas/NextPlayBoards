# NextPlay — Kanban Task Board

Asana/Linear/Notion-inspired Kanban board with:

- **Web**: Vite + React + TypeScript
- **Mobile**: Expo React Native + TypeScript
- **Backend API**: Vercel Functions (TypeScript + Prisma)
- **Database/Auth**: Supabase (Postgres + Auth + RLS)
- **Hosting**: Vercel (web)

---

## Quick start (local development)

### 1) Create Supabase project

Create a Supabase project and run the SQL migration(s) under:

`supabase/migrations/`

Then set these environment variables:

#### Web (Vite)

Copy:

`apps/web/.env.example` → `apps/web/.env`

Set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` (e.g. `http://localhost:8080`)

#### API runtime (Prisma)

The web app calls `/api/*` endpoints served by Vercel Functions.

Set these environment variables in Vercel:

- `DATABASE_URL` (Supabase Postgres connection string, preferably pooled)
- `SUPABASE_JWT_SECRET` (JWT secret used by Supabase)

### 2) Run the web app

From repo root:

```bash
pnpm install
pnpm --filter @nextplay/web dev
```

### 3) Run the mobile app

From repo root:

```bash
pnpm --filter @nextplay/mobile start
```

Then open the Expo link on a device/emulator.

You must provide environment variables via Expo (typically `EXPO_PUBLIC_*`).
For example:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_URL`

---

## Project scripts

From repo root:

- `pnpm --filter @nextplay/web dev`
- `pnpm --filter @nextplay/web build`
- `pnpm --filter @nextplay/mobile start`
- `pnpm --filter @nextplay/shared build`

---

## Deploy

### Web on Vercel

1. Connect this GitHub repository in Vercel.
2. Create a new project pointing at the repository root.
3. Set environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_API_URL`
4. Vercel build uses the repository root `vercel.json` (added in this commit).

### API on Vercel Functions

Backend endpoints are implemented in `api/[...path].ts` and run in Vercel's Node runtime.

Required Vercel env vars:

- `DATABASE_URL`
- `SUPABASE_JWT_SECRET`

---

## Notes / next steps

- The web client supports drag between columns using `@dnd-kit`.
- Mobile uses draggable reorder within a column for now; cross-column drag can be added in a later iteration.

