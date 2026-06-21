// Resources & actions
export { resource } from "./core/resource";
export type {
  AnyResource,
  IdOf,
  IdScalar,
  Resource,
  ResourceConfig,
  ResourceMode,
  ResourceOperation,
  ResourcesByName,
} from "./core/resource.types";
export { action } from "./core/action";
export type {
  ActionDefinition,
  ActionLowering,
  AnyActionDefinition,
  OpaqueActionNames,
} from "./core/action.types";
export { many, one } from "./core/relation";
export type {
  AnyRelationDef,
  IncludeSpec,
  RelationDef,
  RelationKind,
} from "./core/relation.types";
export { namedQuery } from "./core/named-query";
export type { AnyNamedQueryDef, NamedQueryDef } from "./core/named-query.types";

// Queries
export {
  applyRefinements,
  CollectionQuery,
  singleQuery,
  toQuery,
} from "./core/query";
export type { Query, QueryInput, Refinements } from "./core/query.types";

// Bundles & preloading
export { bundle } from "./core/bundle";
export type {
  Bundle,
  PreloadArgs,
  PreloadState,
  PreloadStatus,
} from "./core/bundle.types";

// Engine & live queries
export { engine, Engine } from "./core/engine";
export type { EngineConfig } from "./core/engine.types";
export { LiveQuery } from "./core/live-query";
export type { LiveQueryState, LiveQueryStatus } from "./core/live-query.types";
export type { ChannelState } from "./core/query-store.types";

// Backbones
export {
  CacheBackbone,
  ResourceRegistry,
  SourceBackbone,
} from "./core/backbone";
export type {
  CacheReadResult,
  Coverage,
  ExecutionContext,
  MutationOutcome,
  PendingMutation,
} from "./core/backbone.types";
export { MemoryCacheBackbone } from "./local/memory-cache";
export { CoverageIndex } from "./local/coverage";
export { indexedDbStorage } from "./local/indexeddb-storage";
export type { PersistedCache, StorageDriver } from "./local/storage.types";

// Plan IR - the protocol
export { planKey, QueryPlanSchema, isReadPlan, isWritePlan } from "./plan/plan";
export type { QueryPlan } from "./plan/plan";
export { ReadPlanSchema } from "./plan/read-plan";
export type { ReadPlan } from "./plan/read-plan";
export { WritePlanSchema } from "./plan/write-plan";
export type { WritePlan } from "./plan/write-plan";
export {
  filterSubsumes,
  IdSchema,
  intersectFilters,
  matchesFilter,
  WhereFilterSchema,
} from "./plan/filters";
export type { FieldFilter, WhereFilter } from "./plan/filters";
export type {
  Comparable,
  FieldFilterInput,
  Scalar,
  WhereInput,
} from "./plan/filters.types";

// Sync
export { fetchTransport } from "./sync/transport";
export type { FetchTransportOptions, Transport } from "./sync/transport.types";
export { eventSourceConnector } from "./sync/live";
export type { LiveChange, LiveConnector } from "./sync/live.types";
export { RemoteSourceBackbone } from "./sync/remote-source";
export { SyncMessageSchema, SyncResponseSchema } from "./sync/protocol";
export type {
  PlanResult,
  SyncMessage,
  SyncResponse,
  WireError,
} from "./sync/protocol";

// Errors
export {
  AccessDeniedError,
  ConflictError,
  ERROR_CODES,
  errorFromWire,
  InvalidInputError,
  MutationRejectedError,
  NoBackboneError,
  NotFoundError,
  ResourceKitError,
  TransportError,
  UnknownResourceError,
  UnsupportedOperationError,
} from "./errors";
export type { ErrorCode } from "./errors";
