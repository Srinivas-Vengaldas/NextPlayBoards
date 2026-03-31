# NextPlay — Assessment Rubric Checklist

Use this when preparing your PDF submission. Map each item to screenshots, URLs, and file paths.

## Design quality (polished, intentional)

- [x] Cohesive dark UI (Linear-style slate board view): `apps/web/src/components/KanbanBoard.tsx`, `apps/web/src/routes/BoardPage.tsx`
- [x] Clear hierarchy: columns, cards, slide-over panel
- [x] Loading states: board skeleton, comments/activity spinners
- [x] Error states: board load retry, inline error toast for mutations
- [x] Empty states: column placeholders with CTA

## Board functionality

- [x] Default columns on new board (API): `To do`, `In progress`, `In review`, `Done` — `apps/api/internal/handlers/handlers.go` (`CreateBoard`)
- [x] Drag-and-drop between columns with optimistic UI + `PATCH /tasks/{id}` with `columnId` and `position`
- [x] Task create per column (`POST /columns/{id}/tasks`)

## Frontend usability & state handling

- [x] Optimistic task create and drag updates with server reconciliation via React Query invalidation
- [x] Search + filters: priority, label (board labels + hashtags), assignee — `BoardPage.tsx` + `KanbanBoard.tsx`

## Database schema & persistence

- [x] Core: `supabase/migrations/20250330120000_init_schema.sql`
- [x] Advanced: `supabase/migrations/20250331120000_advanced_task_features.sql`  
  (`labels`, `task_labels`, `task_assignees`, `task_comments`, `task_activity`)

## Security awareness (RLS, keys)

- [x] RLS on new tables aligned with board membership — see policies in advanced migration
- [x] API uses user JWT + `set_config('request.jwt.claim.sub', ...)` for RLS — `apps/api/internal/handlers/handlers.go`
- [x] **Do not** commit Supabase service role key; frontend uses anon key only (verify `.env` / CI)

## Advanced features (differentiating)

- [x] Team / assignees: `task_assignees`, `GET/POST/DELETE /tasks/{id}/assignees`
- [x] Comments: `task_comments`, `GET/POST /tasks/{id}/comments`
- [x] Activity log: `task_activity`, written on task patch and relation changes; `GET /tasks/{id}/activity`
- [x] Labels: `labels` + `task_labels`, `GET/POST /boards/{id}/labels`, `POST/DELETE` task label routes
- [x] Due date indicators: “Due soon” / “Overdue” on cards
- [x] Search & filtering: header filters + board label query

## API surface (reference)

| Method | Path |
|--------|------|
| GET | `/boards/{id}/labels` |
| POST | `/boards/{id}/labels` |
| GET | `/tasks/{id}/comments` |
| POST | `/tasks/{id}/comments` |
| GET | `/tasks/{id}/activity` |
| GET | `/tasks/{id}/assignees` |
| POST | `/tasks/{id}/assignees` |
| DELETE | `/tasks/{taskId}/assignees/{userId}` |
| POST | `/tasks/{id}/labels` |
| DELETE | `/tasks/{taskId}/labels/{labelId}` |

## Code quality

- [x] Shared contracts: `packages/shared/src/schemas.ts`, `packages/shared/src/client.ts`
- [x] Handlers split: `apps/api/internal/handlers/handlers.go`, `handlers_meta.go`, `helpers.go`

## Local verification

1. Apply Supabase migrations (local or remote).
2. Run API with valid `DATABASE_URL` and `SUPABASE_JWT_SECRET`.
3. Run web with `VITE_API_URL` pointing at API.
4. `pnpm` / `npm` in `packages/shared` and `apps/web`: `npm run build`.
