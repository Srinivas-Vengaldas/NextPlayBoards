import { z } from "zod";

export const prioritySchema = z.enum(["none", "low", "medium", "high", "urgent"]);

export const boardSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  ownerId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const taskLabelSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
});

export const taskSchema = z.object({
  id: z.string().uuid(),
  columnId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  position: z.number(),
  assigneeId: z.string().uuid().optional().nullable(),
  assigneeIds: z.array(z.string().uuid()).optional(),
  labels: z.array(taskLabelSchema).optional(),
  teamAssignees: z
    .array(
      z.object({
        id: z.string().uuid(),
        boardId: z.string().uuid(),
        name: z.string(),
        color: z.string(),
        avatarUrl: z.string().nullable().optional(),
      }),
    )
    .optional(),
  dueAt: z.string().nullable().optional(),
  priority: prioritySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const columnSchema = z.object({
  id: z.string().uuid(),
  boardId: z.string().uuid(),
  title: z.string(),
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tasks: z.array(taskSchema),
});

export const boardDetailSchema = boardSummarySchema.extend({
  columns: z.array(columnSchema),
});

export const createBoardBodySchema = z.object({
  title: z.string().min(1),
});

export const createColumnBodySchema = z.object({
  title: z.string().min(1),
  position: z.number().optional(),
});

export const patchColumnBodySchema = z.object({
  title: z.string().min(1).optional(),
  position: z.number().optional(),
});

export const createTaskBodySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  position: z.number().optional(),
  priority: prioritySchema.optional(),
  dueAt: z.string().optional().nullable(),
});

export const patchTaskBodySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  columnId: z.string().uuid().optional(),
  position: z.number().optional(),
  priority: prioritySchema.optional(),
  dueAt: z.string().optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable(),
});

export const taskCommentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  content: z.string(),
  createdAt: z.string(),
});

export const taskActivitySchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  actorId: z.string().uuid(),
  actionType: z.string(),
  message: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  createdAt: z.string(),
});

export const boardLabelSchema = z.object({
  id: z.string().uuid(),
  boardId: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createBoardLabelBodySchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
});

export const createTaskCommentBodySchema = z.object({
  content: z.string().min(1),
});

export const boardMemberSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});

export const boardMemberSearchSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email().optional().nullable(),
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});

export const addBoardMemberBodySchema = z.object({
  userId: z.string().uuid(),
});

export const teamMemberSchema = z.object({
  id: z.string().uuid(),
  boardId: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  avatarUrl: z.string().nullable().optional(),
});

export const createTeamMemberBodySchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  avatarUrl: z.string().nullable().optional(),
});

export const addTaskTeamMemberBodySchema = z.object({
  memberId: z.string().uuid(),
});

export type BoardSummary = z.infer<typeof boardSummarySchema>;
export type BoardDetail = z.infer<typeof boardDetailSchema>;
export type Column = z.infer<typeof columnSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskLabel = z.infer<typeof taskLabelSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type TaskComment = z.infer<typeof taskCommentSchema>;
export type TaskActivity = z.infer<typeof taskActivitySchema>;
export type BoardLabel = z.infer<typeof boardLabelSchema>;
export type BoardMember = z.infer<typeof boardMemberSchema>;
export type BoardMemberSearch = z.infer<typeof boardMemberSearchSchema>;
export type TeamMember = z.infer<typeof teamMemberSchema>;
