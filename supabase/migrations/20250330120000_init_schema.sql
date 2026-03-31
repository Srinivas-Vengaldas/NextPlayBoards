-- NextPlay Kanban: core schema, RLS, optional Realtime

-- Profiles (1:1 with auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.board_members (
  board_id UUID NOT NULL REFERENCES public.boards (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);

CREATE TABLE public.columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX columns_board_position_idx ON public.columns (board_id, position);

CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  column_id UUID NOT NULL REFERENCES public.columns (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  assignee_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'none' CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tasks_column_position_idx ON public.tasks (column_id, position);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Helpers for RLS
CREATE OR REPLACE FUNCTION public.is_board_member(p_board_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.board_members bm
    WHERE bm.board_id = p_board_id AND bm.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_board(p_board_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.boards b
    WHERE b.id = p_board_id AND b.owner_id = p_user_id
  )
  OR public.is_board_member(p_board_id, p_user_id);
$$;

-- Enabling RLS and policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Profiles: users read/update own row
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Boards: members can read/update; insert if owner_id = auth.uid()
CREATE POLICY boards_select_member ON public.boards
  FOR SELECT USING (public.can_access_board(id, auth.uid()));
CREATE POLICY boards_insert_owner ON public.boards
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY boards_update_member ON public.boards
  FOR UPDATE USING (
    public.can_access_board(id, auth.uid())
    AND (
      owner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.board_members bm
        WHERE bm.board_id = boards.id AND bm.user_id = auth.uid() AND bm.role IN ('owner', 'admin')
      )
    )
  );
CREATE POLICY boards_delete_owner ON public.boards
  FOR DELETE USING (owner_id = auth.uid());

-- Board members
CREATE POLICY board_members_select ON public.board_members
  FOR SELECT USING (public.can_access_board(board_id, auth.uid()));
CREATE POLICY board_members_insert ON public.board_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_id AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.board_members bm
      WHERE bm.board_id = board_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin')
    )
  );
CREATE POLICY board_members_delete ON public.board_members
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_id AND b.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.board_members bm
      WHERE bm.board_id = board_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin')
    )
  );

-- Columns: board owner or members
CREATE POLICY columns_select ON public.columns
  FOR SELECT USING (public.can_access_board(board_id, auth.uid()));
CREATE POLICY columns_all ON public.columns
  FOR ALL USING (public.can_access_board(board_id, auth.uid()))
  WITH CHECK (public.can_access_board(board_id, auth.uid()));

-- Tasks: member of board that owns the column
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.columns c
      WHERE c.id = column_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );
CREATE POLICY tasks_all ON public.tasks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.columns c
      WHERE c.id = column_id AND public.can_access_board(c.board_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.columns c
      WHERE c.id = column_id AND public.can_access_board(c.board_id, auth.uid())
    )
  );

-- Realtime (optional)
ALTER PUBLICATION supabase_realtime ADD TABLE public.columns;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER TABLE public.columns REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
