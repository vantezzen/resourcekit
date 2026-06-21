import { useSynced } from "resourcekit/react";
import { tasks, type Member } from "../data/resources";
import { WORKSPACE_ID } from "../data/demo";
import { Avatar } from "./Avatar";

/**
 * Open tasks per assignee — a named query computed in SQL on the server
 * (not by counting synced rows on the client). It caches like any read
 * and refreshes itself when tasks change, via live updates.
 */
export function Workload({ team }: { team: Member[] }) {
  const workload = useSynced(
    tasks.queries.workload({ workspaceId: WORKSPACE_ID }),
  );
  const byId = new Map(team.map((member) => [member.id, member]));

  const ranked = [...workload.data].sort((a, b) => b.open - a.open);
  if (ranked.length === 0) return null;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2">
      <span className="text-xs font-medium text-muted-foreground">
        Workload
      </span>
      <div className="flex flex-wrap items-center gap-3">
        {ranked.map(({ memberId, open }) => (
          <span
            key={memberId}
            className="inline-flex items-center gap-1.5 text-xs"
          >
            <Avatar member={byId.get(memberId)} />
            <span className="text-muted-foreground">
              {byId.get(memberId)?.name.split(" ")[0] ?? memberId} · {open} open
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
