# NextPlay — Kanban Task Board

Asana/Linear/Notion-inspired Kanban board with:

- **Web**: Vite + React + TypeScript
- **Mobile**: Expo React Native + TypeScript
- **Backend API**: Go (REST)
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

#### API (Go)

Copy:

`apps/api/.env.example` → `apps/api/.env`

Set:

- `DATABASE_URL` (Supabase Postgres connection string)
- `SUPABASE_JWT_SECRET` (JWT secret used by Supabase)

### 2) Run the backend API

From repo root:

```bash
cd apps/api
# If you have Go installed locally
go run ./cmd/server
```

The server listens on `HTTP_ADDR` (default `:8080`).

### 3) Run the web app

From repo root:

```bash
pnpm install
pnpm --filter @nextplay/web dev
```

### 4) Run the mobile app

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

### Backend API host (Go)

This repo includes a container build at `apps/api/Dockerfile`.

Pick a host that supports containers (for example: Fly.io / Render / Google Cloud Run).

Required environment variables for the API:

- `DATABASE_URL`
- `SUPABASE_JWT_SECRET`
- `HTTP_ADDR` (optional)

---

## Notes / next steps

- The web client supports drag between columns using `@dnd-kit`.
- Mobile uses draggable reorder within a column for now; cross-column drag can be added in a later iteration.

