import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import type {
  BoardDetail,
  BoardLabel,
  BoardMember,
  Priority,
  Task,
  TaskActivity,
  TaskComment,
  TaskLabel,
  TeamMember,
} from "@nextplay/shared";
import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Activity,
  CalendarClock,
  ChevronsUp,
  Clock3,
  GripVertical,
  Loader2,
  MessageSquare,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type BoardTask = Task;
type BoardColumn = BoardDetail["columns"][number];

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function dueBadge(task: BoardTask): "overdue" | "soon" | "none" {
  if (!task.dueAt) return "none";
  const due = new Date(task.dueAt).getTime();
  const now = Date.now();
  if (due < now) return "overdue";
  if (due - now <= 24 * 60 * 60 * 1000) return "soon";
  return "none";
}

function formatActivityLine(a: TaskActivity, membersById?: Map<string, BoardMember>): string {
  if (typeof a.message === "string" && a.message.trim()) {
    return a.message;
  }
  const actor = membersById?.get(a.actorId)?.displayName ?? a.actorId?.slice(0, 8) ?? "Someone";
  const meta = a.metadata ?? {};
  switch (a.actionType) {
    case "task_created":
      return `${actor} created this task`;
    case "moved":
      return `${actor} moved this to ${typeof meta.toColumn === "string" ? meta.toColumn : "a new column"}`;
    case "reordered":
      return `${actor} reordered this task`;
    case "title_updated":
      return `${actor} updated the title`;
    case "description_updated":
      return `${actor} updated the description`;
    case "priority_updated":
      return `${actor} changed priority to ${typeof meta.to === "string" ? meta.to : ""}`;
    case "due_updated":
      return `${actor} updated the due date`;
    case "assignee_updated":
      return `${actor} updated assignees`;
    case "comment_added":
      return `${actor} added a comment`;
    case "label_attached":
      return `${actor} attached a label`;
    case "label_detached":
      return `${actor} removed a label`;
    case "assignee_added":
      return `${actor} assigned a member`;
    case "assignee_removed":
      return `${actor} unassigned a member`;
    default:
      return a.actionType;
  }
}

function laneTone(title: string) {
  const t = title.toLowerCase();
  if (t.includes("to do")) return "border-slate-700 bg-slate-800/70 text-slate-200";
  if (t.includes("in progress")) return "border-blue-700/60 bg-blue-900/40 text-blue-200";
  if (t.includes("review")) return "border-amber-700/60 bg-amber-900/35 text-amber-200";
  if (t.includes("done")) return "border-emerald-700/60 bg-emerald-900/35 text-emerald-200";
  return "border-slate-700 bg-slate-800/70 text-slate-200";
}

const presetAvatarColors: string[] = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#a855f7", "#ec4899"];
const presetLabelColors: string[] = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#eab308", "#ef4444", "#14b8a6", "#64748b"];

function colorForUser(id: string) {
  let acc = 0;
  for (let i = 0; i < id.length; i++) acc = (acc * 31 + id.charCodeAt(i)) >>> 0;
  return presetAvatarColors[acc % presetAvatarColors.length]!;
}

function initials(name?: string | null) {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function startOfDayUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
}

function isoFromYmd(ymd: string): string {
  // ymd: YYYY-MM-DD
  return new Date(`${ymd}T12:00:00.000Z`).toISOString();
}

function ymdFromIso(iso: string): string {
  return iso.slice(0, 10);
}

