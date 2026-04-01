import type { z } from "zod";
import {
  boardDetailSchema,
  boardLabelSchema,
  boardMemberSchema,
  boardMemberSearchSchema,
  addBoardMemberBodySchema,
  teamMemberSchema,
  createTeamMemberBodySchema,
  addTaskTeamMemberBodySchema,
  boardSummarySchema,
  createBoardBodySchema,
  createBoardLabelBodySchema,
  createColumnBodySchema,
  createTaskBodySchema,
  createTaskCommentBodySchema,
  patchColumnBodySchema,
  patchTaskBodySchema,
  taskActivitySchema,
  taskCommentSchema,
  taskSchema,
  type BoardMemberSearch,
  type BoardMember,
  type TeamMember,
  type BoardDetail,
  type BoardLabel,
  type BoardSummary,
  type TaskActivity,
  type TaskComment,
  type Task,
} from "./schemas.js";

export type GetToken = () => Promise<string | null> | string | null;

/** Static base or a function evaluated on each request (e.g. same-origin `/api` fixes in the browser). */
export type ApiBaseUrl = string | (() => string);

function resolveRoot(baseUrl: ApiBaseUrl): string {
  const b = typeof baseUrl === "function" ? baseUrl() : baseUrl;
  return b.replace(/\/$/, "");
}

export type CreateBoardBody = z.infer<typeof createBoardBodySchema>;
export type CreateColumnBody = z.infer<typeof createColumnBodySchema>;
export type PatchColumnBody = z.infer<typeof patchColumnBodySchema>;
export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;
export type PatchTaskBody = z.infer<typeof patchTaskBodySchema>;
export type CreateBoardLabelBody = z.infer<typeof createBoardLabelBodySchema>;
export type CreateTaskCommentBody = z.infer<typeof createTaskCommentBodySchema>;
export type AddBoardMemberBody = z.infer<typeof addBoardMemberBodySchema>;
export type CreateTeamMemberBody = z.infer<typeof createTeamMemberBodySchema>;
export type AddTaskTeamMemberBody = z.infer<typeof addTaskTeamMemberBodySchema>;

