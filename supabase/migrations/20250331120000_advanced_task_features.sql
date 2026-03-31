-- Advanced task features: labels, multi-assignees, comments, activity log

CREATE TABLE public.labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX labels_board_name_lower_idx ON public.labels (board_id, lower(name));
CREATE INDEX labels_board_id_idx ON public.labels (board_id);

CREATE TABLE public.task_labels (
  task_id UUID NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES public.labels (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, label_id)
);

CREATE INDEX task_labels_label_id_idx ON public.task_labels (label_id);

CREATE TABLE public.task_assignees (
  task_id UUID NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX task_assignees_user_id_idx ON public.task_assignees (user_id);

CREATE TABLE public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_comments_task_created_idx ON public.task_comments (task_id, created_at DESC);

CREATE TABLE public.task_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_activity_task_created_idx ON public.task_activity (task_id, created_at DESC);

-- Keep tasks.assignee_id in sync with first assignee (by created_at)
CREATE OR REPLACE FUNCTION public.sync_task_primary_assignee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tid UUID;
BEGIN
  tid := COALESCE(NEW.task_id, OLD.task_id);
  UPDATE public.tasks
  SET
    assignee_id = (
      SELECT ta.user_id
      FROM public.task_assignees ta
      WHERE ta.task_id = tid
      ORDER BY ta.created_at ASC
      LIMIT 1
    ),
    updated_at = now()
  WHERE id = tid;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER task_assignees_sync_primary
  AFTER INSERT OR DELETE OR UPDATE ON public.task_assignees
  FOR EACH ROW
  EXECUTE PROCEDURE public.sync_task_primary_assignee();

ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;

-- Labels: same board access as columns
CREATE POLICY labels_select ON public.labels
  FOR SELECT USING (public.can_access_board(board_id, auth.uid()));
CREATE POLICY labels_insert ON public.labels
  FOR INSERT WITH CHECK (public.can_access_board(board_id, auth.uid()));
CREATE POLICY labels_update ON public.labels
  FOR UPDATE USING (public.can_access_board(board_id, auth.uid()))
  WITH CHECK (public.can_access_board(board_id, auth.uid()));
CREATE POLICY labels_delete ON public.labels
  FOR DELETE USING (public.can_access_board(board_id, auth.uid()));

-- task_labels: via task -> column -> board
CREATE POLICY task_labels_select ON public.task_labels
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );
CREATE POLICY task_labels_insert ON public.task_labels
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );
CREATE POLICY task_labels_delete ON public.task_labels
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );

-- task_assignees: member of board; assignee must be board member (enforced in API + policy)
CREATE POLICY task_assignees_select ON public.task_assignees
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );
CREATE POLICY task_assignees_insert ON public.task_assignees
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
    AND public.is_board_member(
      (SELECT c2.board_id FROM public.tasks t2 INNER JOIN public.columns c2 ON c2.id = t2.column_id WHERE t2.id = task_id),
      user_id
    )
  );
CREATE POLICY task_assignees_delete ON public.task_assignees
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );

-- Comments
CREATE POLICY task_comments_select ON public.task_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );
CREATE POLICY task_comments_insert ON public.task_comments
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );
CREATE POLICY task_comments_delete ON public.task_comments
  FOR DELETE USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      INNER JOIN public.boards b ON b.id = c.board_id
      WHERE t.id = task_id AND b.owner_id = auth.uid()
    )
  );

-- Activity (read for members; insert typically by service — allow members to insert own audit rows)
CREATE POLICY task_activity_select ON public.task_activity
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );
CREATE POLICY task_activity_insert ON public.task_activity
  FOR INSERT WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;
ALTER TABLE public.task_comments REPLICA IDENTITY FULL;
