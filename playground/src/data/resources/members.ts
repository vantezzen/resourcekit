import { resource } from "resourcekit";
import { z } from "zod";

export const MemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  color: z.string(),
});
export type Member = z.infer<typeof MemberSchema>;

/**
 * The team. Served from an in-memory backbone on the server - a
 * resource doesn't need a database table to work like any other.
 */
export const members = resource("members", {
  schema: MemberSchema,
});