async function authHeader(getToken: GetToken): Promise<HeadersInit> {
  const token = await getToken();
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

async function readJson<T>(res: Response, parse: (data: unknown) => T): Promise<T> {
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data && typeof (data as { error: string }).error === "string"
        ? (data as { error: string }).error
        : res.statusText;
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return parse(data);
}

export function createApiClient(baseUrl: ApiBaseUrl, getToken: GetToken) {
  const root = () => resolveRoot(baseUrl);

  return {
    async listBoards(): Promise<BoardSummary[]> {
      const res = await fetch(`${root()}/boards`, {
        headers: await authHeader(getToken),
        cache: "no-store",
      });
      const data = await readJson(res, (d) => d);
      if (!Array.isArray(data)) {
        throw new Error("Expected array");
      }
      return data.map((item) => boardSummarySchema.parse(normalizeDates(item)));
    },

    async createBoard(body: CreateBoardBody): Promise<{ id: string }> {
      const res = await fetch(`${root()}/boards`, {
        method: "POST",
        headers: await authHeader(getToken),
        body: JSON.stringify(body),
      });
      return readJson(res, (d) => {
        const o = d as Record<string, unknown>;
        if (!o?.id || typeof o.id !== "string") {
          throw new Error("Invalid response");
        }
        return { id: o.id };
      });
    },

    async getBoard(id: string): Promise<BoardDetail> {
      const res = await fetch(`${root()}/boards/${encodeURIComponent(id)}`, {
        headers: await authHeader(getToken),
      });
      const data = await readJson(res, (d) => d);
      return boardDetailSchema.parse(normalizeDates(normalizeBoardDetailTasks(data)));
    },

    async createColumn(boardId: string, body: CreateColumnBody): Promise<{ id: string }> {
      const res = await fetch(`${root()}/boards/${encodeURIComponent(boardId)}/columns`, {
        method: "POST",
        headers: await authHeader(getToken),
        body: JSON.stringify(body),
      });
      return readJson(res, (d) => {
        const o = d as Record<string, unknown>;
        if (!o?.id || typeof o.id !== "string") {
          throw new Error("Invalid response");
        }
        return { id: o.id };
      });
    },

    async patchColumn(columnId: string, body: PatchColumnBody): Promise<void> {
      const res = await fetch(`${root()}/columns/${encodeURIComponent(columnId)}`, {
        method: "PATCH",
        headers: await authHeader(getToken),
        body: JSON.stringify(body),
      });
      await readJson(res, () => undefined);
    },

    async createTask(columnId: string, body: CreateTaskBody): Promise<Task> {
      const res = await fetch(`${root()}/columns/${encodeURIComponent(columnId)}/tasks`, {
        method: "POST",
        headers: await authHeader(getToken),
        body: JSON.stringify(body),
      });
      return readJson(res, (d) => taskSchema.parse(normalizeDates(d)));
    },

    async patchTask(taskId: string, body: PatchTaskBody): Promise<void> {
      const res = await fetch(`${root()}/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: await authHeader(getToken),
        body: JSON.stringify(body),
      });
      await readJson(res, () => undefined);
    },

    async listBoardLabels(boardId: string): Promise<BoardLabel[]> {
      const res = await fetch(`${root()}/boards/${encodeURIComponent(boardId)}/labels`, {
        headers: await authHeader(getToken),
      });
      const data = await readJson(res, (d) => d);
      if (!Array.isArray(data)) {
        throw new Error("Expected array");
      }
      return data.map((item) => boardLabelSchema.parse(normalizeDates(item)));
    },

    async listBoardMembers(boardId: string): Promise<BoardMember[]> {
      const res = await fetch(`${root()}/boards/${encodeURIComponent(boardId)}/members`, {
        headers: await authHeader(getToken),
      });
      if (res.status === 404) return [];
      const data = await readJson(res, (d) => d);
      if (!Array.isArray(data)) {
        throw new Error("Expected array");
      }
      return data.map((item) => boardMemberSchema.parse(item));
    },

    async searchBoardMembers(boardId: string, q: string): Promise<BoardMemberSearch[]> {
      const res = await fetch(
        `${root()}/boards/${encodeURIComponent(boardId)}/member-search?q=${encodeURIComponent(q)}`,
        {
          headers: await authHeader(getToken),
        },
      );
      if (res.status === 404) return [];
      const data = await readJson(res, (d) => d);
      if (!Array.isArray(data)) {
        throw new Error("Expected array");
      }
      return data.map((item) => boardMemberSearchSchema.parse(item));
    },

    async addBoardMember(boardId: string, body: AddBoardMemberBody): Promise<void> {
      addBoardMemberBodySchema.parse(body);
      const res = await fetch(`${root()}/boards/${encodeURIComponent(boardId)}/members`, {
        method: "POST",
        headers: await authHeader(getToken),
        body: JSON.stringify(body),
      });
      await readJson(res, () => undefined);
    },

    async listTeamMembers(boardId: string): Promise<TeamMember[]> {
      const res = await fetch(`${root()}/boards/${encodeURIComponent(boardId)}/team-members`, {
        headers: await authHeader(getToken),
      });
      if (res.status === 404) return [];
      const data = await readJson(res, (d) => d);
      if (!Array.isArray(data)) throw new Error("Expected array");
      return data.map((item) => teamMemberSchema.parse(item));
    },

    async createTeamMember(boardId: string, body: CreateTeamMemberBody): Promise<{ id: string }> {
      createTeamMemberBodySchema.parse(body);
      const res = await fetch(`${root()}/boards/${encodeURIComponent(boardId)}/team-members`, {
        method: "POST",
        headers: await authHeader(getToken),
        body: JSON.stringify(body),
      });
      return readJson(res, (d) => {
        const o = d as Record<string, unknown>;
        if (!o?.id || typeof o.id !== "string") throw new Error("Invalid response");
        return { id: o.id };
      });
    },

    async addTaskTeamMember(taskId: string, body: AddTaskTeamMemberBody): Promise<void> {
      addTaskTeamMemberBodySchema.parse(body);
      const res = await fetch(`${root()}/tasks/${encodeURIComponent(taskId)}/team-members`, {
        method: "POST",
        headers: await authHeader(getToken),
        body: JSON.stringify(body),
      });
      await readJson(res, () => undefined);
    },

    async removeTaskTeamMember(taskId: string, memberId: string): Promise<void> {
      const res = await fetch(
        `${root()}/tasks/${encodeURIComponent(taskId)}/team-members/${encodeURIComponent(memberId)}`,
        { method: "DELETE", headers: await authHeader(getToken) },
      );
      await readJson(res, () => undefined);
    },

    async createBoardLabel(boardId: string, body: CreateBoardLabelBody): Promise<{ id: string }> {
      const res = await fetch(`${root()}/boards/${encodeURIComponent(boardId)}/labels`, {
        method: "POST",
        headers: await authHeader(getToken),
        body: JSON.stringify(body),
      });
      return readJson(res, (d) => {
        const o = d as Record<string, unknown>;
        if (!o?.id || typeof o.id !== "string") {
          throw new Error("Invalid response");
        }
        return { id: o.id };
      });
    },

    async listTaskComments(taskId: string): Promise<TaskComment[]> {
      const res = await fetch(`${root()}/tasks/${encodeURIComponent(taskId)}/comments`, {
        headers: await authHeader(getToken),
      });
      if (res.status === 404) return [];
      const data = await readJson(res, (d) => d);
      if (!Array.isArray(data)) {
        throw new Error("Expected array");
      }
      return data.map((item) => taskCommentSchema.parse(normalizeDates(item)));
    },

    async createTaskComment(taskId: string, body: CreateTaskCommentBody): Promise<void> {
      const res = await fetch(`${root()}/tasks/${encodeURIComponent(taskId)}/comments`, {
        method: "POST",
        headers: await authHeader(getToken),
        body: JSON.stringify(body),
      });
      await readJson(res, () => undefined);
    },

    async listTaskActivity(taskId: string): Promise<TaskActivity[]> {
      const res = await fetch(`${root()}/tasks/${encodeURIComponent(taskId)}/activity`, {
        headers: await authHeader(getToken),
      });
      if (res.status === 404) return [];
      const data = await readJson(res, (d) => d);
      if (!Array.isArray(data)) {
        throw new Error("Expected array");
      }
      return data.map((item) => taskActivitySchema.parse(normalizeDates(item)));
    },

    async addTaskLabel(taskId: string, labelId: string): Promise<void> {
      const res = await fetch(`${root()}/tasks/${encodeURIComponent(taskId)}/labels`, {
        method: "POST",
        headers: await authHeader(getToken),
        body: JSON.stringify({ labelId }),
      });
      await readJson(res, () => undefined);
    },

    async removeTaskLabel(taskId: string, labelId: string): Promise<void> {
      const res = await fetch(
        `${root()}/tasks/${encodeURIComponent(taskId)}/labels/${encodeURIComponent(labelId)}`,
        {
          method: "DELETE",
          headers: await authHeader(getToken),
        },
      );
      await readJson(res, () => undefined);
    },

    async listTaskAssignees(taskId: string): Promise<string[]> {
      const res = await fetch(`${root()}/tasks/${encodeURIComponent(taskId)}/assignees`, {
        headers: await authHeader(getToken),
      });
      const data = await readJson(res, (d) => d);
      if (!Array.isArray(data)) {
        throw new Error("Expected array");
      }
      return data.map((id) => typeof id === "string" ? id : String(id));
    },

    async addTaskAssignee(taskId: string, userId: string): Promise<void> {
      const res = await fetch(`${root()}/tasks/${encodeURIComponent(taskId)}/assignees`, {
        method: "POST",
        headers: await authHeader(getToken),
        body: JSON.stringify({ userId }),
      });
      await readJson(res, () => undefined);
    },

    async removeTaskAssignee(taskId: string, userId: string): Promise<void> {
      const res = await fetch(
        `${root()}/tasks/${encodeURIComponent(taskId)}/assignees/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          headers: await authHeader(getToken),
        },
      );
      await readJson(res, () => undefined);
    },
  };
}

