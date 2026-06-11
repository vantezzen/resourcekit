import { action, resource } from "resourcekit";
import { z } from "zod";

export const IssueSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: z.string(),
  score: z.number(),
  assigneeId: z.string().nullable(),
  updatedAt: z.string(),
});

export const issues = resource("issues", {
  schema: IssueSchema,
  actions: {
    assign: action(z.object({ userId: z.string() }), ({ userId }) => ({
      assigneeId: userId,
    })),
  },
});
