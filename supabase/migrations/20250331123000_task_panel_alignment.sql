-- Align task detail panel requirements (comments + activities)

-- 1) Comments: add required columns (keep existing author_id/body for backward compatibility)
ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS content TEXT;

UPDATE public.task_comments
SET
  user_id = COALESCE(user_id, author_id),
  content = COALESCE(content, body)
WHERE user_id IS NULL OR content IS NULL;

ALTER TABLE public.task_comments
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN content SET NOT NULL;

-- 2) Activities: create task_activities table (keep task_activity table for compatibility)
CREATE TABLE IF NOT EXISTS public.task_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_activities_task_created_idx ON public.task_activities (task_id, created_at DESC);

ALTER TABLE public.task_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_activities_select ON public.task_activities
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );

CREATE POLICY task_activities_insert ON public.task_activities
  FOR INSERT WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      INNER JOIN public.columns c ON c.id = t.column_id
      WHERE t.id = task_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );

