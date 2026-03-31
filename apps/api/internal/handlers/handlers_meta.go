package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/nextplay/api/internal/authctx"
)

// --- Comments ---

type CommentDTO struct {
	ID        string    `json:"id"`
	TaskID    string    `json:"taskId"`
	UserID    string    `json:"userId"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

// GET /tasks/{id}/comments
func (h *Handlers) ListTaskComments(w http.ResponseWriter, r *http.Request) {
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

	var out []CommentDTO
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		if _, err := taskBoardID(r.Context(), tx, taskID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errNoAccess{}
			}
			return err
		}

		rows, err := tx.Query(r.Context(), `
			SELECT id, task_id, user_id, content, created_at
			FROM task_comments
			WHERE task_id = $1::uuid
			ORDER BY created_at ASC
		`, taskID)
		if err != nil {
			var pgErr *pgconn.PgError
			// Fallback to older schema (author_id/body) if migration not applied yet.
			if errors.As(err, &pgErr) && pgErr.Code == "42703" { // undefined_column
				rows2, err2 := tx.Query(r.Context(), `
					SELECT id, task_id, author_id, body, created_at
					FROM task_comments
					WHERE task_id = $1::uuid
					ORDER BY created_at ASC
				`, taskID)
				if err2 != nil {
					return err2
				}
				rows = rows2
				// scan later based on number of columns -> easiest: rescan with dedicated loop
				defer rows.Close()
				for rows.Next() {
					var c CommentDTO
					var authorID, body string
					if err := rows.Scan(&c.ID, &c.TaskID, &authorID, &body, &c.CreatedAt); err != nil {
						return err
					}
					c.UserID = authorID
					c.Content = body
					out = append(out, c)
				}
				if out == nil {
					out = []CommentDTO{}
				}
				return nil
			}
			return err
		}
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c CommentDTO
			if err := rows.Scan(&c.ID, &c.TaskID, &c.UserID, &c.Content, &c.CreatedAt); err != nil {
				return err
			}
			out = append(out, c)
		}
		if out == nil {
			out = []CommentDTO{}
		}
		return nil
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type createCommentBody struct {
	Content string `json:"content"`
}

// POST /tasks/{id}/comments
func (h *Handlers) CreateTaskComment(w http.ResponseWriter, r *http.Request) {
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
	var body createCommentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Content == "" {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		boardID, err := taskBoardID(r.Context(), tx, taskID)
		if err != nil {
			return err
		}
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil || !can {
			return errNoAccess{}
		}

		_, err = tx.Exec(r.Context(), `
			INSERT INTO task_comments (task_id, user_id, content, author_id, body)
			VALUES ($1::uuid, $2::uuid, $3, $2::uuid, $3)
		`, taskID, u.ID, body.Content)
		if err != nil {
			var pgErr *pgconn.PgError
			// Fallback to older schema (author_id/body)
			if errors.As(err, &pgErr) && pgErr.Code == "42703" { // undefined_column
				_, err2 := tx.Exec(r.Context(), `
					INSERT INTO task_comments (task_id, author_id, body)
					VALUES ($1::uuid, $2::uuid, $3)
				`, taskID, u.ID, body.Content)
				if err2 != nil {
					return err2
				}
				return insertActivity(r.Context(), tx, taskID, u.ID, "comment_added", map[string]any{
					"preview": truncateStr(body.Content, 120),
					"message": "Comment added",
				})
			}
			return err
		}
		if err != nil {
			return err
		}
		return insertActivity(r.Context(), tx, taskID, u.ID, "comment_added", map[string]any{
			"preview": truncateStr(body.Content, 120),
			"message": "Comment added",
		})
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// --- Activity ---

type ActivityDTO struct {
	ID         string         `json:"id"`
	TaskID     string         `json:"taskId"`
	ActorID    string         `json:"actorId"`
	ActionType string         `json:"actionType"`
	Message    string         `json:"message"`
	Metadata   map[string]any `json:"metadata"`
	CreatedAt  time.Time      `json:"createdAt"`
}

// GET /tasks/{id}/activity
func (h *Handlers) ListTaskActivity(w http.ResponseWriter, r *http.Request) {
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

	var out []ActivityDTO
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		if _, err := taskBoardID(r.Context(), tx, taskID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errNoAccess{}
			}
			return err
		}

		rows, err := tx.Query(r.Context(), `
			SELECT id, task_id, actor_id, action_type, message, metadata, created_at
			FROM task_activities
			WHERE task_id = $1::uuid
			ORDER BY created_at DESC
		`, taskID)
		if err != nil {
			var pgErr *pgconn.PgError
			// Fallback to older table name task_activity (no message column)
			if errors.As(err, &pgErr) && pgErr.Code == "42P01" { // undefined_table
				rows2, err2 := tx.Query(r.Context(), `
					SELECT id, task_id, actor_id, action_type, metadata, created_at
					FROM task_activity
					WHERE task_id = $1::uuid
					ORDER BY created_at DESC
				`, taskID)
				if err2 != nil {
					return err2
				}
				rows = rows2
				defer rows.Close()
				for rows.Next() {
					var a ActivityDTO
					var metaBytes []byte
					if err := rows.Scan(&a.ID, &a.TaskID, &a.ActorID, &a.ActionType, &metaBytes, &a.CreatedAt); err != nil {
						return err
					}
					a.Message = ""
					if len(metaBytes) > 0 {
						_ = json.Unmarshal(metaBytes, &a.Metadata)
					}
					if a.Metadata == nil {
						a.Metadata = map[string]any{}
					}
					out = append(out, a)
				}
				if out == nil {
					out = []ActivityDTO{}
				}
				return nil
			}
			return err
		}
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a ActivityDTO
			var metaBytes []byte
			if err := rows.Scan(&a.ID, &a.TaskID, &a.ActorID, &a.ActionType, &a.Message, &metaBytes, &a.CreatedAt); err != nil {
				return err
			}
			if len(metaBytes) > 0 {
				_ = json.Unmarshal(metaBytes, &a.Metadata)
			}
			if a.Metadata == nil {
				a.Metadata = map[string]any{}
			}
			out = append(out, a)
		}
		if out == nil {
			out = []ActivityDTO{}
		}
		return nil
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type errNoAccess struct{}

func (e errNoAccess) Error() string { return "no access" }

// --- Members ---

type BoardMemberDTO struct {
	UserID      string  `json:"userId"`
	DisplayName *string `json:"displayName,omitempty"`
	AvatarURL   *string `json:"avatarUrl,omitempty"`
}

// --- Custom Team Members ---

type TeamMemberDTO struct {
	ID        string     `json:"id"`
	BoardID   string     `json:"boardId"`
	Name      string     `json:"name"`
	Color     string     `json:"color"`
	AvatarURL *string    `json:"avatarUrl,omitempty"`
	CreatedAt *time.Time `json:"createdAt,omitempty"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty"`
}

