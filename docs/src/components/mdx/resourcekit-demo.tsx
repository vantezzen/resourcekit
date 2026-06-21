"use client";

import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { useState } from "react";
import { z } from "zod";
import { action, engine, resource } from "resourcekit";
import { ResourceKitProvider, useAction, useSynced } from "resourcekit/react";

/**
 * The marketing/docs hero demo: a tabbed view of a realistic, Drizzle-
 * backed ResourceKit app on the left, and the *same* app actually
 * running on the right.
 *
 * The code on the left is written as if a real server and database were
 * wired up - that's the shape you'd ship. The engine that powers the
 * live preview is configured `source: null` (cache-authoritative) with
 * `persist`, so it runs entirely in the browser, needs no backend, and
 * survives reloads. Every hook and write is identical to the server-
 * backed version - that's the whole point.
 */

/* ------------------------------------------------------------------ */
/* The files shown on the left (illustrative - the real shape)        */
/* ------------------------------------------------------------------ */

const FILES = [
  {
    name: "resources.ts",
    lang: "ts",
    code: `import { z } from "zod";
import { resource, action, engine } from "resourcekit";

// ResourceKit bases its type safety on zod schemas of your data
const taskSchema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  workspaceId: z.string(),
  title: z.string().min(1),
  done: z.boolean().default(false),
  createdAt: z.string().default(() => new Date().toISOString()),
});

// Describe your data once - shared by client and server.
export const tasks = resource("tasks", {
  schema: taskSchema,
  actions: {
    // Optionally, define actions to have nice client methods and consistent server logic.
    toggle: action(z.object({}), ({ record }) => ({ done: !record.done })),
  },
});

// The engine is the contract both sides build on.
export const appEngine = engine({
  resources: [tasks],
  endpoint: "/sync",
});`,
  },
  {
    name: "server.ts",
    lang: "ts",
    code: `import { server } from "resourcekit/server";
import { drizzleBackbone } from "resourcekit/drizzle";
import { appEngine, tasks } from "./resources";
import { db, tasksTable } from "./db";
import { getAuth } from "./auth";

// Point each resource at where its data lives, and declare who may
// see it. Access + validation run on every request, server-side only.
const resourceServer = server(appEngine, {
  ctx: async (req) => ({ auth: await getAuth(req) }),

  resources: {
    tasks: {
      // The "backbone" connects your resource to its storage
      backbone: drizzleBackbone(db, tasksTable),
      // Only serve tasks belonging to the user's workspaces.
      access: (ctx) => ({ workspaceId: { in: ctx.auth.workspaceIds } }),
    },
  },
});

// One endpoint serves every resource - mount on Next.js, Bun, Hono, …
export const POST = resourceServer.POST;`,
  },
  {
    name: "TaskList.tsx",
    lang: "tsx",
    code: `import { useState } from "react";
import { useSynced, useAction } from "resourcekit/react";
import { tasks } from "./resources";

export function TaskList({ workspaceId }: { workspaceId: string }) {
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");

  // Reads are instant from the cache. .filter()/.orderBy() run locally
  // on synced data, so typing in the search box never hits the network.
  const { data } = useSynced(
    tasks
      .where({ workspaceId })
      .filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
      .orderBy("createdAt", "desc"),
  );

  // Writes apply optimistically; the server confirms in the background.
  const create = useAction(tasks.create);
  const toggle = useAction(tasks.actions.toggle);
  const remove = useAction(tasks.delete);

  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} />

      <form onSubmit={(e) => {
        e.preventDefault();
        create.run({ workspaceId, title });
        setTitle("");
      }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
        <button disabled={create.isPending}>
          Add task
        </button>
      </form>

      {data.map((task) => (
        <label key={task.id}>
          <input
            type="checkbox"
            checked={task.done}
            onChange={() => toggle.run(task.id, {})}
          />
          <span>{task.title}</span>
          <button onClick={() => remove.run(task.id)}>Delete</button>
        </label>
      ))}
    </div>
  );
}`,
  },
] as const;

/* ------------------------------------------------------------------ */
/* The app actually running in the preview (local-only)               */
/* ------------------------------------------------------------------ */

const WORKSPACE_ID = "w1";

const demoTasks = resource("tasks", {
  schema: z.object({
    id: z.string().default(() => crypto.randomUUID()),
    workspaceId: z.string(),
    title: z.string().min(1),
    done: z.boolean().default(false),
    createdAt: z.string().default(() => new Date().toISOString()),
  }),
  actions: {
    toggle: action(z.object({}), ({ record }) => ({ done: !record.done })),
  },
});

const demoEngine = engine({
  resources: [demoTasks],
  source: null, // cache is authoritative - no backend
  persist: "resourcekit-demo-tasks", // survives reloads
});

