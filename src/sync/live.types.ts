/** A server-side change notification: "data for this resource moved". */
export type LiveChange = {
  resource: string;
};

/**
 * Connects the engine to a change feed. Called once; the returned
 * function disconnects. The built-in connector uses `EventSource`
 * (short-lived connections reconnect automatically, which suits
 * serverless hosts); pass your own for websockets, polling, or any
 * pub/sub you already run.
 */
export type LiveConnector = (
  onChange: (change: LiveChange) => void,
) => () => void;
