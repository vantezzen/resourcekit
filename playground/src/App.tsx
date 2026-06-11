import { useSynced } from "resourcekit/react";
import { issues } from "./resourcekit/resources";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { QueryPlanSchema } from "resourcekit";
import { useState } from "react";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";

export function App() {
  const [query, setQuery] = useState("");
  const result = useSynced(
    issues.where({
      workspaceId: "w1",
      status: "open",
      title: { contains: query },
    }),
  );

  const assignPlan = issues.assign({ userId: "u1" });

  return (
    <main className="min-h-screen bg-zinc-100 p-8 text-zinc-950">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-sm font-medium text-zinc-400">
            ResourceKit Playground
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            Local-first data runtime experiments
          </h1>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Query result</CardTitle>
          </CardHeader>
          <CardContent>
            <Label>Search</Label>{" "}
            <Input value={query} onChange={(e) => setQuery(e.target.value)} />
            <pre className="mt-4 overflow-auto rounded-xl p-4 text-sm">
              {JSON.stringify(result, null, 2)}
            </pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Action Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="mt-4 overflow-auto rounded-xl p-4 text-sm">
              {JSON.stringify(assignPlan, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
