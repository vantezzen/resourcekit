export type Scalar = string | number | boolean | null;
export type Comparable = string | number;

/**
 * Typed author-facing filter input, derived from the resource schema.
 * Structurally a subset of the wire `WhereFilter`, so it needs no
 * conversion when a plan is built.
 */
export type FieldFilterInput<V> =
  | (V & Scalar)
  | ({ eq?: V & Scalar; in?: (V & Scalar)[] } & ([NonNullable<V>] extends [
      Comparable,
    ]
      ? {
          gt?: NonNullable<V>;
          gte?: NonNullable<V>;
          lt?: NonNullable<V>;
          lte?: NonNullable<V>;
        }
      : {}));

export type WhereInput<T> = {
  [K in keyof T & string as NonNullable<T[K]> extends Comparable | boolean
    ? K
    : never]?: FieldFilterInput<T[K]>;
};
