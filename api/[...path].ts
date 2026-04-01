import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "./_lib/auth";
import { applyCors, isUuidLike, readBody, sendError, sendJson } from "./_lib/http";
import { normalizeApiPath, resolveApiPathname } from "./_lib/resolveApiPathname";
import { runWithRls } from "./_lib/runWithRls";

type Priority = "none" | "low" | "medium" | "high" | "urgent";

function taskDto(task: any) {
  return {
    id: task.id,
    columnId: task.columnId,
    title: task.title,
    description: task.description ?? "",
    position: task.position,
    assigneeId: task.assigneeId ?? null,
    assigneeIds: (task.assignees ?? []).map((a: any) => a.userId),
    labels: (task.labels ?? []).map((l: any) => ({
      id: l.label.id,
      name: l.label.name,
      color: l.label.color,
    })),
    teamAssignees: (task.teamAssignees ?? []).map((m: any) => ({
      id: m.teamMember.id,
      boardId: m.teamMember.boardId,
      name: m.teamMember.name,
      color: m.teamMember.color,
      avatarUrl: m.teamMember.avatarUrl ?? null,
    })),
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    priority: task.priority,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if ((req.method || "GET") === "OPTIONS") {
    return res.status(204).end();
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    return sendError(res, 401, "unauthorized");
  }

  const pathname = normalizeApiPath(resolveApiPathname(req));
  const method = req.method || "GET";

  try {
    await runWithRls(userId, async (tx) => {
      async function canAccessBoard(uid: string, boardId: string): Promise<boolean> {
        const board = await tx.board.findFirst({
          where: {
            id: boardId,
            OR: [{ ownerId: uid }, { members: { some: { userId: uid } } }],
          },
          select: { id: true },
        });
        return Boolean(board);
      }

      async function canAdminBoard(uid: string, boardId: string): Promise<boolean> {
        const board = await tx.board.findFirst({
          where: {
            id: boardId,
            OR: [
              { ownerId: uid },
              { members: { some: { userId: uid, role: { in: ["owner", "admin"] } } } },
            ],
          },
          select: { id: true },
        });
        return Boolean(board);
      }

      async function createActivity(
        taskId: string,
        actorId: string,
        actionType: string,
        message: string,
        metadata: Record<string, unknown> = {},
      ) {
        try {
          await tx.taskActivityNew.create({
            data: { taskId, actorId, actionType, message, metadata: metadata as any },
          });
        } catch {
          await tx.taskActivityOld.create({
            data: { taskId, actorId, actionType, metadata: metadata as any },
          });
        }
      }

      if (method === "GET" && pathname === "/boards") {
        const boards = await tx.board.findMany({
        where: {
          OR: [{ ownerId: userId }, { members: { some: { userId } } }],
        },
        orderBy: { updatedAt: "desc" },
      });
      return sendJson(
        res,
        200,
        boards.map((b) => ({
          id: b.id,
          title: b.title,
          ownerId: b.ownerId,
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString(),
        })),
      );
    }

    if (method === "POST" && pathname === "/boards") {
      const body = await readBody<{ title?: string }>(req.body);
      if (!body.title?.trim()) return sendError(res, 400, "invalid body");

      const created = await tx.board.create({
        data: {
          title: body.title.trim(),
          ownerId: userId,
          members: { create: { userId, role: "owner" } },
          columns: {
            create: [
              { title: "To do", position: 1000 },
              { title: "In progress", position: 2000 },
              { title: "In review", position: 3000 },
              { title: "Done", position: 4000 },
            ],
          },
        },
        select: { id: true },
      });
      return sendJson(res, 201, { id: created.id });
    }

    const boardMatch = pathname.match(/^\/boards\/([0-9a-f-]+)$/i);
    if (method === "GET" && boardMatch) {
      const boardId = boardMatch[1];
      if (!(await canAccessBoard(userId, boardId))) {
        console.warn("board_access_denied_or_missing", { boardId, userId, pathname, method });
        return sendError(res, 404, "not found");
      }

      let board: any = null;
      try {
        // NOTE: RLS context is set in `runWithRls()` before this runs.
        board = await tx.board.findUnique({
          where: { id: boardId },
          include: {
            columns: {
              orderBy: [{ position: "asc" }, { createdAt: "asc" }],
              include: {
                tasks: {
                  orderBy: [{ position: "asc" }, { createdAt: "asc" }],
                  include: {
                    labels: { include: { label: true } },
                    assignees: true,
                    teamAssignees: { include: { teamMember: true } },
                  },
                },
              },
            },
          },
        });
      } catch (err) {
        console.error("board_fetch_error", {
          boardId,
          userId,
          pathname,
          method,
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        });
        return sendError(res, 500, "database error");
      }
      if (!board) {
        console.warn("board_missing_after_access_check", { boardId, userId, pathname, method });
        return sendError(res, 404, "not found");
      }

      return sendJson(res, 200, {
        id: board.id,
        title: board.title,
        ownerId: board.ownerId,
        createdAt: board.createdAt.toISOString(),
        updatedAt: board.updatedAt.toISOString(),
        columns: board.columns.map((c) => ({
          id: c.id,
          boardId: c.boardId,
          title: c.title,
          position: c.position,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
          tasks: c.tasks.map(taskDto),
        })),
      });
    }

    const boardMembersMatch = pathname.match(/^\/boards\/([0-9a-f-]+)\/members$/i);
    if (method === "GET" && boardMembersMatch) {
      const boardId = boardMembersMatch[1];
      if (!(await canAccessBoard(userId, boardId))) {
        console.warn("board_members_access_denied_or_missing", { boardId, userId, pathname, method });
        return sendError(res, 404, "not found");
      }
      const members = await tx.boardMember.findMany({
        where: { boardId },
        include: { user: true },
      });
      return sendJson(
        res,
        200,
        members.map((m) => ({
          userId: m.userId,
          displayName: m.user?.displayName ?? null,
          avatarUrl: m.user?.avatarUrl ?? null,
        })),
      );
    }

    if (method === "POST" && boardMembersMatch) {
      const boardId = boardMembersMatch[1];
      if (!(await canAdminBoard(userId, boardId))) return sendError(res, 403, "forbidden");
      const body = await readBody<{ userId?: string }>(req.body);
      if (!body.userId || !isUuidLike(body.userId)) return sendError(res, 400, "invalid userId");
      await tx.boardMember.upsert({
        where: { boardId_userId: { boardId, userId: body.userId } },
        update: {},
        create: { boardId, userId: body.userId, role: "member" },
      });
      return sendJson(res, 204, null);
    }

    const boardSearchMatch = pathname.match(/^\/boards\/([0-9a-f-]+)\/member-search$/i);
    if (method === "GET" && boardSearchMatch) {
      const boardId = boardSearchMatch[1];
      if (!(await canAccessBoard(userId, boardId))) return sendError(res, 404, "not found");
      const q = String(req.query.q || "").trim();
      if (!q) return sendJson(res, 200, []);
      const where = isUuidLike(q)
        ? { id: q }
        : { displayName: { contains: q, mode: "insensitive" as const } };
      const profiles = await tx.profile.findMany({ where, take: 5 });
      return sendJson(
        res,
        200,
        profiles.map((p) => ({
          userId: p.id,
          email: null,
          displayName: p.displayName ?? null,
          avatarUrl: p.avatarUrl ?? null,
        })),
      );
    }

    const boardTeamMatch = pathname.match(/^\/boards\/([0-9a-f-]+)\/team-members$/i);
    if (method === "GET" && boardTeamMatch) {
      const boardId = boardTeamMatch[1];
      if (!(await canAccessBoard(userId, boardId))) {
        console.warn("board_team_members_access_denied_or_missing", { boardId, userId, pathname, method });
        return sendError(res, 404, "not found");
      }
      const members = await tx.teamMember.findMany({
        where: { boardId },
        orderBy: { createdAt: "asc" },
      });
      return sendJson(
        res,
        200,
        members.map((m) => ({
          id: m.id,
          boardId: m.boardId,
          name: m.name,
          color: m.color,
          avatarUrl: m.avatarUrl ?? null,
        })),
      );
    }

    if (method === "POST" && boardTeamMatch) {
      const boardId = boardTeamMatch[1];
      if (!(await canAccessBoard(userId, boardId))) return sendError(res, 404, "not found");
      const body = await readBody<{ name?: string; color?: string; avatarUrl?: string | null }>(req.body);
      if (!body.name?.trim()) return sendError(res, 400, "invalid body");
      const created = await tx.teamMember.create({
        data: {
          boardId,
          name: body.name.trim(),
          color: body.color || "#3b82f6",
          avatarUrl: body.avatarUrl ?? null,
        },
      });
      return sendJson(res, 201, { id: created.id });
    }

    const boardLabelsMatch = pathname.match(/^\/boards\/([0-9a-f-]+)\/labels$/i);
    if (method === "GET" && boardLabelsMatch) {
      const boardId = boardLabelsMatch[1];
      if (!(await canAccessBoard(userId, boardId))) {
        console.warn("board_labels_access_denied_or_missing", { boardId, userId, pathname, method });
        return sendError(res, 404, "not found");
      }
      const labels = await tx.label.findMany({
        where: { boardId },
        orderBy: { name: "asc" },
      });
      return sendJson(
        res,
        200,
        labels.map((l) => ({
          id: l.id,
          boardId: l.boardId,
          name: l.name,
          color: l.color,
          createdAt: l.createdAt.toISOString(),
          updatedAt: l.updatedAt.toISOString(),
        })),
      );
    }

    if (method === "POST" && boardLabelsMatch) {
      const boardId = boardLabelsMatch[1];
      if (!(await canAccessBoard(userId, boardId))) return sendError(res, 404, "not found");
      const body = await readBody<{ name?: string; color?: string }>(req.body);
      if (!body.name?.trim()) return sendError(res, 400, "invalid body");
      const existing = await tx.label.findFirst({
        where: { boardId, name: { equals: body.name.trim(), mode: "insensitive" } },
      });
      if (existing) {
        const updated = await tx.label.update({
          where: { id: existing.id },
          data: { color: body.color || existing.color },
          select: { id: true },
        });
        return sendJson(res, 200, { id: updated.id });
      }
      const created = await tx.label.create({
        data: { boardId, name: body.name.trim(), color: body.color || "#64748b" },
        select: { id: true },
      });
      return sendJson(res, 201, { id: created.id });
    }

    const boardColumnsMatch = pathname.match(/^\/boards\/([0-9a-f-]+)\/columns$/i);
    if (method === "POST" && boardColumnsMatch) {
      const boardId = boardColumnsMatch[1];
      if (!(await canAccessBoard(userId, boardId))) return sendError(res, 404, "not found");
      const body = await readBody<{ title?: string; position?: number }>(req.body);
      if (!body.title?.trim()) return sendError(res, 400, "invalid body");
      const max = await tx.column.aggregate({ where: { boardId }, _max: { position: true } });
      const created = await tx.column.create({
        data: {
          boardId,
          title: body.title.trim(),
          position: typeof body.position === "number" ? body.position : (max._max.position ?? 0) + 1000,
        },
        select: { id: true },
      });
      return sendJson(res, 201, { id: created.id });
    }

    const columnPatchMatch = pathname.match(/^\/columns\/([0-9a-f-]+)$/i);
    if (method === "PATCH" && columnPatchMatch) {
      const columnId = columnPatchMatch[1];
      const column = await tx.column.findUnique({ where: { id: columnId } });
      if (!column || !(await canAccessBoard(userId, column.boardId))) return sendError(res, 404, "not found");
      const body = await readBody<{ title?: string; position?: number }>(req.body);
      await tx.column.update({
        where: { id: columnId },
        data: {
          title: body.title,
          position: typeof body.position === "number" ? body.position : undefined,
        },
      });
      return sendJson(res, 204, null);
    }

    const columnTasksMatch = pathname.match(/^\/columns\/([0-9a-f-]+)\/tasks$/i);
    if (method === "POST" && columnTasksMatch) {
      const columnId = columnTasksMatch[1];
      const column = await tx.column.findUnique({ where: { id: columnId } });
      if (!column || !(await canAccessBoard(userId, column.boardId))) return sendError(res, 404, "not found");
      const body = await readBody<{
        title?: string;
        description?: string;
        position?: number;
        priority?: Priority;
        dueAt?: string | null;
      }>(req.body);
      if (!body.title?.trim()) return sendError(res, 400, "invalid body");
      const max = await tx.task.aggregate({ where: { columnId }, _max: { position: true } });
      const created = await tx.task.create({
        data: {
          columnId,
          title: body.title.trim(),
          description: body.description ?? "",
          position: typeof body.position === "number" ? body.position : (max._max.position ?? 0) + 1000,
          priority: body.priority || "none",
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
        },
        select: { id: true },
      });
      return sendJson(res, 201, { id: created.id });
    }

    const patchTaskMatch = pathname.match(/^\/tasks\/([0-9a-f-]+)$/i);
    if (method === "PATCH" && patchTaskMatch) {
      const taskId = patchTaskMatch[1];
      const existing = await tx.task.findUnique({
        where: { id: taskId },
        include: { column: true },
      });
      if (!existing || !(await canAccessBoard(userId, existing.column.boardId))) {
        return sendError(res, 404, "not found");
      }
      const body = await readBody<{
        title?: string;
        description?: string;
        columnId?: string;
        position?: number;
        priority?: Priority;
        dueAt?: string | null;
        assigneeId?: string | null;
      }>(req.body);

      await tx.task.update({
        where: { id: taskId },
        data: {
          title: body.title,
          description: body.description,
          columnId: body.columnId,
          position: typeof body.position === "number" ? body.position : undefined,
          priority: body.priority,
          dueAt: body.dueAt === undefined ? undefined : body.dueAt ? new Date(body.dueAt) : null,
          assigneeId: body.assigneeId,
        },
      });

      if (body.columnId && body.columnId !== existing.columnId) {
        const nextCol = await tx.column.findUnique({ where: { id: body.columnId } });
        await createActivity(taskId, userId, "task_moved", "Moved task to another column", {
          fromColumnId: existing.columnId,
          toColumnId: body.columnId,
          toColumnTitle: nextCol?.title ?? null,
        });
      }
      if (body.priority && body.priority !== existing.priority) {
        await createActivity(taskId, userId, "priority_changed", `Priority changed to ${body.priority}`, {
          priority: body.priority,
        });
      }
      return sendJson(res, 204, null);
    }

    const commentsMatch = pathname.match(/^\/tasks\/([0-9a-f-]+)\/comments$/i);
    if (method === "GET" && commentsMatch) {
      const taskId = commentsMatch[1];
      const task = await tx.task.findUnique({ where: { id: taskId }, include: { column: true } });
      if (!task || !(await canAccessBoard(userId, task.column.boardId))) return sendError(res, 404, "not found");
      const comments = await tx.taskComment.findMany({
        where: { taskId },
        orderBy: { createdAt: "asc" },
      });
      return sendJson(
        res,
        200,
        comments.map((c) => ({
          id: c.id,
          taskId: c.taskId,
          userId: c.userId ?? c.authorId,
          content: c.content ?? c.body ?? "",
          createdAt: c.createdAt.toISOString(),
        })),
      );
    }
    if (method === "POST" && commentsMatch) {
      const taskId = commentsMatch[1];
      const task = await tx.task.findUnique({ where: { id: taskId }, include: { column: true } });
      if (!task || !(await canAccessBoard(userId, task.column.boardId))) return sendError(res, 404, "not found");
      const body = await readBody<{ content?: string }>(req.body);
      if (!body.content?.trim()) return sendError(res, 400, "invalid body");
      await tx.taskComment.create({
        data: {
          taskId,
          userId,
          authorId: userId,
          content: body.content.trim(),
          body: body.content.trim(),
        },
      });
      return sendJson(res, 204, null);
    }

    const activityMatch = pathname.match(/^\/tasks\/([0-9a-f-]+)\/activity$/i);
    if (method === "GET" && activityMatch) {
      const taskId = activityMatch[1];
      const task = await tx.task.findUnique({ where: { id: taskId }, include: { column: true } });
      if (!task || !(await canAccessBoard(userId, task.column.boardId))) return sendError(res, 404, "not found");
      let items: any[] = [];
      try {
        items = await tx.taskActivityNew.findMany({
          where: { taskId },
          orderBy: { createdAt: "desc" },
        });
      } catch {
        items = await tx.taskActivityOld.findMany({
          where: { taskId },
          orderBy: { createdAt: "desc" },
        });
      }
      return sendJson(
        res,
        200,
        items.map((a) => ({
          id: a.id,
          taskId: a.taskId,
          actorId: a.actorId,
          actionType: a.actionType,
          message: a.message ?? undefined,
          metadata: a.metadata ?? {},
          createdAt: a.createdAt.toISOString(),
        })),
      );
    }

    const taskLabelsMatch = pathname.match(/^\/tasks\/([0-9a-f-]+)\/labels$/i);
    if (method === "POST" && taskLabelsMatch) {
      const taskId = taskLabelsMatch[1];
      const task = await tx.task.findUnique({ where: { id: taskId }, include: { column: true } });
      if (!task || !(await canAccessBoard(userId, task.column.boardId))) return sendError(res, 404, "not found");
      const body = await readBody<{ labelId?: string }>(req.body);
      if (!body.labelId || !isUuidLike(body.labelId)) return sendError(res, 400, "invalid body");
      await tx.taskLabel.upsert({
        where: { taskId_labelId: { taskId, labelId: body.labelId } },
        update: {},
        create: { taskId, labelId: body.labelId },
      });
      return sendJson(res, 204, null);
    }

    const taskLabelDeleteMatch = pathname.match(/^\/tasks\/([0-9a-f-]+)\/labels\/([0-9a-f-]+)$/i);
    if (method === "DELETE" && taskLabelDeleteMatch) {
      const taskId = taskLabelDeleteMatch[1];
      const labelId = taskLabelDeleteMatch[2];
      await tx.taskLabel.deleteMany({ where: { taskId, labelId } });
      return sendJson(res, 204, null);
    }

    const taskAssigneesMatch = pathname.match(/^\/tasks\/([0-9a-f-]+)\/assignees$/i);
    if (method === "GET" && taskAssigneesMatch) {
      const taskId = taskAssigneesMatch[1];
      const assignees = await tx.taskAssignee.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
      return sendJson(res, 200, assignees.map((a) => a.userId));
    }
    if (method === "POST" && taskAssigneesMatch) {
      const taskId = taskAssigneesMatch[1];
      const body = await readBody<{ userId?: string }>(req.body);
      if (!body.userId || !isUuidLike(body.userId)) return sendError(res, 400, "invalid userId");
      await tx.taskAssignee.upsert({
        where: { taskId_userId: { taskId, userId: body.userId } },
        update: {},
        create: { taskId, userId: body.userId },
      });
      return sendJson(res, 204, null);
    }

    const taskAssigneeDeleteMatch = pathname.match(/^\/tasks\/([0-9a-f-]+)\/assignees\/([0-9a-f-]+)$/i);
    if (method === "DELETE" && taskAssigneeDeleteMatch) {
      const taskId = taskAssigneeDeleteMatch[1];
      const assigneeId = taskAssigneeDeleteMatch[2];
      await tx.taskAssignee.deleteMany({ where: { taskId, userId: assigneeId } });
      return sendJson(res, 204, null);
    }

    const taskTeamMemberMatch = pathname.match(/^\/tasks\/([0-9a-f-]+)\/team-members$/i);
    if (method === "POST" && taskTeamMemberMatch) {
      const taskId = taskTeamMemberMatch[1];
      const body = await readBody<{ memberId?: string }>(req.body);
      if (!body.memberId || !isUuidLike(body.memberId)) return sendError(res, 400, "invalid memberId");
      await tx.taskTeamAssignee.upsert({
        where: { taskId_teamMemberId: { taskId, teamMemberId: body.memberId } },
        update: {},
        create: { taskId, teamMemberId: body.memberId },
      });
      await createActivity(taskId, userId, "team_member_added", "Assigned a team member", {
        memberId: body.memberId,
      });
      return sendJson(res, 204, null);
    }

    const taskTeamMemberDeleteMatch = pathname.match(/^\/tasks\/([0-9a-f-]+)\/team-members\/([0-9a-f-]+)$/i);
    if (method === "DELETE" && taskTeamMemberDeleteMatch) {
      const taskId = taskTeamMemberDeleteMatch[1];
      const memberId = taskTeamMemberDeleteMatch[2];
      await tx.taskTeamAssignee.deleteMany({ where: { taskId, teamMemberId: memberId } });
      await createActivity(taskId, userId, "team_member_removed", "Unassigned a team member", {
        memberId,
      });
      return sendJson(res, 204, null);
    }

    return sendError(res, 404, "not found");
    });
  } catch (err) {
    console.error("prisma_api_error", err);
    return sendError(res, 500, "database error");
  }
}
