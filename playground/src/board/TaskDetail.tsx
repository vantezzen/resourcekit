import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  STATUSES,
  type BoardTask,
  type Member,
  type Status,
} from "../data/resources";
import { Avatar } from "./Avatar";
import { CloseIcon, CopyIcon, TrashIcon } from "./icons";
import { useTaskActions } from "./use-task-actions";

const STATUS_LABELS: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

export function TaskDetail({
  task,
  team,
  onClose,
}: {
  task: BoardTask;
  team: Member[];
  onClose: () => void;
}) {
  const actions = useTaskActions();
  const byId = new Map(team.map((member) => [member.id, member]));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <aside className="absolute top-0 right-0 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="text-xs font-medium text-muted-foreground">
            Task
          </span>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <CloseIcon />
          </Button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Title — committed on blur. */}
          <Input
            key={task.id}
            defaultValue={task.title}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next && next !== task.title) actions.rename(task.id, next);
            }}
            className="text-base font-medium"
          />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <Select
                value={task.status}
                onValueChange={(value) =>
                  actions.move(task.id, value as Status)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Assignee">
              <Select
                value={task.assigneeId ?? "none"}
                onValueChange={(value) =>
                  actions.assign(task.id, value === "none" ? null : value)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {team.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Comments
            task={task}
            byId={byId}
            onAdd={(body) => actions.comment(task.id, body)}
          />
        </div>

        <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => actions.duplicate(task.id)}
          >
            <CopyIcon /> Duplicate
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              actions.remove(task.id);
              onClose();
            }}
          >
            <TrashIcon /> Delete
          </Button>
        </footer>
      </aside>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Comments({
  task,
  byId,
  onAdd,
}: {
  task: BoardTask;
  byId: Map<string, Member>;
  onAdd: (body: string) => void;
}) {
  const [body, setBody] = useState("");
  const ordered = [...task.comments].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  return (
    <div className="space-y-3">
      <span className="text-xs font-medium text-muted-foreground">
        Comments · {ordered.length}
      </span>

      <ul className="space-y-3">
        {ordered.map((comment) => (
          <li key={comment.id} className="flex gap-2.5">
            <Avatar member={byId.get(comment.authorId)} />
            <div className="min-w-0">
              <p className="text-xs font-medium">
                {byId.get(comment.authorId)?.name ?? comment.authorId}
              </p>
              <p className="text-sm text-foreground/90">{comment.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = body.trim();
          if (!trimmed) return;
          onAdd(trimmed);
          setBody("");
        }}
      >
        <Input
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a comment…"
        />
        <Button type="submit" size="sm" disabled={!body.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
