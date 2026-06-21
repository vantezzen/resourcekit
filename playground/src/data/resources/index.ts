export { tasks, TaskSchema, STATUSES } from "./tasks";
export type { Task, BoardTask, Status } from "./tasks";
export { members, MemberSchema } from "./members";
export type { Member } from "./members";
export { comments, CommentSchema } from "./comments";
export type { Comment } from "./comments";

import { comments } from "./comments";
import { members } from "./members";
import { tasks } from "./tasks";

/** The shared contract — the client engine and the server are both built from this. */
export const resources = [tasks, members, comments] as const;