// Seed a few tasks the first time, so the preview isn't empty.
let seeded = false;
void demoEngine.ready.then(async () => {
  if (seeded) return;
  seeded = true;
  const existing = await demoEngine.query(
    demoTasks.where({ workspaceId: WORKSPACE_ID }),
  );
  if (existing.length > 0) return;
  for (const title of [
    "Check me off — writes are optimistic",
    "Reload the page — I'm still here",
    "Search filters locally, instantly",
  ]) {
    await demoEngine.mutate(
      demoTasks.create({ workspaceId: WORKSPACE_ID, title }),
    );
  }
});

function inputClasses() {
  return "w-full rounded-lg border border-fd-border bg-fd-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-fd-primary";
}

function Preview() {
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");

  const { data } = useSynced(
    demoTasks
      .where({ workspaceId: WORKSPACE_ID })
      .filter((task) => task.title.toLowerCase().includes(search.toLowerCase()))
      .orderBy("createdAt", "desc"),
  );

  const create = useAction(demoTasks.create);
  const toggle = useAction(demoTasks.actions.toggle);
  const remove = useAction(demoTasks.delete);

  const remaining = data.filter((task) => !task.done).length;

  return (
    <div className="flex flex-col gap-3">
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search tasks (runs locally)…"
        className={inputClasses()}
      />

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = title.trim();
          if (!trimmed) return;
          create.run({ workspaceId: WORKSPACE_ID, title: trimmed });
          setTitle("");
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task…"
          className={inputClasses()}
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
        >
          Add
        </button>
      </form>

      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-fd-border px-3 py-8 text-center text-sm text-fd-muted-foreground">
          {search ? "No tasks match your search." : "No tasks yet — add one."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.map((task) => (
            <li
              key={task.id}
              className="group flex items-center gap-3 rounded-lg border border-fd-border bg-fd-card px-3 py-2"
            >
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => toggle.run(task.id, {})}
                className="size-4 shrink-0 accent-fd-primary"
              />
              <span
                className={
                  "flex-1 text-sm " +
                  (task.done
                    ? "text-fd-muted-foreground line-through"
                    : "text-fd-foreground")
                }
              >
                {task.title}
              </span>
              <button
                type="button"
                onClick={() => remove.run(task.id)}
                aria-label={`Delete "${task.title}"`}
                className="shrink-0 text-fd-muted-foreground opacity-0 transition-opacity hover:text-fd-foreground group-hover:opacity-100"
              >
                <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {data.length > 0 && (
        <div className="flex items-center justify-between px-0.5 text-xs text-fd-muted-foreground">
          <span>
            {remaining} of {data.length} open
          </span>
          <button
            type="button"
            onClick={() =>
              data
                .filter((task) => task.done)
                .forEach((task) => remove.run(task.id))
            }
            disabled={remaining === data.length}
            className="transition-colors hover:text-fd-foreground disabled:opacity-40 disabled:hover:text-fd-muted-foreground"
          >
            Clear completed
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The split-view shell                                               */
/* ------------------------------------------------------------------ */

export function ResourceKitDemo() {
  const [active, setActive] = useState(0);
  const file = FILES[active]!;

  return (
    <div className="not-prose overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-sm">
      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-fd-border">
        {/* Left: tabbed source files */}
        <div className="flex min-w-0 flex-col border-b border-fd-border lg:border-b-0">
          <div
            role="tablist"
            aria-label="Source files"
            className="flex items-stretch gap-1 overflow-x-auto border-b border-fd-border bg-fd-muted/40 px-2"
          >
            {FILES.map((tab, index) => (
              <button
                key={tab.name}
                role="tab"
                aria-selected={index === active}
                onClick={() => setActive(index)}
                className={
                  "whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors " +
                  (index === active
                    ? "border-fd-primary text-fd-foreground"
                    : "border-transparent text-fd-muted-foreground hover:text-fd-foreground")
                }
              >
                {tab.name}
              </button>
            ))}
          </div>

          <div className="min-h-[360px] overflow-auto text-[12.5px] leading-relaxed lg:h-[540px] [&_figure]:!m-0 [&_figure]:!rounded-none [&_figure]:!border-0 [&_pre]:!rounded-none [&_pre]:!py-4">
            <DynamicCodeBlock
              key={file.name}
              code={file.code}
              lang={file.lang}
            />
          </div>
        </div>

        {/* Right: the running app */}
        <div className="flex min-w-0 flex-col bg-fd-background">
          <div className="flex items-center justify-between border-b border-fd-border bg-fd-muted/40 px-4 py-2">
            <span className="text-xs font-medium text-fd-muted-foreground">
              Preview
            </span>
          </div>
          <div className="min-h-[360px] overflow-auto p-4 lg:h-[540px]">
            <ResourceKitProvider engine={demoEngine}>
              <Preview />
            </ResourceKitProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
