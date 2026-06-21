/**
 * Error hierarchy for ResourceKit.
 *
 * Every error carries a stable `code` so errors can cross the sync
 * protocol and be rebuilt on the other side with their meaning intact.
 * `TransportError` is the one retryable error: it means "the network
 * failed", never "the server said no".
 */

export const ERROR_CODES = [
  "unknown_resource",
  "no_backbone",
  "unsupported",
  "access_denied",
  "not_found",
  "invalid_input",
  "conflict",
  "result_limit",
  "rejected",
  "transport",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

function isErrorCode(code: string): code is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}

export class ResourceKitError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** A plan referenced a resource the engine does not know about. */
export class UnknownResourceError extends ResourceKitError {
  constructor(resource: string, known: readonly string[]) {
    super(
      "unknown_resource",
      `Unknown resource "${resource}". Known resources: ${
        known.length > 0 ? known.join(", ") : "(none registered)"
      }.`,
    );
  }
}

/** No registered backbone is able to fulfill a plan. */
export class NoBackboneError extends ResourceKitError {
  constructor(message: string) {
    super("no_backbone", message);
  }
}

/**
 * A backbone exists for the resource but structurally cannot serve this
 * plan - e.g. an `where` query against a key-value store like S3, or an
 * external API (Stripe) that only supports lookups by id. The backbone
 * declares its capabilities through `canFulfill`; the server rejects
 * plans it declines rather than letting the adapter throw ad hoc.
 */
export class UnsupportedOperationError extends ResourceKitError {
  constructor(message: string) {
    super("unsupported", message);
  }
}

/** The caller is not allowed to read or write the addressed data. */
export class AccessDeniedError extends ResourceKitError {
  constructor(message: string) {
    super("access_denied", message);
  }
}

/** A write addressed a record that does not exist. */
export class NotFoundError extends ResourceKitError {
  constructor(resource: string, id: string | number) {
    super("not_found", `No "${resource}" record with id "${id}".`);
  }
}

/** Input failed schema validation. */
export class InvalidInputError extends ResourceKitError {
  constructor(message: string) {
    super("invalid_input", message);
  }
}

/**
 * The record changed on the server since this client last saw it. The
 * optimistic update is rolled back and the fresh record is fetched.
 */
export class ConflictError extends ResourceKitError {
  constructor(message: string) {
    super("conflict", message);
  }
}

/**
 * The authoritative source refused a mutation for a business reason.
 * The optimistic update is rolled back; the mutation will not be retried.
 */
export class MutationRejectedError extends ResourceKitError {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super("rejected", message);
  }
}

/**
 * The network failed before the server could answer. Retryable:
 * pending mutations stay queued and are replayed when back online.
 */
export class TransportError extends ResourceKitError {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super("transport", message);
  }
}

/** Codes whose class can be rebuilt from a message alone. */
const WIRE_CONSTRUCTORS: Partial<
  Record<ErrorCode, new (message: string) => ResourceKitError>
> = {
  access_denied: AccessDeniedError,
  conflict: ConflictError,
  invalid_input: InvalidInputError,
  no_backbone: NoBackboneError,
  unsupported: UnsupportedOperationError,
  rejected: MutationRejectedError,
};

/**
 * Rebuild a typed error from a `{ code, message }` pair off the wire.
 * The code is always preserved verbatim (unknown codes map to
 * "internal"); codes with a message-only constructor also get their
 * class back for `instanceof` checks.
 */
export function errorFromWire(code: string, message: string): ResourceKitError {
  if (!isErrorCode(code)) return new ResourceKitError("internal", message);
  const Constructor = WIRE_CONSTRUCTORS[code];
  return Constructor
    ? new Constructor(message)
    : new ResourceKitError(code, message);
}
