import { useAction } from "resourcekit/react";
import { comments, tasks, type Status } from "../data/resources";
import { CURRENT_MEMBER_ID, WORKSPACE_ID } from "../data/demo";
import { notify } from "@/lib/notify";

/**
 * Every write the board makes, in one place. Each one is optimistic —
 * the UI updates the instant it's called and the server confirms in the
 * background; rejections (e.g. a concurrent-edit conflict) surface as a
 * toast and roll back on their own.
 */
export function useTaskActions() {
  const create = useAction(tasks.create);
  const update = useAction(tasks.update);
  const assign = useAction(tasks.actions.assign);
  const duplicate = useAction(tasks.actions.duplicate);
  const remove = useAction(tasks.delete);
  const addComment = useAction(comments.create);

  return {
    create: (title: string, status: Status) =>
      notify(create.run({ workspaceId: WORKSPACE_ID, title, status })),
    move: (id: string, status: Status) => notify(update.run(id, { status })),
    rename: (id: string, title: string) => notify(update.run(id, { title })),
    assign: (id: string, assigneeId: string | null) =>
      notify(assign.run(id, { assigneeId })),
    duplicate: (id: string) => notify(duplicate.run(id, {})),
    remove: (id: string) => notify(remove.run(id)),
    comment: (taskId: string, body: string) =>
      notify(
        addComment.run({
          workspaceId: WORKSPACE_ID,
          taskId,
          authorId: CURRENT_MEMBER_ID,
          body,
        }),
      ),
  };
}
