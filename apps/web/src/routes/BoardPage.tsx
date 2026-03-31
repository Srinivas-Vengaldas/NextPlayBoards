import KanbanBoard from "@/components/KanbanBoard";
import { api } from "@/lib/api";
import type { BoardMember, Priority, TeamMember } from "@nextplay/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

export default function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const id = boardId ?? "";
  const [searchTerm, setSearchTerm] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [leftTab, setLeftTab] = useState<"boards" | "insights">("boards");
  const [insightsOpen, setInsightsOpen] = useState(true);

  const q = useQuery({
    queryKey: ["board", id],
    queryFn: () => api.getBoard(id),
    enabled: Boolean(id),
  });

  const labelsQuery = useQuery({
    queryKey: ["boardLabels", id],
    queryFn: () => api.listBoardLabels(id),
    enabled: Boolean(id),
  });

  const membersQuery = useQuery({
    queryKey: ["boardMembers", id],
    queryFn: () => api.listBoardMembers(id),
    enabled: Boolean(id),
  });

  const teamMembersQuery = useQuery({
    queryKey: ["teamMembers", id],
    queryFn: () => api.listTeamMembers(id),
    enabled: Boolean(id),
  });

  const boardForUi = useMemo(() => {
    if (!q.data) return null;
    const required = ["To do", "In progress", "In review", "Done"];
    const sorted = [...q.data.columns].sort((a, b) => a.position - b.position);
    const used = new Set<string>();
    const selected = required.map((name, i) => {
      const exact = sorted.find((c) => !used.has(c.id) && c.title.toLowerCase() === name.toLowerCase());
      const picked = exact ?? sorted.find((c) => !used.has(c.id));
      if (picked) {
        used.add(picked.id);
        return {
          ...picked,
          title: name,
          position: (i + 1) * 1000,
        };
      }
      return null;
    });
    return {
      ...q.data,
      columns: selected.filter((c): c is NonNullable<typeof c> => Boolean(c)),
    };
  }, [q.data]);

  const members = useMemo<BoardMember[]>(() => {
    if (membersQuery.data && membersQuery.data.length > 0) return membersQuery.data;
    if (!boardForUi) return [];
    const ids = new Set<string>();
    ids.add(boardForUi.ownerId);
    for (const col of boardForUi.columns) {
      for (const task of col.tasks) {
        if (task.assigneeId) ids.add(task.assigneeId);
        for (const aid of task.assigneeIds ?? []) ids.add(aid);
      }
    }
    return [...ids].map((userId) => ({ userId, displayName: null, avatarUrl: null }));
  }, [boardForUi, membersQuery.data]);

  const teamMembers = useMemo<TeamMember[]>(() => {
    return teamMembersQuery.data ?? [];
  }, [teamMembersQuery.data]);

  const boardInsights = useMemo(() => {
    if (!boardForUi) return null;
    const tasks = boardForUi.columns.flatMap((c) => c.tasks);
    const total = tasks.length;
    const doneCount = boardForUi.columns.find((c) => c.title.toLowerCase() === "done")?.tasks.length ?? 0;
    const completePct = total === 0 ? 0 : Math.round((doneCount / total) * 100);
    const overdue = tasks.filter((t) => {
      if (!t.dueAt) return false;
      return new Date(t.dueAt).getTime() < Date.now();
    }).length;
    return { total, completePct, overdue };
  }, [boardForUi]);

  return (
    <div className="min-h-screen bg-[#0b0f14] text-slate-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-slate-800/80 bg-[#0a0d12] lg:block">
          <div className="border-b border-slate-800/80 px-4 py-4">
            <p className="text-xs uppercase tracking-widest text-slate-500">Workspace</p>
            <p className="mt-1 text-sm font-semibold text-slate-200">NextPlay Team</p>
          </div>
          <nav className="space-y-1 p-3 text-sm">
            <Link
              to="/"
              className="flex w-full items-center rounded-md px-3 py-2 text-left text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
            >
              Home
            </Link>
            <button
              type="button"
              onClick={() => setLeftTab("boards")}
              className={`flex w-full items-center rounded-md px-3 py-2 text-left transition ${
                leftTab === "boards"
                  ? "bg-blue-600/20 text-blue-300"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              }`}
            >
              Boards
            </button>
            <button
              type="button"
              onClick={() => setLeftTab("insights")}
              className={`flex w-full items-center rounded-md px-3 py-2 text-left transition ${
                leftTab === "insights"
                  ? "bg-blue-600/20 text-blue-300"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              }`}
            >
              Board Insights
            </button>
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-slate-800 bg-[#0b0f14]/95 backdrop-blur">
            <div className="mx-auto flex min-h-14 max-w-[140rem] items-center gap-3 px-4 py-2">
              <Link
                to="/"
                className="rounded-md bg-blue-600/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-300"
              >
                Boards
              </Link>

              {leftTab === "boards" ? (
                <div className="ml-2 flex flex-1 items-center gap-2">
                  <div className="relative w-full max-w-md">
                    <input
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search tasks…"
                      className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none ring-blue-500 focus:border-transparent focus:ring-2"
                    />
                  </div>

                  <select
                    value={assigneeFilter}
                    onChange={(e) => setAssigneeFilter(e.target.value)}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-sm text-slate-200"
                    title="Filter by assignee"
                  >
                    <option value="all">Assignee: All</option>
                    {(membersQuery.data ?? []).map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName ?? m.userId.slice(0, 8)}
                      </option>
                    ))}
                  </select>

                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value as Priority | "all")}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-sm text-slate-200"
                    title="Filter by priority"
                  >
                    <option value="all">Priority: All</option>
                    <option value="none">None</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>

                  <select
                    value={labelFilter}
                    onChange={(e) => setLabelFilter(e.target.value)}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-sm text-slate-200"
                    title="Filter by label"
                  >
                    <option value="all">Label: All</option>
                    {(labelsQuery.data ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm("");
                      setAssigneeFilter("all");
                      setPriorityFilter("all");
                      setLabelFilter("all");
                    }}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300 hover:bg-slate-900"
                  >
                    Clear
                  </button>

                  <button
                    type="button"
                    onClick={() => setInsightsOpen((v) => !v)}
                    className="ml-auto rounded-lg bg-blue-600/20 px-3 py-2 text-sm text-blue-200 hover:bg-blue-600/25"
                  >
                    {insightsOpen ? "Hide metrics" : "Show metrics"}
                  </button>
                </div>
              ) : null}
            </div>
          </header>

          <main className="mx-auto max-w-[140rem] px-4 py-4">
            {q.isLoading ? (
              <div className="grid gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={`col-sk-${i}`} className="h-72 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70" />
                ))}
              </div>
            ) : q.isError ? (
              <div className="rounded-xl border border-red-900/50 bg-red-950/40 p-6 text-center">
                <p className="font-medium text-red-300">Could not load this board.</p>
                <p className="mt-2 text-sm text-red-400/90">Check your API URL and session, then try again.</p>
                <button
                  type="button"
                  onClick={() => void q.refetch()}
                  className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
                >
                  Retry
                </button>
              </div>
            ) : boardForUi && leftTab === "boards" ? (
              <div className="relative">
                {insightsOpen ? (
                  <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Total</div>
                        <div className="mt-1 text-xl font-bold text-slate-100">{boardInsights?.total ?? 0}</div>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">% Complete</div>
                        <div className="mt-1 text-xl font-bold text-slate-100">{boardInsights?.completePct ?? 0}%</div>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Overdue</div>
                        <div className="mt-1 text-xl font-bold text-red-300">{boardInsights?.overdue ?? 0}</div>
                      </div>
                      <div className="flex-1" />
                      <div className="min-w-[220px]">
                        <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                          <span>Progress</span>
                          <span className="font-semibold text-slate-200">{boardInsights?.completePct ?? 0}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full bg-blue-500 transition-all duration-500"
                            style={{ width: `${boardInsights?.completePct ?? 0}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <KanbanBoard
                  board={boardForUi}
                  boardId={id}
                  searchTerm={searchTerm}
                  priorityFilter={priorityFilter}
                  labelFilter={labelFilter}
                  assigneeFilter={assigneeFilter}
                  members={members}
                  teamMembers={teamMembers}
                  boardLabels={labelsQuery.data ?? []}
                />
              </div>
            ) : boardForUi && leftTab === "insights" ? (
              <div className="mx-auto max-w-xl">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-sm">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Board Insights</h2>
                  <div className="mt-5 space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Progress</span>
                      <span className="font-bold text-slate-100">{boardInsights?.completePct ?? 0}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full bg-blue-500 transition-all duration-500"
                        style={{ width: `${boardInsights?.completePct ?? 0}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-sm pt-2">
                      <span className="text-slate-400">Overdue</span>
                      <span className="font-bold text-red-300">{boardInsights?.overdue ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Total tasks</span>
                      <span className="font-bold text-slate-100">{boardInsights?.total ?? 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
