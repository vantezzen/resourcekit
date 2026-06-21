import { useState } from "react";
import { cn } from "@/lib/utils";
import { STATUSES, type BoardTask, type Status } from "../data/resources";
import { TaskCard } from "./TaskCard";
import { PlusIcon } from "./icons";
import { useTaskActions } from "./use-task-actions";

const COLUMN_LABELS: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

export function Board({
  tasks,
  onOpen,
}: {
  tasks: BoardTask[];
  onOpen: (taskId: string) => void;
}) {
  const actions = useTaskActions();

  return (
    <div className="flex flex-1 gap-4 overflow-x-auto p-4">
      {STATUSES.map((status) => (
        <Column
          key={status}
          status={status}
          tasks={tasks.filter((task) => task.status === status)}
          onOpen={onOpen}
          onDrop={(id) => actions.move(id, status)}
          onCreate={(title) => actions.create(title, status)}
        />
      ))}
    </div>
  );
}

function Column({
  status,
  tasks,
  onOpen,
  onDrop,
  onCreate,
}: {
  status: Status;
  tasks: BoardTask[];
  onOpen: (taskId: string) => void;
  onDrop: (taskId: string) => void;
  onCreate: (title: string) => void;
}) {
  const [isOver, setIsOver] = useState(false);

  return (
    <section
      onDragOver={(event) => {
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsOver(false);
        const id = event.dataTransfer.getData("text/plain");
        if (id) onDrop(id);
      }}
      className={cn(
        "flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/40 p-2 ring-2 ring-transparent transition-shadow",
        isOver && "ring-primary/40",
      )}
    >
      <header className="flex items-center justify-between px-2 pt-1">
        <h2 className="text-sm font-semibold">{COLUMN_LABELS[status]}</h2>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </header>

      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onOpen={() => onOpen(task.id)}
            onDragStart={(event) =>
              event.dataTransfer.setData("text/plain", task.id)
            }
          />
        ))}
      </div>

      <Composer onCreate={onCreate} />
    </section>
  );
}

function Composer({ onCreate }: { onCreate: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <PlusIcon className="size-4" />
        Add task
      </button>
    );
  }

  function submit() {
    const trimmed = title.trim();
    if (trimmed) onCreate(trimmed);
    setTitle("");
    setOpen(false);
  }

  return (
    <textarea
      autoFocus
      rows={2}
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
        if (event.key === "Escape") {
          setTitle("");
          setOpen(false);
        }
      }}
      placeholder="What needs doing?"
      className="resize-none rounded-lg border border-border bg-card p-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    />
  );
}
