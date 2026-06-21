import { describe, expect, test } from "bun:test";
import {
  AccessDeniedError,
  ERROR_CODES,
  errorFromWire,
  InvalidInputError,
  MutationRejectedError,
  NoBackboneError,
  NotFoundError,
  ResourceKitError,
  TransportError,
  UnknownResourceError,
} from "./errors";

describe("errorFromWire", () => {
  test("preserves every error code verbatim across the wire", () => {
    for (const code of ERROR_CODES) {
      expect(errorFromWire(code, "boom").code).toBe(code);
    }
  });

  test("rebuilds classes where a message-only constructor exists", () => {
    expect(errorFromWire("access_denied", "no")).toBeInstanceOf(
      AccessDeniedError,
    );
    expect(errorFromWire("invalid_input", "no")).toBeInstanceOf(
      InvalidInputError,
    );
    expect(errorFromWire("no_backbone", "no")).toBeInstanceOf(NoBackboneError);
    expect(errorFromWire("rejected", "no")).toBeInstanceOf(
      MutationRejectedError,
    );
  });

  test("maps unknown codes to internal", () => {
    const error = errorFromWire("something_new", "boom");
    expect(error.code).toBe("internal");
    expect(error.message).toBe("boom");
  });

  test("every thrown class carries its declared code", () => {
    expect(new UnknownResourceError("x", []).code).toBe("unknown_resource");
    expect(new NotFoundError("issues", "a").code).toBe("not_found");
    expect(new TransportError("net").code).toBe("transport");
    expect(new ResourceKitError("internal", "x").code).toBe("internal");
  });
});