/** Ensure tasks include labels/assigneeIds for older API responses */
function normalizeBoardDetailTasks(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  const board = value as Record<string, unknown>;
  const cols = board.columns;
  if (!Array.isArray(cols)) {
    return normalizeDates(value);
  }
  const nextCols = cols.map((col) => {
    if (col === null || typeof col !== "object") return col;
    const c = col as Record<string, unknown>;
    const tasks = c.tasks;
    if (!Array.isArray(tasks)) return col;
    const nextTasks = tasks.map((t) => {
      if (t === null || typeof t !== "object") return t;
      const task = t as Record<string, unknown>;
      return {
        ...task,
        labels: Array.isArray(task.labels) ? task.labels : [],
        assigneeIds: Array.isArray(task.assigneeIds) ? task.assigneeIds : [],
        teamAssignees: Array.isArray(task.teamAssignees) ? task.teamAssignees : [],
      };
    });
    return { ...c, tasks: nextTasks };
  });
  return { ...board, columns: nextCols };
}

/** Go encodes times as RFC3339 strings — ensure Zod datetime compatibility */
function normalizeDates(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeDates);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        (k === "createdAt" || k === "updatedAt" || k === "dueAt") &&
        typeof v === "string" &&
        v.length > 0 &&
        !v.endsWith("Z") &&
        /^\d{4}-\d{2}-\d{2}T/.test(v)
      ) {
        out[k] = new Date(v).toISOString();
      } else {
        out[k] = normalizeDates(v);
      }
    }
    return out;
  }
  return value;
}
