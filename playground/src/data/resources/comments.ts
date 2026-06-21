import { one, resource } from "resourcekit";
import { z } from "zod";
import { members } from "./members";

export const CommentSchema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  workspaceId: z.string(),
  taskId: z.string(),
  authorId: z.string(),
  body: z.string().min(1),
  createdAt: z.string().default(() => new Date().toISOString()),
});
export type Comment = z.infer<typeof CommentSchema>;

export const comments = resource("comments", {
  schema: CommentSchema,
  relations: {
    author: one(() => members, "authorId"),
  },
});
