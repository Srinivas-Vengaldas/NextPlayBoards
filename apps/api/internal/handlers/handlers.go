package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/nextplay/api/internal/authctx"
)

type Handlers struct {
	Pool *pgxpool.Pool
}

func (h *Handlers) withUserRLS(ctx context.Context, userID string, fn func(tx pgx.Tx) error) error {
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return err
	}

	// Allow Supabase RLS policies to read the authenticated user.
	// Supabase's `auth.uid()` reads `request.jwt.claim.sub`.
	if _, err := tx.Exec(ctx, `SELECT set_config('request.jwt.claim.sub', $1, true)`, userID); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}

	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}

	return tx.Commit(ctx)
}

type badRequestError struct {
	msg string
}

func (e *badRequestError) Error() string {
	return e.msg
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// --- Health (no auth) ---

func (h *Handlers) Health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// --- DTOs ---

type BoardSummary struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	OwnerID   string    `json:"ownerId"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type LabelDTO struct {
	ID        string    `json:"id"`
	BoardID   string    `json:"boardId,omitempty"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	CreatedAt time.Time `json:"createdAt,omitempty"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

type TaskDTO struct {
	ID          string     `json:"id"`
	ColumnID    string     `json:"columnId"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Position    float64    `json:"position"`
	AssigneeID  *string    `json:"assigneeId,omitempty"`
	AssigneeIDs []string   `json:"assigneeIds"`
	Labels      []LabelDTO `json:"labels"`
	TeamAssignees []TeamMemberDTO `json:"teamAssignees"`
	DueAt       *time.Time `json:"dueAt,omitempty"`
	Priority    string     `json:"priority"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type ColumnDTO struct {
	ID        string    `json:"id"`
	BoardID   string    `json:"boardId"`
	Title     string    `json:"title"`
	Position  float64   `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Tasks     []TaskDTO `json:"tasks"`
}

type BoardDetail struct {
	BoardSummary
	Columns []ColumnDTO `json:"columns"`
}