type BoardMemberSearchDTO struct {
	UserID      string  `json:"userId"`
	Email       *string `json:"email,omitempty"`
	DisplayName *string `json:"displayName,omitempty"`
	AvatarURL   *string `json:"avatarUrl,omitempty"`
}

// GET /boards/{id}/members
func (h *Handlers) ListBoardMembers(w http.ResponseWriter, r *http.Request) {
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

	var out []BoardMemberDTO
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil {
			return err
		}
		if !can {
			return errNoAccess{}
		}

		rows, err := tx.Query(r.Context(), `
			SELECT p.id::text, p.display_name, p.avatar_url
			FROM (
				SELECT b.owner_id AS user_id
				FROM boards b
				WHERE b.id = $1::uuid
				UNION
				SELECT bm.user_id
				FROM board_members bm
				WHERE bm.board_id = $1::uuid
			) m
			INNER JOIN profiles p ON p.id = m.user_id
			ORDER BY p.display_name NULLS LAST, p.id ASC
		`, boardID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m BoardMemberDTO
			if err := rows.Scan(&m.UserID, &m.DisplayName, &m.AvatarURL); err != nil {
				return err
			}
			out = append(out, m)
		}
		if out == nil {
			out = []BoardMemberDTO{}
		}
		return nil
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// GET /boards/{id}/member-search?q={email|userId}
func (h *Handlers) SearchBoardMembers(w http.ResponseWriter, r *http.Request) {
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
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusOK, []BoardMemberSearchDTO{})
		return
	}

	var out []BoardMemberSearchDTO
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil {
			return err
		}
		if !can {
			return errNoAccess{}
		}

		qLower := q
		// Try exact UUID lookup first
		if id, err := uuid.Parse(q); err == nil {
			rows, err := tx.Query(r.Context(), `
				SELECT p.id::text, NULL::text AS email, p.display_name, p.avatar_url
				FROM profiles p
				WHERE p.id = $1::uuid
				LIMIT 5
			`, id.String())
			if err == nil {
				defer rows.Close()
				for rows.Next() {
					var m BoardMemberSearchDTO
					if err := rows.Scan(&m.UserID, &m.Email, &m.DisplayName, &m.AvatarURL); err != nil {
						return err
					}
					out = append(out, m)
				}
				if out == nil {
					out = []BoardMemberSearchDTO{}
				}
				return nil
			}
			// fall through to email/search if query fails
		}

		// Email search: join auth.users (may require sufficient DB privileges)
		rows, err := tx.Query(r.Context(), `
			SELECT p.id::text, u.email, p.display_name, p.avatar_url
			FROM auth.users u
			INNER JOIN profiles p ON p.id = u.id
			WHERE lower(u.email) = lower($1)
			LIMIT 5
		`, qLower)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var m BoardMemberSearchDTO
				if err := rows.Scan(&m.UserID, &m.Email, &m.DisplayName, &m.AvatarURL); err != nil {
					return err
				}
				out = append(out, m)
			}
		} else {
			// Fallback: partial match on display_name
			rows2, err2 := tx.Query(r.Context(), `
				SELECT p.id::text, NULL::text AS email, p.display_name, p.avatar_url
				FROM profiles p
				WHERE p.display_name ILIKE '%' || $1 || '%'
				ORDER BY p.display_name NULLS LAST
				LIMIT 5
			`, qLower)
			if err2 != nil {
				return err2
			}
			defer rows2.Close()
			for rows2.Next() {
				var m BoardMemberSearchDTO
				if err := rows2.Scan(&m.UserID, &m.Email, &m.DisplayName, &m.AvatarURL); err != nil {
					return err
				}
				out = append(out, m)
			}
		}

		if out == nil {
			out = []BoardMemberSearchDTO{}
		}
		return nil
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type addBoardMemberBody struct {
	UserID string `json:"userId"`
}

