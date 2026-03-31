package handlers

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func insertActivity(ctx context.Context, tx pgx.Tx, taskID, actorID, actionType string, metadata map[string]any) error {
	msg := ""
	if metadata != nil {
		if v, ok := metadata["message"]; ok {
			if s, ok := v.(string); ok {
				msg = s
			}
		}
	}
	if msg == "" {
		msg = actionType
	}
	var b []byte
	var err error
	if metadata == nil {
		b = []byte("{}")
	} else {
		b, err = json.Marshal(metadata)
		if err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO task_activities (task_id, actor_id, action_type, message, metadata)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
	`, taskID, actorID, actionType, msg, b)
	if err != nil {
		var pgErr *pgconn.PgError
		// Fallback for older schema that only has task_activity
		if errors.As(err, &pgErr) && pgErr.Code == "42P01" { // undefined_table
			_, err2 := tx.Exec(ctx, `
				INSERT INTO task_activity (task_id, actor_id, action_type, metadata)
				VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)
			`, taskID, actorID, actionType, b)
			return err2
		}
	}
	return err
}

func taskBoardID(ctx context.Context, tx pgx.Tx, taskID string) (string, error) {
	var boardID string
	err := tx.QueryRow(ctx, `
		SELECT c.board_id FROM tasks t
		INNER JOIN columns c ON c.id = t.column_id
		WHERE t.id = $1::uuid
	`, taskID).Scan(&boardID)
	return boardID, err
}

func isBoardMember(ctx context.Context, tx pgx.Tx, boardID, userID string) (bool, error) {
	var ok bool
	err := tx.QueryRow(ctx, `
		SELECT public.is_board_member($1::uuid, $2::uuid)
	`, boardID, userID).Scan(&ok)
	return ok, err
}

func enrichTasksWithLabelsAndAssignees(ctx context.Context, tx pgx.Tx, columns []ColumnDTO) error {
	var taskIDs []uuid.UUID
	for ci := range columns {
		for ti := range columns[ci].Tasks {
			id, err := uuid.Parse(columns[ci].Tasks[ti].ID)
			if err != nil {
				continue
			}
			taskIDs = append(taskIDs, id)
		}
	}
	if len(taskIDs) == 0 {
		return nil
	}

	labelByTask := make(map[string][]LabelDTO)
	rows, err := tx.Query(ctx, `
		SELECT tl.task_id::text, l.id::text, l.name, l.color
		FROM task_labels tl
		INNER JOIN labels l ON l.id = tl.label_id
		WHERE tl.task_id = ANY($1::uuid[])
	`, taskIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var tid string
		var l LabelDTO
		if err := rows.Scan(&tid, &l.ID, &l.Name, &l.Color); err != nil {
			return err
		}
		labelByTask[tid] = append(labelByTask[tid], l)
	}

	assigneeByTask := make(map[string][]string)
	arows, err := tx.Query(ctx, `
		SELECT task_id::text, user_id::text
		FROM task_assignees
		WHERE task_id = ANY($1::uuid[])
		ORDER BY task_id ASC, created_at ASC
	`, taskIDs)
	if err != nil {
		return err
	}
	defer arows.Close()
	for arows.Next() {
		var tid, uid string
		if err := arows.Scan(&tid, &uid); err != nil {
			return err
		}
		assigneeByTask[tid] = append(assigneeByTask[tid], uid)
	}

	for ci := range columns {
		for ti := range columns[ci].Tasks {
			id := columns[ci].Tasks[ti].ID
			if ls, ok := labelByTask[id]; ok {
				columns[ci].Tasks[ti].Labels = ls
			} else {
				columns[ci].Tasks[ti].Labels = []LabelDTO{}
			}
			if as, ok := assigneeByTask[id]; ok {
				columns[ci].Tasks[ti].AssigneeIDs = as
			} else {
				columns[ci].Tasks[ti].AssigneeIDs = []string{}
			}
		}
	}
	return nil
}

func enrichTasksWithTeamAssignees(ctx context.Context, tx pgx.Tx, columns []ColumnDTO) error {
	var taskIDs []uuid.UUID
	for ci := range columns {
		for ti := range columns[ci].Tasks {
			id, err := uuid.Parse(columns[ci].Tasks[ti].ID)
			if err != nil {
				continue
			}
			taskIDs = append(taskIDs, id)
		}
	}
	if len(taskIDs) == 0 {
		return nil
	}

	teamByTask := make(map[string][]TeamMemberDTO)
	rows, err := tx.Query(ctx, `
		SELECT tta.task_id::text, tm.id::text, tm.board_id::text, tm.name, tm.color, tm.avatar_url
		FROM task_team_assignees tta
		INNER JOIN team_members tm ON tm.id = tta.team_member_id
		WHERE tta.task_id = ANY($1::uuid[])
		ORDER BY tta.task_id ASC, tta.created_at ASC
	`, taskIDs)
	if err != nil {
		var pgErr *pgconn.PgError
		// older schema: table may not exist yet
		if errors.As(err, &pgErr) && pgErr.Code == "42P01" {
			return nil
		}
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var tid string
		var m TeamMemberDTO
		if err := rows.Scan(&tid, &m.ID, &m.BoardID, &m.Name, &m.Color, &m.AvatarURL); err != nil {
			return err
		}
		teamByTask[tid] = append(teamByTask[tid], m)
	}

	for ci := range columns {
		for ti := range columns[ci].Tasks {
			id := columns[ci].Tasks[ti].ID
			if ms, ok := teamByTask[id]; ok {
				columns[ci].Tasks[ti].TeamAssignees = ms
			} else {
				columns[ci].Tasks[ti].TeamAssignees = []TeamMemberDTO{}
			}
		}
	}
	return nil
}