func (h *Handlers) canAccessBoard(
	ctx context.Context,
	db interface{ QueryRow(context.Context, string, ...any) pgx.Row },
	userID,
	boardID string,
) (bool, error) {
	var ok bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM boards b
			WHERE b.id = $1::uuid AND b.owner_id = $2::uuid
		) OR EXISTS (
			SELECT 1 FROM board_members bm
			WHERE bm.board_id = $1::uuid AND bm.user_id = $2::uuid
		)
	`, boardID, userID).Scan(&ok)
	return ok, err
}

// GET /boards
func (h *Handlers) ListBoards(w http.ResponseWriter, r *http.Request) {
	u, ok := authctx.UserFrom(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var out []BoardSummary
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), `
			SELECT b.id, b.title, b.owner_id, b.created_at, b.updated_at
			FROM boards b
			WHERE b.owner_id = $1::uuid OR EXISTS (
				SELECT 1 FROM board_members bm WHERE bm.board_id = b.id AND bm.user_id = $1::uuid
			)
			ORDER BY b.updated_at DESC
		`, u.ID)
		if err != nil {
			var pgErr *pgconn.PgError
			// If board_members (or a referenced column) doesn't exist yet, degrade gracefully.
			if errors.As(err, &pgErr) && (pgErr.Code == "42P01" || pgErr.Code == "42703") {
				out = []BoardSummary{}
				return nil
			}
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var b BoardSummary
			if err := rows.Scan(&b.ID, &b.Title, &b.OwnerID, &b.CreatedAt, &b.UpdatedAt); err != nil {
				return err
			}
			out = append(out, b)
		}
		if out == nil {
			out = []BoardSummary{}
		}
		return nil
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type createBoardBody struct {
	Title string `json:"title"`
}

// POST /boards
func (h *Handlers) CreateBoard(w http.ResponseWriter, r *http.Request) {
	u, ok := authctx.UserFrom(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var body createBoardBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Title == "" {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	var boardID string
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		var err error
		err = tx.QueryRow(r.Context(), `
			INSERT INTO boards (title, owner_id) VALUES ($1, $2::uuid) RETURNING id
		`, body.Title, u.ID).Scan(&boardID)
		if err != nil {
			return err
		}

		if _, err = tx.Exec(r.Context(), `
			INSERT INTO board_members (board_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')
		`, boardID, u.ID); err != nil {
			return err
		}

		defaultCols := []struct{ title string; pos float64 }{
			{"To do", 1000},
			{"In progress", 2000},
			{"In review", 3000},
			{"Done", 4000},
		}
		for _, c := range defaultCols {
			if _, err = tx.Exec(r.Context(), `
				INSERT INTO columns (board_id, title, position) VALUES ($1::uuid, $2, $3)
			`, boardID, c.title, c.pos); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": boardID})
}

// GET /boards/{id}
func (h *Handlers) GetBoard(w http.ResponseWriter, r *http.Request) {
	u, ok := authctx.UserFrom(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var allowed bool
	var b BoardSummary
	var columns []ColumnDTO

	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, id)
		if err != nil {
			return err
		}
		allowed = can
		if !can {
			return nil
		}

		if err := tx.QueryRow(r.Context(), `
			SELECT id, title, owner_id, created_at, updated_at FROM boards WHERE id = $1::uuid
		`, id).Scan(&b.ID, &b.Title, &b.OwnerID, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return err
		}

		colRows, err := tx.Query(r.Context(), `
			SELECT id, board_id, title, position, created_at, updated_at
			FROM columns WHERE board_id = $1::uuid ORDER BY position ASC, created_at ASC
		`, id)
		if err != nil {
			return err
		}
		defer colRows.Close()

		for colRows.Next() {
			var c ColumnDTO
			if err := colRows.Scan(&c.ID, &c.BoardID, &c.Title, &c.Position, &c.CreatedAt, &c.UpdatedAt); err != nil {
				return err
			}
			c.Tasks = []TaskDTO{}
			columns = append(columns, c)
		}

		if len(columns) > 0 {
			taskRows, err := tx.Query(r.Context(), `
				SELECT t.id, t.column_id, t.title, t.description, t.position, t.assignee_id, t.due_at, t.priority, t.created_at, t.updated_at
				FROM tasks t
				INNER JOIN columns c ON c.id = t.column_id
				WHERE c.board_id = $1::uuid
				ORDER BY t.column_id, t.position ASC, t.created_at ASC
			`, id)
			if err != nil {
				return err
			}
			defer taskRows.Close()

			colIndex := make(map[string]int, len(columns))
			for i := range columns {
				colIndex[columns[i].ID] = i
			}
			for taskRows.Next() {
				var t TaskDTO
				t.Labels = []LabelDTO{}
				t.AssigneeIDs = []string{}
				t.TeamAssignees = []TeamMemberDTO{}
				if err := taskRows.Scan(
					&t.ID, &t.ColumnID, &t.Title, &t.Description, &t.Position,
					&t.AssigneeID, &t.DueAt, &t.Priority, &t.CreatedAt, &t.UpdatedAt,
				); err != nil {
					return err
				}
				if ix, ok := colIndex[t.ColumnID]; ok {
					columns[ix].Tasks = append(columns[ix].Tasks, t)
				}
			}
			if err := enrichTasksWithLabelsAndAssignees(r.Context(), tx, columns); err != nil {
				return err
			}
			if err := enrichTasksWithTeamAssignees(r.Context(), tx, columns); err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if !allowed {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	writeJSON(w, http.StatusOK, BoardDetail{BoardSummary: b, Columns: columns})
}

type createColumnBody struct {
	Title    string  `json:"title"`
	Position float64 `json:"position"`
}

// POST /boards/{id}/columns
func (h *Handlers) CreateColumn(w http.ResponseWriter, r *http.Request) {
	u, ok := authctx.UserFrom(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	boardID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(boardID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body createColumnBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Title == "" {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	var allowed bool
	var colID string
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil {
			return err
		}
		allowed = can
		if !can {
			return nil
		}

		if body.Position == 0 {
			var max *float64
			_ = tx.QueryRow(r.Context(), `SELECT MAX(position) FROM columns WHERE board_id = $1::uuid`, boardID).Scan(&max)
			if max != nil {
				body.Position = *max + 1000
			} else {
				body.Position = 1000
			}
		}

		return tx.QueryRow(r.Context(), `
			INSERT INTO columns (board_id, title, position) VALUES ($1::uuid, $2, $3) RETURNING id
		`, boardID, body.Title, body.Position).Scan(&colID)
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if !allowed {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": colID})
}

type patchColumnBody struct {
	Title    *string  `json:"title,omitempty"`
	Position *float64 `json:"position,omitempty"`
}

// PATCH /columns/{id}
func (h *Handlers) PatchColumn(w http.ResponseWriter, r *http.Request) {
	u, ok := authctx.UserFrom(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	colID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(colID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body patchColumnBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	var allowed bool
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		var boardID string
		if err := tx.QueryRow(r.Context(), `SELECT board_id FROM columns WHERE id = $1::uuid`, colID).Scan(&boardID); err != nil {
			return err
		}
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil {
			return err
		}
		allowed = can
		if !can {
			return nil
		}

		var title any
		var pos any
		if body.Title != nil {
			title = *body.Title
		}
		if body.Position != nil {
			pos = *body.Position
		}

		_, err = tx.Exec(r.Context(), `
			UPDATE columns SET
				title = COALESCE($2::text, title),
				position = COALESCE($3::float8, position),
				updated_at = now()
			WHERE id = $1::uuid
		`, colID, title, pos)
		return err
	})

	if err != nil {
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if !allowed {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type createTaskBody struct {
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Position    float64    `json:"position"`
	Priority    string     `json:"priority"`
	DueAt       *time.Time `json:"dueAt"`
}

// POST /columns/{id}/tasks
func (h *Handlers) CreateTask(w http.ResponseWriter, r *http.Request) {
	u, ok := authctx.UserFrom(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	colID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(colID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body createTaskBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Title == "" {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Priority == "" {
		body.Priority = "none"
	}

	var allowed bool
	var taskID string
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		var boardID string
		if err := tx.QueryRow(r.Context(), `SELECT board_id FROM columns WHERE id = $1::uuid`, colID).Scan(&boardID); err != nil {
			return err
		}
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil {
			return err
		}
		allowed = can
		if !can {
			return nil
		}

		if body.Position == 0 {
			var max *float64
			_ = tx.QueryRow(r.Context(), `SELECT MAX(position) FROM tasks WHERE column_id = $1::uuid`, colID).Scan(&max)
			if max != nil {
				body.Position = *max + 1000
			} else {
				body.Position = 1000
			}
		}

		if err := tx.QueryRow(r.Context(), `
			INSERT INTO tasks (column_id, title, description, position, priority, due_at)
			VALUES ($1::uuid, $2, $3, $4, $5, $6) RETURNING id
		`, colID, body.Title, body.Description, body.Position, body.Priority, body.DueAt).Scan(&taskID); err != nil {
			return err
		}
		return insertActivity(r.Context(), tx, taskID, u.ID, "task_created", map[string]any{"title": body.Title})
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if !allowed {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": taskID})
}

type patchTaskBody struct {
	Title       *string    `json:"title,omitempty"`
	Description *string    `json:"description,omitempty"`
	ColumnID    *string    `json:"columnId,omitempty"`
	Position    *float64   `json:"position,omitempty"`
	Priority    *string    `json:"priority,omitempty"`
	DueAt       *time.Time `json:"dueAt"`
	AssigneeID  *string    `json:"assigneeId"`
}

// PATCH /tasks/{id}
func (h *Handlers) PatchTask(w http.ResponseWriter, r *http.Request) {
	u, ok := authctx.UserFrom(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	taskID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(taskID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body patchTaskBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	var allowed bool
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		var colID, title, desc, priority string
		var pos float64
		var assignee *string
		var dueAt *time.Time

		if err := tx.QueryRow(r.Context(), `
			SELECT column_id, title, description, position, assignee_id, due_at, priority
			FROM tasks WHERE id = $1::uuid
		`, taskID).Scan(&colID, &title, &desc, &pos, &assignee, &dueAt, &priority); err != nil {
			return err
		}

		var boardID string
		if err := tx.QueryRow(r.Context(), `SELECT board_id FROM columns WHERE id = $1::uuid`, colID).Scan(&boardID); err != nil {
			return err
		}

		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil {
			return err
		}
		allowed = can
		if !can {
			return nil
		}

		oldColID := colID
		oldTitle := title
		oldDesc := desc
		oldPos := pos
		oldPriority := priority
		oldDue := dueAt
		oldAssignee := assignee

		newColID := colID
		if body.ColumnID != nil {
			if _, err := uuid.Parse(*body.ColumnID); err != nil {
				return &badRequestError{msg: "invalid columnId"}
			}
			var nb string
			if err := tx.QueryRow(r.Context(), `SELECT board_id FROM columns WHERE id = $1::uuid`, *body.ColumnID).Scan(&nb); err != nil || nb != boardID {
				return &badRequestError{msg: "invalid column"}
			}
			newColID = *body.ColumnID
		}
		if body.Title != nil {
			title = *body.Title
		}
		if body.Description != nil {
			desc = *body.Description
		}
		if body.Position != nil {
			pos = *body.Position
		}
		if body.Priority != nil {
			priority = *body.Priority
		}
		if body.DueAt != nil {
			dueAt = body.DueAt
		}
		if body.AssigneeID != nil {
			if *body.AssigneeID == "" {
				assignee = nil
			} else {
				assignee = body.AssigneeID
			}
		}

		if body.AssigneeID != nil && assignee != nil {
			ok, err := isBoardMember(r.Context(), tx, boardID, *assignee)
			if err != nil {
				return err
			}
			if !ok {
				return &badRequestError{msg: "assignee is not a board member"}
			}
		}

		if _, err := tx.Exec(r.Context(), `
			UPDATE tasks SET
				column_id = $2::uuid,
				title = $3,
				description = $4,
				position = $5,
				priority = $6,
				due_at = $7,
				assignee_id = $8::uuid,
				updated_at = now()
			WHERE id = $1::uuid
		`, taskID, newColID, title, desc, pos, priority, dueAt, assignee); err != nil {
			return err
		}

		if body.AssigneeID != nil {
			if _, err := tx.Exec(r.Context(), `DELETE FROM task_assignees WHERE task_id = $1::uuid`, taskID); err != nil {
				return err
			}
			if assignee != nil {
				if _, err := tx.Exec(r.Context(), `
					INSERT INTO task_assignees (task_id, user_id) VALUES ($1::uuid, $2::uuid)
					ON CONFLICT DO NOTHING
				`, taskID, *assignee); err != nil {
					return err
				}
			}
		}

		if newColID != oldColID {
			var fromTitle, toTitle string
			_ = tx.QueryRow(r.Context(), `SELECT title FROM columns WHERE id = $1::uuid`, oldColID).Scan(&fromTitle)
			_ = tx.QueryRow(r.Context(), `SELECT title FROM columns WHERE id = $1::uuid`, newColID).Scan(&toTitle)
			if err := insertActivity(r.Context(), tx, taskID, u.ID, "moved", map[string]any{
				"fromColumn": fromTitle,
				"toColumn":   toTitle,
				"message":    "Moved to " + toTitle,
			}); err != nil {
				return err
			}
		} else if body.Position != nil && pos != oldPos {
			if err := insertActivity(r.Context(), tx, taskID, u.ID, "reordered", map[string]any{
				"position": pos,
				"message":  "Reordered in column",
			}); err != nil {
				return err
			}
		}
		if body.Title != nil && title != oldTitle {
			if err := insertActivity(r.Context(), tx, taskID, u.ID, "title_updated", map[string]any{
				"from":    oldTitle,
				"to":      title,
				"message": "Title updated",
			}); err != nil {
				return err
			}
		}
		if body.Description != nil && desc != oldDesc {
			if err := insertActivity(r.Context(), tx, taskID, u.ID, "description_updated", map[string]any{
				"message": "Description updated",
			}); err != nil {
				return err
			}
		}
		if body.Priority != nil && priority != oldPriority {
			if err := insertActivity(r.Context(), tx, taskID, u.ID, "priority_updated", map[string]any{
				"from":    oldPriority,
				"to":      priority,
				"message": "Priority changed to " + priority,
			}); err != nil {
				return err
			}
		}
		if body.DueAt != nil {
			dueChanged := (oldDue == nil && dueAt != nil) || (oldDue != nil && dueAt == nil) ||
				(oldDue != nil && dueAt != nil && !oldDue.Equal(*dueAt))
			if dueChanged {
				if err := insertActivity(r.Context(), tx, taskID, u.ID, "due_updated", map[string]any{
					"message": "Due date updated",
				}); err != nil {
					return err
				}
			}
		}
		if body.AssigneeID != nil {
			oldS := ""
			if oldAssignee != nil {
				oldS = *oldAssignee
			}
			newS := ""
			if assignee != nil {
				newS = *assignee
			}
			if oldS != newS {
				if err := insertActivity(r.Context(), tx, taskID, u.ID, "assignee_updated", map[string]any{
					"from":    oldS,
					"to":      newS,
					"message": "Assignee updated",
				}); err != nil {
					return err
				}
			}
		}

		return nil
	})

	if err != nil {
		var bre *badRequestError
		if errors.As(err, &bre) {
			writeErr(w, http.StatusBadRequest, bre.msg)
			return
		}
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if !allowed {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
