# API Debugging Quick Checks

Use this checklist when the web app shows `Could not load boards`.

## 1) Check debug endpoint directly

Open:

- `/api/__debug`

Expected:

- `200`
- `content-type: application/json`
- JSON body with `ok: true`

If you get HTML (`<!doctype html>`), your request is being routed to the SPA, not the API function.

## 2) Check boards endpoint directly

Open:

- `/api/boards`

Expected:

- JSON array or JSON error body

If HTML is returned, routing is still wrong.

## 3) Run browser diagnostics

In DevTools console on the web app:

```ts
import("/src/lib/debugApi.ts")
  .then((m) => m.runApiDiagnostics())
  .then((r) => console.log(r));
```

Look at:

- `debugContentType`
- `boardsContentType`
- `boardsBodyPreview`

## 4) Verify env vars on the deployment

Required for API:

- `DATABASE_URL`
- `SUPABASE_JWT_SECRET`

Required for web:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` (if using separate API project)

