import { bundle } from "resourcekit";
import { members, tasks } from "./resources";

/**
 * Everything the board needs, prefetched together. Preloading this on
 * load warms the cache (tasks, their relations, the team, and the
 * server-side workload aggregate) so the board renders without each
 * piece fetching on its own.
 */
export const boardData = bundle(({ workspaceId }: { workspaceId: string }) => [
  tasks.where({ workspaceId }).include("assignee", "comments"),
  members.where(),
  tasks.queries.workload({ workspaceId }),
]);
