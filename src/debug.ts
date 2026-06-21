import createDebug from "debug";

/**
 * Namespaced diagnostics, off by default. Enable with the standard
 * `debug` filters:
 *
 * - Node/Bun: `DEBUG=resourcekit:* bun run dev`
 * - Browser:  `localStorage.debug = "resourcekit:*"` (then reload)
 *
 * Narrow to one area with e.g. `resourcekit:writes`.
 */
export const debug = {
  /** Read routing: cache hits, source fetches, offline fallbacks. */
  engine: createDebug("resourcekit:engine"),
  /** Local cache: ingests, coverage, persistence, restoration. */
  cache: createDebug("resourcekit:cache"),
  /** Network: batched requests, channel refreshes. */
  sync: createDebug("resourcekit:sync"),
  /** The write path: optimistic, confirmed, rejected, replayed. */
  writes: createDebug("resourcekit:writes"),
  /** Live updates: connections and change notifications. */
  live: createDebug("resourcekit:live"),
  /** Server: handled plans and refusals. */
  server: createDebug("resourcekit:server"),
};
