import { describe, expect, test } from "bun:test";
import { filterSubsumes, intersectFilters, matchesFilter } from "./filters";

describe("matchesFilter", () => {
  const record = {
    id: "a",
    group: "g1",
    score: 50,
    done: false,
    assignee: null,
  };

  test("empty filter matches everything", () => {
    expect(matchesFilter(record, {})).toBe(true);
  });

  test("scalar shorthand is equality", () => {
    expect(matchesFilter(record, { group: "g1" })).toBe(true);
    expect(matchesFilter(record, { group: "g2" })).toBe(false);
    expect(matchesFilter(record, { done: false })).toBe(true);
    expect(matchesFilter(record, { assignee: null })).toBe(true);
  });

  test("explicit eq and in", () => {
    expect(matchesFilter(record, { group: { eq: "g1" } })).toBe(true);
    expect(matchesFilter(record, { group: { in: ["g1", "g2"] } })).toBe(true);
    expect(matchesFilter(record, { group: { in: ["g2"] } })).toBe(false);
  });

  test("ranges, inclusive and exclusive", () => {
    expect(matchesFilter(record, { score: { gt: 49 } })).toBe(true);
    expect(matchesFilter(record, { score: { gt: 50 } })).toBe(false);
    expect(matchesFilter(record, { score: { gte: 50, lte: 50 } })).toBe(true);
    expect(matchesFilter(record, { score: { lt: 50 } })).toBe(false);
  });

  test("ranges never match null or missing values", () => {
    expect(matchesFilter(record, { assignee: { gt: "a" } })).toBe(false);
    expect(matchesFilter(record, { missing: { gt: 0 } })).toBe(false);
  });

  test("multiple fields AND together", () => {
    expect(matchesFilter(record, { group: "g1", score: { gt: 10 } })).toBe(
      true,
    );
    expect(matchesFilter(record, { group: "g1", score: { gt: 99 } })).toBe(
      false,
    );
  });
});

describe("intersectFilters", () => {
  test("disjoint fields merge", () => {
    expect(intersectFilters({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  test("conflicting equalities are unsatisfiable", () => {
    expect(intersectFilters({ a: 1 }, { a: 2 })).toBeNull();
  });

  test("eq within in narrows to eq", () => {
    expect(intersectFilters({ a: "x" }, { a: { in: ["x", "y"] } })).toEqual({
      a: "x",
    });
    expect(intersectFilters({ a: "z" }, { a: { in: ["x", "y"] } })).toBeNull();
  });

  test("in sets intersect (and collapse to eq when single)", () => {
    expect(
      intersectFilters(
        { a: { in: ["x", "y", "z"] } },
        { a: { in: ["y", "w"] } },
      ),
    ).toEqual({ a: "y" });
    expect(
      intersectFilters({ a: { in: ["x"] } }, { a: { in: ["y"] } }),
    ).toBeNull();
  });

  test("ranges tighten; empty intervals are unsatisfiable", () => {
    expect(
      intersectFilters({ a: { gte: 0 } }, { a: { lt: 10, gte: 5 } }),
    ).toEqual({ a: { gte: 5, lt: 10 } });
    expect(intersectFilters({ a: { gt: 10 } }, { a: { lt: 5 } })).toBeNull();
    expect(intersectFilters({ a: { gt: 5 } }, { a: { lte: 5 } })).toBeNull();
  });

  test("touching inclusive bounds collapse to eq", () => {
    expect(intersectFilters({ a: { gte: 5 } }, { a: { lte: 5 } })).toEqual({
      a: 5,
    });
  });

  test("in filtered by range", () => {
    expect(
      intersectFilters({ a: { in: [1, 5, 9] } }, { a: { gt: 2, lt: 9 } }),
    ).toEqual({ a: 5 });
  });

  test("the access-scope shape: scope AND-ed into a client filter", () => {
    const scope = { workspaceId: { in: ["w1", "w2"] } };
    expect(
      intersectFilters({ workspaceId: "w1", status: "open" }, scope),
    ).toEqual({ workspaceId: "w1", status: "open" });
    expect(intersectFilters({ workspaceId: "w9" }, scope)).toBeNull();
  });
});

describe("filterSubsumes", () => {
  test("empty filter subsumes everything", () => {
    expect(filterSubsumes({}, { a: 1, b: { gt: 0 } })).toBe(true);
  });

  test("nothing narrower subsumes a wider query", () => {
    expect(filterSubsumes({ a: 1 }, {})).toBe(false);
  });

  test("the coverage shape: synced workspace covers narrower queries", () => {
    const synced = { workspaceId: "w1" };
    expect(filterSubsumes(synced, { workspaceId: "w1", status: "open" })).toBe(
      true,
    );
    expect(filterSubsumes(synced, { workspaceId: "w2" })).toBe(false);
    expect(filterSubsumes(synced, { status: "open" })).toBe(false);
  });

  test("in covers eq members and subsets", () => {
    const synced = { workspaceId: { in: ["w1", "w2"] } };
    expect(filterSubsumes(synced, { workspaceId: "w2" })).toBe(true);
    expect(filterSubsumes(synced, { workspaceId: { in: ["w1"] } })).toBe(true);
    expect(filterSubsumes(synced, { workspaceId: { in: ["w1", "w3"] } })).toBe(
      false,
    );
  });

  test("ranges cover contained values, sets, and intervals", () => {
    const synced = { score: { gte: 0, lt: 100 } };
    expect(filterSubsumes(synced, { score: 50 })).toBe(true);
    expect(filterSubsumes(synced, { score: { in: [0, 99] } })).toBe(true);
    expect(filterSubsumes(synced, { score: { in: [0, 100] } })).toBe(false);
    expect(filterSubsumes(synced, { score: { gte: 10, lt: 20 } })).toBe(true);
    expect(filterSubsumes(synced, { score: { gte: -1, lt: 20 } })).toBe(false);
    expect(filterSubsumes(synced, { score: { gt: 5 } })).toBe(false); // unbounded above
  });

  test("exclusive bounds are respected", () => {
    expect(filterSubsumes({ a: { gt: 5 } }, { a: { gte: 5 } })).toBe(false);
    expect(filterSubsumes({ a: { gte: 5 } }, { a: { gt: 5 } })).toBe(true);
    expect(filterSubsumes({ a: { gt: 5 } }, { a: 5 })).toBe(false);
  });

  test("is conservative when it cannot prove containment", () => {
    // A finite coarse set cannot be proven to contain an interval.
    expect(
      filterSubsumes({ a: { in: [1, 2, 3] } }, { a: { gte: 1, lte: 3 } }),
    ).toBe(false);
  });
});
