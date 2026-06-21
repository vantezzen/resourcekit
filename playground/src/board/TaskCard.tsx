import type { BoardTask } from "../data/resources";
import { Avatar } from "./Avatar";
import { CommentIcon } from "./icons";

export function TaskCard({
  task,
  onOpen,
  onDragStart,
}: {
  task: BoardTask;
  onOpen: () => void;
  onDragStart: (event: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className="group cursor-pointer rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:border-foreground/20 active:cursor-grabbing"
    >
      <p className="text-sm leading-snug font-medium">{task.title}</p>
      <div className="mt-2.5 flex items-center justify-between">
        {task.comments.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CommentIcon className="size-3.5" />
            {task.comments.length}
          </span>
        ) : (
          <span />
        )}
        <Avatar member={task.assignee} />
      </div>
    </div>
  );
}
