import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import Link from "next/link";
import type { ReactNode } from "react";
import { ResourceKitDemo } from "@/components/mdx/resourcekit-demo";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "ResourceKit: A full-stack data runtime for TypeScript",
  description:
    "Define your data once. Reads answer instantly from a local cache, writes apply optimistically and auto-sync between users, and the whole thing works offline - all on top of the database and server you already have.",
};

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <TheIdea />
      <Features />
      <FinalCta />
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-fd-border">
      <GridBackdrop />
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            A full-stack data runtime for TypeScript
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-lg text-fd-muted-foreground">
            Define your data once. Reads answer instantly from a local cache,
            writes apply optimistically and auto-sync between users, and the
            whole thing works offline - all on top of the database and server
            you already have.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
            >
              Get started
              <ArrowRight />
            </Link>
            <Link
              href="/docs/installation"
              className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent"
            >
              Quickstart
            </Link>
            <a
              href="https://github.com/vantezzen/resourcekit"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground"
            >
              <GithubIcon />
              GitHub
            </a>
          </div>
        </div>

        <div className="mt-14">
          <ResourceKitDemo />
          <p className="mt-3 text-center text-sm text-fd-muted-foreground">
            The code on the left is the real, server-backed shape. The preview
            on the right is that same app running live in your browser.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The core idea                                                       */
/* ------------------------------------------------------------------ */

function TheIdea() {
  return (
    <section className="border-b border-fd-border">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
          A unified access layer to your data.
        </h2>
        <p className="mt-3 max-w-2xl text-fd-muted-foreground">
          The client and server share a single, typed API to access your data.
          You declare your resources - the shape of your records, how to read
          and write them, and who can do what. The same API, the same access
          rules, the same types, everywhere.
        </p>

        <p className="mt-6 max-w-2xl text-sm text-fd-muted-foreground">
          Declare a resource once; on the server, point it at whatever holds its
          data. Same <Code>backbone</Code> slot, wildly different stores - the
          client speaks the same plans to all of them and never knows the
          difference.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {BACKBONES.map((backbone) => (
            <BackboneCard key={backbone.name} {...backbone} />
          ))}
        </div>

        <p className="mt-6 text-sm text-fd-muted-foreground">
          And the client is identical for every one of them:{" "}
          <Code>{`const { data } = useSynced(tasks.where({ workspaceId }))`}</Code>
          .
        </p>
      </div>
    </section>
  );
}

const BACKBONES: { name: string; tag: string; code: string; note: string }[] = [
  {
    name: "Relational DBs",
    tag: "e.g. Drizzle",
    code: "backbone: drizzleBackbone(db, tasksTable),",
    note: "Relational rows, versioned for conflict detection.",
  },
  {
    name: "Documents",
    tag: "e.g. MongoDB",
    code: 'backbone: mongoBackbone(db.collection("comments")),',
    note: "A document per record - no schema migration.",
  },
  {
    name: "key-value",
    tag: "e.g. Redis",
    code: "backbone: redisBackbone(redis),",
    note: "Instant lookups for small, hot datasets.",
  },
  {
    name: "external API",
    tag: "e.g. Stripe",
    code: "backbone: stripeCustomerBackbone(stripe),",
    note: "No database at all - and no .where(), enforced in the types.",
  },
];

function BackboneCard({
  name,
  tag,
  code,
  note,
}: {
  name: string;
  tag: string;
  code: string;
  note: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-fd-border bg-fd-card p-4">
      <div className="flex items-center gap-2">
        <span className="font-medium">{name}</span>
        <span className="rounded-full bg-fd-muted px-2 py-0.5 text-[11px] font-medium text-fd-muted-foreground">
          {tag}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto text-[12.5px] [&_figure]:!m-0 [&_figure]:!border-0 [&_pre]:!rounded-lg [&_pre]:!py-3">
        <DynamicCodeBlock code={code} lang="ts" />
      </div>
      <p className="mt-3 text-sm text-fd-muted-foreground">{note}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Features                                                            */
/* ------------------------------------------------------------------ */

const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <BoltIcon />,
    title: "Instant reads",
    body: "Queries answer from a local cache immediately and revalidate in the background. Filtering, sorting, and relation joins run on data that's already there.",
  },
  {
    icon: <CursorIcon />,
    title: "Optimistic writes",
    body: "The UI updates the moment a user acts; the server confirms behind the scenes. Rejections roll back automatically - no manual bookkeeping.",
  },
  {
    icon: <WifiOffIcon />,
    title: "Offline-ready",
    body: "Writes queue and replay in order when you reconnect. Opt into persistence and the cache - queued writes included - survives reloads.",
  },
  {
    icon: <RadioIcon />,
    title: "Live across windows",
    body: "One line streams server-pushed changes to every connected client over SSE. Bridge across instances with Redis when you scale out.",
  },
  {
    icon: <ShieldIcon />,
    title: "Your server stays in charge",
    body: "Every request is validated against your schema and checked against access rules you declare once. The client is never trusted.",
  },
  {
    icon: <StackIcon />,
    title: "Keep your backend",
    body: "Postgres via Drizzle, in-memory data, custom server code, external APIs - all behind one typed interface and a single sync endpoint.",
  },
];

function Features() {
  return (
    <section className="border-b border-fd-border">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Everything an app's data layer should already do
        </h2>
        <p className="mt-3 max-w-2xl text-fd-muted-foreground">
          The plumbing you'd otherwise hand-roll - caching, optimistic updates,
          offline queues, live updates - built in and typed end to end.
        </p>

        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="bg-fd-card p-6">
              <div className="flex size-9 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary">
                {feature.icon}
              </div>
              <h3 className="mt-4 font-medium">{feature.title}</h3>
              <p className="mt-2 text-sm text-fd-muted-foreground">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Final CTA                                                           */
/* ------------------------------------------------------------------ */

function FinalCta() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-6 py-20 text-center lg:py-28">
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Start with one resource.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-fd-muted-foreground">
          Add it to a single screen, keep everything else as it is. Layer in
          actions, access rules, offline, and live updates only when you need
          them.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Read the docs
            <ArrowRight />
          </Link>
          <code className="rounded-lg border border-fd-border bg-fd-card px-4 py-3 font-mono text-sm">
            bun add resourcekit
          </code>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-[0.9em]">
      {children}
    </code>
  );
}

function GridBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:36px_36px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]"
    />
  );
}

/* Inline icons - no external icon dependency. */

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
      <path
        d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CursorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
      <path
        d="m4 4 6 16 2.5-6.5L19 11 4 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WifiOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
      <path
        d="M3 3l18 18M8.5 12.5a5 5 0 0 1 7 0M5 9a10 10 0 0 1 4-2.5M19 9a10 10 0 0 0-5-2.7M12 18h.01"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RadioIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path
        d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M6 6a9 9 0 0 0 0 12M18 6a9 9 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
      <path
        d="M12 3 5 6v6c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6l-7-3Zm-2.5 9 2 2 3.5-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
      <path
        d="m12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
