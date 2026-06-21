import { useState } from "react";
import { ResourceKitProvider, usePreload, useSynced } from "resourcekit/react";
import { Toaster } from "./components/ui/sonner";
import { boardData } from "./data/bundles";
import { WORKSPACE_ID } from "./data/demo";
import { appEngine } from "./data/engine";
import { members, tasks } from "./data/resources";
import { Board } from "./board/Board";
import { TaskDetail } from "./board/TaskDetail";
import { Toolbar } from "./board/Toolbar";
import { Workload } from "./board/Workload";

export function App() {
  return (
    <ResourceKitProvider engine={appEngine}>
      <Flowboard />
      <Toaster position="bottom-right" />
    </ResourceKitProvider>
  );
}

function Flowboard() {
  // Warm the whole board in one batched prefetch, so the cards below
  // render from cache instead of each fetching on mount.
  usePreload(boardData, { workspaceId: WORKSPACE_ID });

  const [search, setSearch] = useState("");
  const [assignee, setAssignee] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const team = useSynced(members.where().orderBy("name"));

  // One synced set — the workspace's tasks with their assignee and
  // comments joined in. Search and the assignee filter are local
  // refinements: they run on this cached data, so typing costs nothing.
  const board = useSynced(
    tasks
      .where({ workspaceId: WORKSPACE_ID })
      .include("assignee", "comments")
      .filter((task) =>
        task.title.toLowerCase().includes(search.trim().toLowerCase()),
      )
      .filter((task) => assignee === "all" || task.assigneeId === assignee)
      .orderBy("createdAt"),
  );

  const selected = board.data.find((task) => task.id === selectedId) ?? null;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Toolbar
        search={search}
        onSearch={setSearch}
        assignee={assignee}
        onAssignee={setAssignee}
        team={team.data}
      />
      <Workload team={team.data} />
      <Board tasks={board.data} onOpen={setSelectedId} />
      {selected && (
        <TaskDetail
          task={selected}
          team={team.data}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
