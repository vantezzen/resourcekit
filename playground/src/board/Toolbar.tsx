import { useEffect, useState } from "react";
import { useEngine } from "resourcekit/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Member } from "../data/resources";
import { network, useNetwork } from "../data/network";
import { Avatar } from "./Avatar";
import { SearchIcon, WifiIcon } from "./icons";

export function Toolbar({
  search,
  onSearch,
  assignee,
  onAssignee,
  team,
}: {
  search: string;
  onSearch: (value: string) => void;
  assignee: string;
  onAssignee: (value: string) => void;
  team: Member[];
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
      <div className="mr-2">
        <h1 className="text-sm font-semibold">Flowboard</h1>
        <p className="text-xs text-muted-foreground">Built on ResourceKit</p>
      </div>

      {/* On-device search: filters the synced set as you type — no requests. */}
      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search tasks…"
          className="w-56 pl-8"
        />
      </div>

      {/* On-device filter by assignee — also instant, also no requests. */}
      <div className="flex items-center gap-1">
        <FilterChip
          active={assignee === "all"}
          onClick={() => onAssignee("all")}
        >
          All
        </FilterChip>
        {team.map((member) => (
          <button
            key={member.id}
            type="button"
            title={`Only ${member.name}`}
            onClick={() => onAssignee(member.id)}
            className={cn(
              "rounded-full ring-2 ring-transparent transition-shadow",
              assignee === member.id && "ring-ring",
            )}
          >
            <Avatar member={member} />
          </button>
        ))}
      </div>

      <div className="ml-auto">
        <NetworkControls />
      </div>
    </header>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="sm"
      onClick={onClick}
      className="rounded-full"
    >
      {children}
    </Button>
  );
}

/** The offline toggle and live counters — the demo's "what is the network doing" panel. */
function NetworkControls() {
  const engine = useEngine();
  const { offline, requests } = useNetwork();
  const [queued, setQueued] = useState(0);

  // `queuedWrites` is a plain getter, so poll it for display.
  useEffect(() => {
    const timer = setInterval(() => setQueued(engine.queuedWrites), 400);
    return () => clearInterval(timer);
  }, [engine]);

  return (
    <div className="flex items-center gap-2">
      {queued > 0 && <Badge variant="destructive">{queued} queued</Badge>}
      <Badge variant="secondary">{requests} requests</Badge>
      <Button
        variant={offline ? "destructive" : "outline"}
        size="sm"
        onClick={() => {
          network.setOffline(!offline);
          // Back online: deliver everything queued while we were away.
          if (offline) void engine.flushWrites();
        }}
      >
        <WifiIcon off={offline} />
        {offline ? "Offline" : "Online"}
      </Button>
    </div>
  );
}