function formatYmdForDisplay(ymd: string) {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function formatRelativeTime(iso: string) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffSec = Math.round((Date.now() - t) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return rtf.format(-diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, "minute");
  const diffHr = Math.round(diffSec / 3600);
  if (Math.abs(diffHr) < 24) return rtf.format(-diffHr, "hour");
  const diffDay = Math.round(diffSec / 86400);
  return rtf.format(-diffDay, "day");
}

function daysInMonth(year: number, month0: number) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function weekday0Sun(year: number, month0: number, day: number) {
  return new Date(Date.UTC(year, month0, day)).getUTCDay(); // 0..6, Sun..Sat
}

function CalendarPopover({
  anchorRef,
  open,
  valueYmd,
  onSelect,
  onClear,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  valueYmd: string | null;
  onSelect: (ymd: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement | null>(null);
  const [viewYear, setViewYear] = useState<number>(() => {
    const base = valueYmd ? new Date(`${valueYmd}T12:00:00.000Z`) : new Date();
    return base.getUTCFullYear();
  });
  const [viewMonth0, setViewMonth0] = useState<number>(() => {
    const base = valueYmd ? new Date(`${valueYmd}T12:00:00.000Z`) : new Date();
    return base.getUTCMonth();
  });

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (popRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [anchorRef, onClose, open]);

  useEffect(() => {
    if (!open) return;
    if (!valueYmd) return;
    const d = new Date(`${valueYmd}T12:00:00.000Z`);
    setViewYear(d.getUTCFullYear());
    setViewMonth0(d.getUTCMonth());
  }, [open, valueYmd]);

  if (!open) return null;

  const anchor = anchorRef.current;
  const rect = anchor?.getBoundingClientRect();
  const top = rect ? rect.bottom + 8 : 0;
  const left = rect ? Math.min(rect.left, window.innerWidth - 320) : 0;

  const dim = daysInMonth(viewYear, viewMonth0);
  const firstWd = weekday0Sun(viewYear, viewMonth0, 1);
  const cells: Array<{ ymd: string | null; label: string }> = [];
  for (let i = 0; i < firstWd; i++) cells.push({ ymd: null, label: "" });
  for (let day = 1; day <= dim; day++) {
    const y = String(viewYear).padStart(4, "0");
    const m = String(viewMonth0 + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    cells.push({ ymd: `${y}-${m}-${d}`, label: String(day) });
  }
  while (cells.length % 7 !== 0) cells.push({ ymd: null, label: "" });

  const monthName = new Date(Date.UTC(viewYear, viewMonth0, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayYmd = new Date().toISOString().slice(0, 10);

  return (
    <div
      ref={popRef}
      className="fixed z-[70] w-[320px] rounded-xl border border-slate-800 bg-slate-950 shadow-2xl"
      style={{ top, left }}
      role="dialog"
      aria-label="Choose due date"
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-900"
          onClick={() => {
            const m = viewMonth0 - 1;
            if (m < 0) {
              setViewMonth0(11);
              setViewYear((y) => y - 1);
            } else {
              setViewMonth0(m);
            }
          }}
        >
          Prev
        </button>
        <div className="text-sm font-semibold text-slate-100">{monthName}</div>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-900"
          onClick={() => {
            const m = viewMonth0 + 1;
            if (m > 11) {
              setViewMonth0(0);
              setViewYear((y) => y + 1);
            } else {
              setViewMonth0(m);
            }
          }}
        >
          Next
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 px-3 pb-2 pt-3 text-center text-[10px] text-slate-500">
        {["S", "M", "T", "W", "T", "F", "S"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 px-3 pb-3">
        {cells.map((c, idx) => {
          const selected = c.ymd && valueYmd === c.ymd;
          const isToday = c.ymd && c.ymd === todayYmd;
          return (
            <button
              key={`${c.ymd ?? "empty"}-${idx}`}
              type="button"
              disabled={!c.ymd}
              onClick={() => {
                if (!c.ymd) return;
                onSelect(c.ymd);
                onClose();
              }}
              className={`h-9 rounded-lg text-sm transition ${
                !c.ymd
                  ? "cursor-default"
                  : selected
                    ? "bg-blue-600 text-white"
                    : "text-slate-200 hover:bg-slate-900"
              } ${isToday && !selected ? "ring-1 ring-blue-500/40" : ""}`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-slate-800 px-3 py-2">
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-900"
          onClick={() => {
            onClear();
            onClose();
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          onClick={() => {
            const now = startOfDayUTC(new Date()).toISOString().slice(0, 10);
            onSelect(now);
            onClose();
          }}
        >
          Today
        </button>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  labels,
  assigneeIds,
  membersById,
  teamAssignees,
  dragging,
  onClick,
}: {
  task: BoardTask;
  labels: TaskLabel[];
  assigneeIds: string[];
  membersById: Map<string, BoardMember>;
  teamAssignees: { id: string; name: string; color: string; avatarUrl?: string | null }[];
  dragging?: boolean;
  onClick?: () => void;
}) {
  const due = dueBadge(task);
  const labelNames = labels.slice(0, 3);
  const avatars = [
    ...assigneeIds.map((id) => {
      const m = membersById.get(id);
      return {
        key: `u-${id}`,
        title: m?.displayName ?? id.slice(0, 8),
        initials: initials(m?.displayName),
        color: colorForUser(id),
      };
    }),
    ...(teamAssignees ?? []).map((tm) => ({
      key: `t-${tm.id}`,
      title: tm.name,
      initials: initials(tm.name),
      color: tm.color,
    })),
  ];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex w-full flex-col gap-2.5 rounded-xl border border-slate-800 bg-slate-900/80 p-4 text-left transition-all hover:border-slate-700 hover:shadow-lg ${
        dragging ? "cursor-grabbing border-blue-500 ring-2 ring-blue-500/20 shadow-xl" : "cursor-pointer"
      }`}
    >
      <span className="line-clamp-2 text-[13px] font-semibold leading-snug tracking-tight text-slate-100">
        {task.title}
      </span>

      {task.description ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-slate-400">{task.description}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {task.priority !== "none" ? (
          <span className="flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-300">
            {(task.priority === "high" || task.priority === "urgent") && <ChevronsUp className="h-2.5 w-2.5" />}
            {task.priority}
          </span>
        ) : null}
        {due === "soon" ? (
          <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
            Due soon
          </span>
        ) : null}
        {due === "overdue" ? (
          <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
            Overdue
          </span>
        ) : null}
        {labelNames.map((label) => (
          <span
            key={label.id}
            className="rounded-md border px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
            style={{ borderColor: label.color, backgroundColor: `${label.color}22` }}
          >
            {label.name}
          </span>
        ))}
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-slate-800 pt-3">
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          {task.dueAt ? (
            <span className={`flex items-center gap-1 ${due === "overdue" ? "font-medium text-red-300" : ""}`}>
              <Clock3 className="h-3 w-3" />
              {new Date(task.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          ) : null}
        </div>
        <div className="flex items-center">
          {avatars.length > 0 ? (
            <div className="flex -space-x-2">
              {avatars.slice(0, 4).map((a) => (
                <div
                  key={a.key}
                  title={a.title}
                  className="grid h-7 w-7 place-items-center rounded-full border border-slate-900 text-[10px] font-bold text-white"
                  style={{ backgroundColor: a.color }}
                >
                  {a.initials}
                </div>
              ))}
              {avatars.length > 4 ? (
                <div className="grid h-7 w-7 place-items-center rounded-full border border-slate-900 bg-slate-800 text-[10px] font-bold text-slate-200">
                  +{avatars.length - 4}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex -space-x-2">
              <div className="h-7 w-7 rounded-full border border-dashed border-slate-700 bg-slate-950/40" title="Unassigned" />
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function SortableTaskCard({
  task,
  labels,
  assigneeIds,
  membersById,
  onOpen,
}: {
  task: BoardTask;
  labels: TaskLabel[];
  assigneeIds: string[];
  membersById: Map<string, BoardMember>;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", task },
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="group relative w-full" {...attributes} {...listeners}>
      <TaskCard
        task={task}
        labels={labels}
        assigneeIds={assigneeIds}
        membersById={membersById}
        teamAssignees={(task.teamAssignees ?? []) as unknown as { id: string; name: string; color: string }[]}
        dragging={isDragging}
        onClick={() => onOpen(task.id)}
      />
      <button
        className="absolute right-2 top-2 rounded p-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:bg-slate-800 active:cursor-grabbing"
        type="button"
        tabIndex={-1}
      >
        <GripVertical className="h-4 w-4" />
      </button>
    </div>
  );
}

function ColumnDropZone({ columnId, children }: { columnId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[380px] flex-col gap-3 rounded-xl bg-slate-900/40 p-2 transition-all ${isOver ? "ring-1 ring-blue-500/40 shadow-inner" : ""}`}
    >
      {children}
    </div>
  );
}

export default function KanbanBoard({
  board,
  boardId,
  searchTerm,
  priorityFilter,
  labelFilter,
  assigneeFilter = "all",
  members,
  teamMembers,
  boardLabels,
}: {
  board: BoardDetail;
  boardId: string;
  searchTerm: string;
  priorityFilter: Priority | "all";
  labelFilter: string;
  assigneeFilter?: string;
  members: BoardMember[];
  teamMembers: TeamMember[];
  boardLabels: BoardLabel[];
}) {
  const [columnsState, setColumnsState] = useState<BoardColumn[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [newLabelName, setNewLabelName] = useState("");
  const [newComment, setNewComment] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [teamManageOpen, setTeamManageOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamColor, setNewTeamColor] = useState("#3b82f6");
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [draftTaskTitleByColumn, setDraftTaskTitleByColumn] = useState<Record<string, string>>({});
  const [composerOpenByColumn, setComposerOpenByColumn] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const dueAnchorRef = useRef<HTMLButtonElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    const sorted = [...board.columns].sort((a, b) => a.position - b.position);
    setColumnsState(sorted);
  }, [board]);

  const selectedTaskIsOptimistic = Boolean(selectedTaskId) && selectedTaskId!.startsWith("tmp-task");

  const commentsQuery = useQuery({
    queryKey: ["taskComments", selectedTaskId],
    queryFn: () => api.listTaskComments(selectedTaskId!),
    enabled: Boolean(selectedTaskId) && !selectedTaskIsOptimistic,
    refetchInterval: selectedTaskId ? 3500 : false,
  });

  const activityQuery = useQuery({
    queryKey: ["taskActivity", selectedTaskId],
    queryFn: () => api.listTaskActivity(selectedTaskId!),
    enabled: Boolean(selectedTaskId) && !selectedTaskIsOptimistic,
    refetchInterval: selectedTaskId ? 3500 : false,
  });

  const memberSearchQuery = useQuery({
    queryKey: ["boardMemberSearch", boardId, teamSearch],
    queryFn: () => api.searchBoardMembers(boardId, teamSearch.trim()),
    enabled: Boolean(teamSearch.trim()) && Boolean(boardId),
  });

  const addBoardMemberMutation = useMutation({
    mutationFn: (userId: string) => api.addBoardMember(boardId, { userId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["boardMembers", boardId] });
      setTeamSearch("");
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const createTeamMemberMutation = useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) => api.createTeamMember(boardId, { name, color }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["teamMembers", boardId] });
      setNewTeamName("");
      setNewTeamColor("#3b82f6");
    },
    onError: (err: Error) => setActionError(err.message),
  });

  // Task ↔ custom-team-member assignment hooks (used in follow-up UI polish)

  const taskPatch = useMutation({
    mutationFn: ({ taskId, payload }: { taskId: string; payload: Parameters<typeof api.patchTask>[1] }) =>
      api.patchTask(taskId, payload),
    onError: (err: Error) => {
      setActionError(err.message);
      void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
    },
  });

  const taskCreate = useMutation({
    mutationFn: ({ columnId, title }: { columnId: string; title: string }) =>
      api.createTask(columnId, { title, priority: "none", description: "" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
    },
    onError: (err: Error) => {
      setActionError(err.message);
      void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
    },
  });

  const createCommentMutation = useMutation({
    mutationFn: ({ taskId, content }: { taskId: string; content: string }) =>
      api.createTaskComment(taskId, { content }),
    onMutate: async ({ taskId, content }) => {
      await queryClient.cancelQueries({ queryKey: ["taskComments", taskId] });
      const prev = queryClient.getQueryData<TaskComment[]>(["taskComments", taskId]) ?? [];
      const temp: TaskComment = {
        id: `tmp-${Math.random().toString(36).slice(2, 10)}`,
        taskId,
        userId: members[0]?.userId ?? (membersById.keys().next().value ?? "00000000-0000-0000-0000-000000000000"),
        content,
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData(["taskComments", taskId], [...prev, temp]);
      return { prev, taskId };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["taskComments", selectedTaskId] });
      void queryClient.invalidateQueries({ queryKey: ["taskActivity", selectedTaskId] });
    },
    onError: (err: Error, _vars, ctx) => {
      setActionError(err.message);
      if (ctx?.taskId) {
        queryClient.setQueryData(["taskComments", ctx.taskId], ctx.prev ?? []);
      }
    },
  });

  const createBoardLabelMutation = useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) => api.createBoardLabel(boardId, { name, color }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["boardLabels", boardId] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const addTaskLabelMutation = useMutation({
    mutationFn: ({ taskId, labelId }: { taskId: string; labelId: string }) => api.addTaskLabel(taskId, labelId),
    onMutate: async ({ taskId, labelId }) => {
      setActionError(null);
      const label = boardLabels.find((l) => l.id === labelId);
      if (!label) return;
      const prevCols = columnsState;
      setColumnsState((prev) =>
        prev.map((col) => ({
          ...col,
          tasks: col.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  labels: [...(t.labels ?? []), { id: label.id, name: label.name, color: label.color }],
                }
              : t,
          ),
        })),
      );
      return { prevCols };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      void queryClient.invalidateQueries({ queryKey: ["taskActivity", selectedTaskId] });
    },
    onError: (err: Error, _vars, ctx) => {
      setActionError(err.message);
      if (ctx?.prevCols) setColumnsState(ctx.prevCols);
    },
  });

  const removeTaskLabelMutation = useMutation({
    mutationFn: ({ taskId, labelId }: { taskId: string; labelId: string }) => api.removeTaskLabel(taskId, labelId),
    onMutate: async ({ taskId, labelId }) => {
      setActionError(null);
      const prevCols = columnsState;
      setColumnsState((prev) =>
        prev.map((col) => ({
          ...col,
          tasks: col.tasks.map((t) =>
            t.id === taskId ? { ...t, labels: (t.labels ?? []).filter((l) => l.id !== labelId) } : t,
          ),
        })),
      );
      return { prevCols };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      void queryClient.invalidateQueries({ queryKey: ["taskActivity", selectedTaskId] });
    },
    onError: (err: Error, _vars, ctx) => {
      setActionError(err.message);
      if (ctx?.prevCols) setColumnsState(ctx.prevCols);
    },
  });

  const addAssigneeMutation = useMutation({
    mutationFn: ({ taskId, userId }: { taskId: string; userId: string }) => api.addTaskAssignee(taskId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      void queryClient.invalidateQueries({ queryKey: ["taskActivity", selectedTaskId] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const removeAssigneeMutation = useMutation({
    mutationFn: ({ taskId, userId }: { taskId: string; userId: string }) => api.removeTaskAssignee(taskId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      void queryClient.invalidateQueries({ queryKey: ["taskActivity", selectedTaskId] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  function getTaskById(taskId: string) {
    for (const col of columnsState) {
      const found = col.tasks.find((t) => t.id === taskId);
      if (found) return { task: found, column: col };
    }
    return null;
  }

  function taskLabels(task: BoardTask): TaskLabel[] {
    return task.labels ?? [];
  }

  function getFilteredTasks(col: BoardColumn) {
    return col.tasks.filter((task) => {
      const text = `${task.title} ${task.description}`.toLowerCase();
      const matchesSearch = !searchTerm?.trim() || text.includes(searchTerm.toLowerCase());
      const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
      const matchesLabel =
        labelFilter === "all" ||
        (task.labels ?? []).some(
          (l) => l.id === labelFilter || l.name.toLowerCase() === labelFilter.toLowerCase(),
        );
      const matchesAssignee =
        assigneeFilter === "all" ||
        (task.assigneeIds ?? []).includes(assigneeFilter) ||
        (assigneeFilter !== "all" && task.assigneeId === assigneeFilter);
      return matchesSearch && matchesPriority && matchesLabel && matchesAssignee;
    });
  }

  function updateTaskLocal(taskId: string, updater: (task: BoardTask) => BoardTask) {
    setColumnsState((prev) =>
      prev.map((col) => ({
        ...col,
        tasks: col.tasks.map((task) => (task.id === taskId ? updater(task) : task)),
      })),
    );
  }

  function createTaskInColumn(columnId: string) {
    const title = (draftTaskTitleByColumn[columnId] ?? "").trim();
    if (!title) return;

    const tempId = uid("tmp-task");
    const createdAt = new Date().toISOString();
    const maxPosition =
      columnsState.find((c) => c.id === columnId)?.tasks.reduce((max, task) => Math.max(max, task.position), -1) ?? -1;
    const optimisticTask: BoardTask = {
      id: tempId,
      columnId,
      title,
      description: "",
      position: maxPosition + 1000,
      assigneeId: null,
      assigneeIds: [],
      labels: [],
      dueAt: null,
      priority: "none",
      createdAt,
      updatedAt: createdAt,
    };

    setColumnsState((prev) =>
      prev.map((col) => (col.id === columnId ? { ...col, tasks: [...col.tasks, optimisticTask] } : col)),
    );
    setDraftTaskTitleByColumn((prev) => ({ ...prev, [columnId]: "" }));
    setComposerOpenByColumn((prev) => ({ ...prev, [columnId]: false }));

    void taskCreate.mutate({ columnId, title });
  }

  const anyFiltersActive = Boolean(searchTerm?.trim()) || priorityFilter !== "all" || labelFilter !== "all" || assigneeFilter !== "all";
  const totalTasks = useMemo(() => columnsState.reduce((acc, c) => acc + c.tasks.length, 0), [columnsState]);
  const totalFilteredTasks = useMemo(
    () => columnsState.reduce((acc, c) => acc + getFilteredTasks(c).length, 0),
    [columnsState, searchTerm, priorityFilter, labelFilter, assigneeFilter],
  );

  function handleDragStart() {
    setActionError(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = event.active.id as string;
    const overId = event.over?.id as string | undefined;
    if (!overId) return;

    const source = getTaskById(activeId);
    if (!source) return;

    const overTask = getTaskById(overId);
    const destinationColumnId = overTask ? overTask.column.id : overId;
    const destinationColumn = columnsState.find((c) => c.id === destinationColumnId);
    if (!destinationColumn) return;

    let insertIndex = 0;
    const destinationColumnIdFinal = destinationColumn.id;

    setColumnsState((prev) => {
      const cols = prev.map((c) => ({ ...c, tasks: [...c.tasks] }));
      const from = cols.find((c) => c.id === source.column.id);
      const to = cols.find((c) => c.id === destinationColumn.id);
      if (!from || !to) return prev;

      const fromIndex = from.tasks.findIndex((t) => t.id === activeId);
      if (fromIndex < 0) return prev;
      const [moved] = from.tasks.splice(fromIndex, 1);
      moved.columnId = to.id;

      const overIndex = to.tasks.findIndex((t) => t.id === overId);
      insertIndex = overIndex >= 0 ? overIndex : to.tasks.length;
      to.tasks.splice(insertIndex, 0, moved);

      for (const col of cols) {
        col.tasks = col.tasks.map((task, idx) => ({ ...task, position: (idx + 1) * 1000 }));
      }
      return cols;
    });

    const newPosition = (insertIndex + 1) * 1000;
    void taskPatch.mutate({
      taskId: activeId,
      payload: {
        columnId: destinationColumnIdFinal,
        position: newPosition,
      },
    });
  }

  const selected = selectedTaskId ? getTaskById(selectedTaskId) : null;
  const membersById = useMemo(() => {
    const m = new Map<string, BoardMember>();
    for (const mem of members ?? []) {
      m.set(mem.userId, mem);
    }
    return m;
  }, [members]);

  // teamMembersById reserved for richer team-assignee UI

  const selectedAssigneeIds = selected?.task.assigneeIds ?? (selected?.task.assigneeId ? [selected.task.assigneeId] : []);

  return (
    <div className="relative flex h-full min-h-[calc(100vh-8rem)] gap-6 overflow-x-auto pb-8">
      {actionError ? (
        <div className="fixed bottom-4 left-1/2 z-[60] flex max-w-lg -translate-x-1/2 items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/90 px-4 py-2 text-sm text-red-200 shadow-lg">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {actionError}
          <button type="button" className="ml-2 text-slate-400 hover:text-white" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {anyFiltersActive && totalTasks > 0 && totalFilteredTasks === 0 ? (
        <div className="absolute left-0 top-0 z-[5] w-full">
          <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-slate-900 p-2 text-slate-300">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">No results</p>
                <p className="mt-1 text-xs text-slate-500">Try clearing filters or searching for a different keyword.</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {columnsState.map((col) => {
          const filtered = getFilteredTasks(col);
          return (
            <div key={col.id} className="flex w-[340px] shrink-0 flex-col gap-4">
              <div className="flex items-center justify-between px-1">
                <div className={`flex items-center gap-2 rounded-md border px-2 py-1 ${laneTone(col.title)}`}>
                  <h3 className="text-xs font-bold uppercase tracking-wide">{col.title}</h3>
                  <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-bold">
                    {filtered.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setComposerOpenByColumn((prev) => ({ ...prev, [col.id]: !prev[col.id] }))}
                  className="rounded-md p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
                  aria-label={`Create task in ${col.title}`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {composerOpenByColumn[col.id] ? (
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2">
                  <input
                    value={draftTaskTitleByColumn[col.id] ?? ""}
                    onChange={(e) => setDraftTaskTitleByColumn((prev) => ({ ...prev, [col.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        createTaskInColumn(col.id);
                      }
                      if (e.key === "Escape") {
                        setComposerOpenByColumn((prev) => ({ ...prev, [col.id]: false }));
                      }
                    }}
                    placeholder="Task title"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-500 focus:border-transparent focus:ring-2"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setComposerOpenByColumn((prev) => ({ ...prev, [col.id]: false }))}
                      className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={taskCreate.isPending}
                      onClick={() => createTaskInColumn(col.id)}
                      className="rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Create
                    </button>
                  </div>
                </div>
              ) : null}

              <SortableContext items={filtered.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <ColumnDropZone columnId={col.id}>
                  {filtered.map((task) => (
                    <SortableTaskCard
                      key={task.id}
                      task={task}
                      labels={taskLabels(task)}
                      assigneeIds={task.assigneeIds ?? (task.assigneeId ? [task.assigneeId] : [])}
                      membersById={membersById}
                      onOpen={setSelectedTaskId}
                    />
                  ))}
                  {filtered.length === 0 && (
                    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 p-8 text-center">
                      <Sparkles className="mb-2 h-4 w-4 text-slate-600" />
                      <p className="text-xs font-semibold text-slate-400">No tasks yet</p>
                      <p className="mt-1 text-[11px] text-slate-600">Create your first task for this column.</p>
                      <button
                        type="button"
                        onClick={() => setComposerOpenByColumn((prev) => ({ ...prev, [col.id]: true }))}
                        className="mt-3 rounded-md bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700"
                      >
                        New task
                      </button>
                    </div>
                  )}
                  {col.tasks.length > 0 && filtered.length === 0 && (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 text-center text-xs text-slate-500">
                      No tasks match current filters.
                    </div>
                  )}
                </ColumnDropZone>
              </SortableContext>
            </div>
          );
        })}
      </DndContext>

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedTaskId(null);
            }
          }}
          role="presentation"
        >
          <div
            className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-6"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Task detail panel"
          >
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">{selected.task.title}</h3>
                <p className="mt-1 text-xs text-slate-400">Task details, comments, and activity</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTaskId(null)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-6">
              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Metadata</h4>
                <div className="space-y-3">
                  <textarea
                    value={selected.task.description}
                    onChange={(e) => {
                      const value = e.target.value;
                      updateTaskLocal(selected.task.id, (task) => ({ ...task, description: value }));
                    }}
                    onBlur={() => {
                      void taskPatch.mutate({ taskId: selected.task.id, payload: { description: selected.task.description } });
                      void queryClient.invalidateQueries({ queryKey: ["taskActivity", selected.task.id] });
                    }}
                    rows={3}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none ring-blue-500 focus:border-transparent focus:ring-2"
                    placeholder="Add details..."
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={selected.task.priority}
                      onChange={(e) => {
                        const value = e.target.value as Priority;
                        updateTaskLocal(selected.task.id, (task) => ({ ...task, priority: value }));
                        void taskPatch.mutate({ taskId: selected.task.id, payload: { priority: value } });
                        void queryClient.invalidateQueries({ queryKey: ["taskActivity", selected.task.id] });
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-200"
                    >
                      <option value="none">None</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                    <div className="relative">
                      <CalendarClock className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-500" />
                      <button
                        ref={dueAnchorRef}
                        type="button"
                        onClick={() => setDuePickerOpen((v) => !v)}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-950 py-2 pl-8 pr-2 text-sm text-slate-200 hover:border-slate-600"
                      >
                        <span className={selected.task.dueAt ? "text-slate-200" : "text-slate-500"}>
                          {selected.task.dueAt ? formatYmdForDisplay(ymdFromIso(selected.task.dueAt)) : "Set due date"}
                        </span>
                        <span className="text-xs text-slate-500">▼</span>
                      </button>
                      <CalendarPopover
                        anchorRef={dueAnchorRef}
                        open={duePickerOpen}
                        valueYmd={selected.task.dueAt ? ymdFromIso(selected.task.dueAt) : null}
                        onSelect={(ymd) => {
                          const iso = isoFromYmd(ymd);
                          updateTaskLocal(selected.task.id, (task) => ({ ...task, dueAt: iso }));
                          void taskPatch.mutate({ taskId: selected.task.id, payload: { dueAt: iso } });
                          void queryClient.invalidateQueries({ queryKey: ["taskActivity", selected.task.id] });
                        }}
                        onClear={() => {
                          updateTaskLocal(selected.task.id, (task) => ({ ...task, dueAt: null }));
                          void taskPatch.mutate({ taskId: selected.task.id, payload: { dueAt: null } });
                          void queryClient.invalidateQueries({ queryKey: ["taskActivity", selected.task.id] });
                        }}
                        onClose={() => setDuePickerOpen(false)}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Labels</h4>
                <div className="mb-3 flex flex-wrap gap-2">
                  {(selected.task.labels ?? []).map((label) => (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        removeTaskLabelMutation.mutate({ taskId: selected.task.id, labelId: label.id });
                      }}
                      className="rounded-full border px-2 py-1 text-xs text-slate-200 transition hover:opacity-90"
                      style={{ borderColor: label.color, backgroundColor: `${label.color}22` }}
                    >
                      {label.name} ×
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    placeholder="New label name"
                    className="min-w-[120px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  />
                  <select
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-300"
                    defaultValue=""
                    onChange={(e) => {
                      const labelId = e.target.value;
                      if (!labelId) return;
                      e.target.value = "";
                      addTaskLabelMutation.mutate({ taskId: selected.task.id, labelId });
                    }}
                  >
                    <option value="">Attach existing…</option>
                    {boardLabels
                      .filter((bl) => !(selected.task.labels ?? []).some((l) => l.id === bl.id))
                      .map((bl) => (
                        <option key={bl.id} value={bl.id}>
                          {bl.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {presetLabelColors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="h-6 w-6 rounded-full border border-slate-700"
                      style={{ backgroundColor: c }}
                      title={c}
                      onClick={() => {
                        const name = newLabelName.trim() || "Label";
                        createBoardLabelMutation.mutate(
                          { name, color: c },
                          {
                            onSuccess: async (res) => {
                              await api.addTaskLabel(selected.task.id, res.id);
                              void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
                              void queryClient.invalidateQueries({ queryKey: ["boardLabels", boardId] });
                              void queryClient.invalidateQueries({ queryKey: ["taskActivity", selected.task.id] });
                              setNewLabelName("");
                            },
                          },
                        );
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!newLabelName.trim() || createBoardLabelMutation.isPending}
                  onClick={() => {
                    const name = newLabelName.trim();
                    if (!name) return;
                    createBoardLabelMutation.mutate(
                      { name, color: "#3b82f6" },
                      {
                        onSuccess: async (res) => {
                          await api.addTaskLabel(selected.task.id, res.id);
                          void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
                          void queryClient.invalidateQueries({ queryKey: ["boardLabels", boardId] });
                          void queryClient.invalidateQueries({ queryKey: ["taskActivity", selected.task.id] });
                          setNewLabelName("");
                        },
                      },
                    );
                  }}
                  className="mt-2 w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Create & attach label
                </button>
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Team</h4>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setTeamManageOpen(true)}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
                    >
                      Team management
                    </button>
                    <span className="text-xs text-slate-500">Create custom members and assign them</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={teamSearch}
                      onChange={(e) => setTeamSearch(e.target.value)}
                      placeholder="Search by email or userId…"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                    />
                  </div>

                  {teamSearch.trim() ? (
                    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                      {memberSearchQuery.isLoading ? (
                        <div className="flex items-center gap-2 p-2 text-sm text-slate-500">
                          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                        </div>
                      ) : (memberSearchQuery.data ?? []).length === 0 ? (
                        <div className="p-2 text-sm text-slate-400">No users found.</div>
                      ) : (
                        <div className="space-y-1">
                          {(memberSearchQuery.data ?? []).map((cand) => {
                            const already = (members ?? []).some((m) => m.userId === cand.userId);
                            const name = (cand.displayName ?? "").trim() || (cand.email ?? "") || cand.userId.slice(0, 8);
                            return (
                              <div
                                key={cand.userId}
                                className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950 px-2 py-2"
                              >
                                <div className="min-w-0 flex items-center gap-2">
                                  <span
                                    className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold text-white"
                                    style={{ backgroundColor: colorForUser(cand.userId) }}
                                  >
                                    {initials(cand.displayName)}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="truncate text-sm text-slate-200">{name}</div>
                                    <div className="truncate text-[11px] text-slate-500">{cand.userId}</div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={already || addBoardMemberMutation.isPending}
                                  onClick={() => addBoardMemberMutation.mutate(cand.userId)}
                                  className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                                >
                                  {already ? "Added" : "Add"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {(members ?? []).length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
                      No team members added yet.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(members ?? []).map((m) => {
                    const memberId = m.userId;
                    const selectedMember = selectedAssigneeIds.includes(memberId);
                    const name = (m.displayName ?? "").trim() || memberId.slice(0, 8);
                    return (
                      <button
                        key={memberId}
                        type="button"
                        onClick={() => {
                          setActionError(null);
                          if (selectedMember) {
                            removeAssigneeMutation.mutate({ taskId: selected.task.id, userId: memberId });
                          } else {
                            addAssigneeMutation.mutate({ taskId: selected.task.id, userId: memberId });
                          }
                        }}
                        className={`rounded-full border px-3 py-1 text-xs ${
                          selectedMember
                            ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                            : "border-slate-700 bg-slate-950 text-slate-300"
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white"
                            style={{ backgroundColor: colorForUser(memberId) }}
                          >
                            {initials(m.displayName)}
                          </span>
                          <span className="max-w-[180px] truncate">{name}</span>
                        </span>
                      </button>
                    );
                      })}
                    </div>
                  )}
                </div>
              </section>

              {teamManageOpen ? (
                <div
                  className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
                  role="presentation"
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) setTeamManageOpen(false);
                  }}
                >
                  <div
                    className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl"
                    role="dialog"
                    aria-label="Team management"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">Team Management</h3>
                        <p className="mt-1 text-sm text-slate-300">Create a custom member (name + color).</p>
                      </div>
                      <button
                        type="button"
                        className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        onClick={() => setTeamManageOpen(false)}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      <input
                        value={newTeamName}
                        onChange={(e) => setNewTeamName(e.target.value)}
                        placeholder="Member name"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                      />

                      <div className="flex flex-wrap gap-2">
                        {presetLabelColors.map((c) => (
                          <button
                            key={`tmc-${c}`}
                            type="button"
                            className={`h-7 w-7 rounded-full border ${newTeamColor === c ? "border-white/70" : "border-slate-700"}`}
                            style={{ backgroundColor: c }}
                            onClick={() => setNewTeamColor(c)}
                            title={c}
                          />
                        ))}
                      </div>

                      <button
                        type="button"
                        disabled={!newTeamName.trim() || createTeamMemberMutation.isPending}
                        onClick={() => createTeamMemberMutation.mutate({ name: newTeamName.trim(), color: newTeamColor })}
                        className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {createTeamMemberMutation.isPending ? "Creating…" : "Create member"}
                      </button>

                      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Custom members</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(teamMembers ?? []).length === 0 ? (
                            <div className="text-sm text-slate-500">No custom members yet.</div>
                          ) : (
                            (teamMembers ?? []).map((tm) => (
                              <div
                                key={tm.id}
                                className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200"
                                title={tm.id}
                              >
                                <span
                                  className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white"
                                  style={{ backgroundColor: tm.color }}
                                >
                                  {initials(tm.name)}
                                </span>
                                <span className="max-w-[180px] truncate">{tm.name}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Comments</h4>
                {commentsQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : commentsQuery.isError ? (
                  <p className="text-sm text-red-400">Could not load comments.</p>
                ) : (commentsQuery.data ?? []).length === 0 ? (
                  <div className="mb-3 flex items-start gap-3 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-4">
                    <div className="mt-0.5 rounded-lg bg-slate-900 p-2 text-slate-300">
                      <MessageSquare className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-200">No comments yet</p>
                      <p className="mt-1 text-xs text-slate-500">Post the first update to start the conversation.</p>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3 max-h-48 space-y-2 overflow-y-auto">
                    {(commentsQuery.data ?? []).map((c: TaskComment) => (
                      <div key={c.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                        <p className="text-xs text-slate-200">{c.content}</p>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {(membersById.get(c.userId)?.displayName ?? c.userId.slice(0, 8))} ·{" "}
                          {new Date(c.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Write a comment…"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        const msg = newComment.trim();
                        if (!msg) return;
                        createCommentMutation.mutate({ taskId: selected.task.id, content: msg });
                        setNewComment("");
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={createCommentMutation.isPending || !newComment.trim()}
                    onClick={() => {
                      const msg = newComment.trim();
                      if (!msg) return;
                      createCommentMutation.mutate({ taskId: selected.task.id, content: msg });
                      setNewComment("");
                    }}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Post
                  </button>
                </div>
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Activity</h4>
                {activityQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : activityQuery.isError ? (
                  <p className="text-sm text-red-400">Could not load activity.</p>
                ) : (activityQuery.data ?? []).length === 0 ? (
                  <div className="flex items-start gap-3 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-4">
                    <div className="mt-0.5 rounded-lg bg-slate-900 p-2 text-slate-300">
                      <Activity className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-200">No activity yet</p>
                      <p className="mt-1 text-xs text-slate-500">Moves, priority changes, labels, and comments will show up here.</p>
                    </div>
                  </div>
                ) : (
                  <div className="max-h-64 space-y-3 overflow-y-auto">
                    {(activityQuery.data ?? []).map((entry: TaskActivity) => (
                      <div key={entry.id} className="border-l border-slate-700 pl-3">
                        <p className="text-xs text-slate-300">{formatActivityLine(entry, membersById)}</p>
                        <p className="mt-1 text-[10px] text-slate-500">{formatRelativeTime(entry.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