// POST /boards/{id}/members
func (h *Handlers) AddBoardMember(w http.ResponseWriter, r *http.Request) {
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
	var body addBoardMemberBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if _, err := uuid.Parse(body.UserID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid userId")
		return
	}

	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		// RLS policy on board_members_insert enforces owner/admin
		_, err := tx.Exec(r.Context(), `
			INSERT INTO board_members (board_id, user_id, role)
			VALUES ($1::uuid, $2::uuid, 'member')
			ON CONFLICT (board_id, user_id) DO NOTHING
		`, boardID, body.UserID)
		return err
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42501" { // insufficient_privilege
			writeErr(w, http.StatusForbidden, "forbidden")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /boards/{id}/team-members
func (h *Handlers) ListTeamMembers(w http.ResponseWriter, r *http.Request) {
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

	var out []TeamMemberDTO
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil {
			return err
		}
		if !can {
			return errNoAccess{}
		}
		rows, err := tx.Query(r.Context(), `
			SELECT id::text, board_id::text, name, color, avatar_url, created_at, updated_at
			FROM team_members
			WHERE board_id = $1::uuid
			ORDER BY created_at ASC
		`, boardID)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && (pgErr.Code == "42P01" || pgErr.Code == "42703") { // undefined_table/column
				out = []TeamMemberDTO{}
				return nil
			}
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m TeamMemberDTO
			if err := rows.Scan(&m.ID, &m.BoardID, &m.Name, &m.Color, &m.AvatarURL, &m.CreatedAt, &m.UpdatedAt); err != nil {
				return err
			}
			out = append(out, m)
		}
		if out == nil {
			out = []TeamMemberDTO{}
		}
		return nil
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type createTeamMemberBody struct {
	Name      string  `json:"name"`
	Color     string  `json:"color"`
	AvatarURL *string `json:"avatarUrl"`
}

// POST /boards/{id}/team-members
func (h *Handlers) CreateTeamMember(w http.ResponseWriter, r *http.Request) {
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
	var body createTeamMemberBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Color == "" {
		body.Color = "#3b82f6"
	}

	var outID string
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil {
			return err
		}
		if !can {
			return errNoAccess{}
		}
		return tx.QueryRow(r.Context(), `
			INSERT INTO team_members (board_id, name, color, avatar_url)
			VALUES ($1::uuid, $2, $3, $4)
			RETURNING id::text
		`, boardID, body.Name, body.Color, body.AvatarURL).Scan(&outID)
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": outID})
}

type addTaskTeamMemberBody struct {
	MemberID string `json:"memberId"`
}

// POST /tasks/{id}/team-members
func (h *Handlers) AddTaskTeamMember(w http.ResponseWriter, r *http.Request) {
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
	var body addTaskTeamMemberBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.MemberID == "" {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if _, err := uuid.Parse(body.MemberID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid memberId")
		return
	}

	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		boardID, err := taskBoardID(r.Context(), tx, taskID)
		if err != nil {
			return err
		}
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil || !can {
			return errNoAccess{}
		}
		_, err = tx.Exec(r.Context(), `
			INSERT INTO task_team_assignees (task_id, team_member_id)
			VALUES ($1::uuid, $2::uuid)
			ON CONFLICT (task_id, team_member_id) DO NOTHING
		`, taskID, body.MemberID)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "42P01" { // undefined_table
				return &badRequestError{msg: "team members not enabled"}
			}
			return err
		}
		return insertActivity(r.Context(), tx, taskID, u.ID, "team_member_added", map[string]any{
			"memberId": body.MemberID,
			"message":  "Assigned a team member",
		})
	})
	if err != nil {
		var br *badRequestError
		if errors.As(err, &br) {
			writeErr(w, http.StatusBadRequest, br.msg)
			return
		}
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /tasks/{taskId}/team-members/{memberId}
func (h *Handlers) RemoveTaskTeamMember(w http.ResponseWriter, r *http.Request) {
	u, ok := authctx.UserFrom(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	taskID := chi.URLParam(r, "taskId")
	memberID := chi.URLParam(r, "memberId")
	if _, err := uuid.Parse(taskID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid taskId")
		return
	}
	if _, err := uuid.Parse(memberID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid memberId")
		return
	}

	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		boardID, err := taskBoardID(r.Context(), tx, taskID)
		if err != nil {
			return err
		}
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil || !can {
			return errNoAccess{}
		}
		_, err = tx.Exec(r.Context(), `
			DELETE FROM task_team_assignees
			WHERE task_id = $1::uuid AND team_member_id = $2::uuid
		`, taskID, memberID)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "42P01" { // undefined_table
				return nil
			}
			return err
		}
		return insertActivity(r.Context(), tx, taskID, u.ID, "team_member_removed", map[string]any{
			"memberId": memberID,
			"message":  "Unassigned a team member",
		})
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Labels (board-level) ---

// GET /boards/{id}/labels
func (h *Handlers) ListBoardLabels(w http.ResponseWriter, r *http.Request) {
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

	var out []LabelDTO
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil {
			return err
		}
		if !can {
			return errNoAccess{}
		}
		rows, err := tx.Query(r.Context(), `
			SELECT id, board_id, name, color, created_at, updated_at
			FROM labels WHERE board_id = $1::uuid ORDER BY name ASC
		`, boardID)
		if err != nil {
			var pgErr *pgconn.PgError
			// Labels tables may not exist yet if migrations aren't applied.
			if errors.As(err, &pgErr) && (pgErr.Code == "42P01" || pgErr.Code == "42703") {
				out = []LabelDTO{}
				return nil
			}
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var l LabelDTO
			if err := rows.Scan(&l.ID, &l.BoardID, &l.Name, &l.Color, &l.CreatedAt, &l.UpdatedAt); err != nil {
				return err
			}
			out = append(out, l)
		}
		if out == nil {
			out = []LabelDTO{}
		}
		return nil
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type createLabelBody struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

// POST /boards/{id}/labels
func (h *Handlers) CreateBoardLabel(w http.ResponseWriter, r *http.Request) {
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
	var body createLabelBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Color == "" {
		body.Color = "#64748b"
	}

	var labelID string
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil {
			return err
		}
		if !can {
			return errNoAccess{}
		}
		err = tx.QueryRow(r.Context(), `
			INSERT INTO labels (board_id, name, color) VALUES ($1::uuid, $2, $3)
			RETURNING id
		`, boardID, body.Name, body.Color).Scan(&labelID)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return tx.QueryRow(r.Context(), `
					UPDATE labels SET color = $3, updated_at = now()
					WHERE board_id = $1::uuid AND lower(name) = lower($2)
					RETURNING id
				`, boardID, body.Name, body.Color).Scan(&labelID)
			}
			return err
		}
		return nil
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": labelID})
}

// --- Task labels ---

type addTaskLabelBody struct {
	LabelID string `json:"labelId"`
}

// POST /tasks/{id}/labels
func (h *Handlers) AddTaskLabel(w http.ResponseWriter, r *http.Request) {
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
	var body addTaskLabelBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if _, err := uuid.Parse(body.LabelID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid labelId")
		return
	}

	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		boardID, err := taskBoardID(r.Context(), tx, taskID)
		if err != nil {
			return err
		}
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil || !can {
			return errNoAccess{}
		}
		var lbBoard string
		if err := tx.QueryRow(r.Context(), `SELECT board_id FROM labels WHERE id = $1::uuid`, body.LabelID).Scan(&lbBoard); err != nil {
			return err
		}
		if lbBoard != boardID {
			return &badRequestError{msg: "label does not belong to board"}
		}
		_, err = tx.Exec(r.Context(), `
			INSERT INTO task_labels (task_id, label_id) VALUES ($1::uuid, $2::uuid)
			ON CONFLICT DO NOTHING
		`, taskID, body.LabelID)
		if err != nil {
			return err
		}
		return insertActivity(r.Context(), tx, taskID, u.ID, "label_attached", map[string]any{"labelId": body.LabelID})
	})
	if err != nil {
		var bre *badRequestError
		if errors.As(err, &bre) {
			writeErr(w, http.StatusBadRequest, bre.msg)
			return
		}
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /tasks/{taskId}/labels/{labelId}
func (h *Handlers) RemoveTaskLabel(w http.ResponseWriter, r *http.Request) {
	u, ok := authctx.UserFrom(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	taskID := chi.URLParam(r, "taskId")
	labelID := chi.URLParam(r, "labelId")
	if _, err := uuid.Parse(taskID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid task id")
		return
	}
	if _, err := uuid.Parse(labelID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid label id")
		return
	}

	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		boardID, err := taskBoardID(r.Context(), tx, taskID)
		if err != nil {
			return err
		}
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil || !can {
			return errNoAccess{}
		}
		_, err = tx.Exec(r.Context(), `
			DELETE FROM task_labels WHERE task_id = $1::uuid AND label_id = $2::uuid
		`, taskID, labelID)
		if err != nil {
			return err
		}
		return insertActivity(r.Context(), tx, taskID, u.ID, "label_detached", map[string]any{"labelId": labelID})
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Assignees ---

type addAssigneeBody struct {
	UserID string `json:"userId"`
}

// GET /tasks/{id}/assignees
func (h *Handlers) ListTaskAssignees(w http.ResponseWriter, r *http.Request) {
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

	var out []string
	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		_, err := taskBoardID(r.Context(), tx, taskID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errNoAccess{}
			}
			return err
		}
		rows, err := tx.Query(r.Context(), `
			SELECT user_id FROM task_assignees WHERE task_id = $1::uuid ORDER BY created_at ASC
		`, taskID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var uid string
			if err := rows.Scan(&uid); err != nil {
				return err
			}
			out = append(out, uid)
		}
		if out == nil {
			out = []string{}
		}
		return nil
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// POST /tasks/{id}/assignees
func (h *Handlers) AddTaskAssignee(w http.ResponseWriter, r *http.Request) {
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
	var body addAssigneeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if _, err := uuid.Parse(body.UserID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid userId")
		return
	}

	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		boardID, err := taskBoardID(r.Context(), tx, taskID)
		if err != nil {
			return err
		}
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil || !can {
			return errNoAccess{}
		}
		member, err := isBoardMember(r.Context(), tx, boardID, body.UserID)
		if err != nil {
			return err
		}
		if !member {
			return &badRequestError{msg: "user is not a board member"}
		}
		_, err = tx.Exec(r.Context(), `
			INSERT INTO task_assignees (task_id, user_id) VALUES ($1::uuid, $2::uuid)
			ON CONFLICT DO NOTHING
		`, taskID, body.UserID)
		if err != nil {
			return err
		}
		return insertActivity(r.Context(), tx, taskID, u.ID, "assignee_added", map[string]any{"userId": body.UserID})
	})
	if err != nil {
		var bre *badRequestError
		if errors.As(err, &bre) {
			writeErr(w, http.StatusBadRequest, bre.msg)
			return
		}
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /tasks/{taskId}/assignees/{userId}
func (h *Handlers) RemoveTaskAssignee(w http.ResponseWriter, r *http.Request) {
	u, ok := authctx.UserFrom(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	taskID := chi.URLParam(r, "taskId")
	assigneeUserID := chi.URLParam(r, "userId")
	if _, err := uuid.Parse(taskID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid task id")
		return
	}
	if _, err := uuid.Parse(assigneeUserID); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid user id")
		return
	}

	err := h.withUserRLS(r.Context(), u.ID, func(tx pgx.Tx) error {
		boardID, err := taskBoardID(r.Context(), tx, taskID)
		if err != nil {
			return err
		}
		can, err := h.canAccessBoard(r.Context(), tx, u.ID, boardID)
		if err != nil || !can {
			return errNoAccess{}
		}
		_, err = tx.Exec(r.Context(), `
			DELETE FROM task_assignees WHERE task_id = $1::uuid AND user_id = $2::uuid
		`, taskID, assigneeUserID)
		if err != nil {
			return err
		}
		return insertActivity(r.Context(), tx, taskID, u.ID, "assignee_removed", map[string]any{"userId": assigneeUserID})
	})
	if err != nil {
		var na errNoAccess
		if errors.As(err, &na) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
