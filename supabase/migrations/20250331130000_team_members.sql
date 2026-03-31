-- Custom team members (non-auth) per board

CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS team_members_board_name_lower_idx ON public.team_members (board_id, lower(name));
CREATE INDEX IF NOT EXISTS team_members_board_id_idx ON public.team_members (board_id);

CREATE TABLE IF NOT EXISTS public.task_team_assignees (
  task_id UUID NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES public.team_members (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, team_member_id)
);

CREATE INDEX IF NOT EXISTS task_team_assignees_member_idx ON public.task_team_assignees (team_member_id);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_team_assignees ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_members_select ON public.team_members
  FOR SELECT USING (public.can_access_board(board_id, auth.uid()));
CREATE POLICY team_members_insert ON public.team_members
  FOR INSERT WITH CHECK (public.can_access_board(board_id, auth.uid()));
CREATE POLICY team_members_update ON public.team_members
  FOR UPDATE USING (public.can_access_board(board_id, auth.uid()))
  WITH CHECK (public.can_access_board(board_id, auth.uid()));
CREATE POLICY team_members_delete ON public.team_members
  FOR DELETE USING (public.can_access_board(board_id, auth.uid()));

CREATE POLICY task_team_assignees_select ON public.task_team_assignees
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );
CREATE POLICY task_team_assignees_insert ON public.task_team_assignees
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );
CREATE POLICY task_team_assignees_delete ON public.task_team_assignees
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );

