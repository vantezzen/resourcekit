import {
  engine,
  fetchTransport,
  TransportError,
  type Transport,
} from "resourcekit";
import { network } from "./network";
import { resources } from "./resources";

const post = fetchTransport("/sync");

// Wrap the real transport so the demo can simulate going offline and
// count how many requests actually leave the device.
const transport: Transport = (message) => {
  if (network.state().offline) {
    return Promise.reject(new TransportError("Offline (demo)."));
  }
  network.countRequest();
  return post(message);
};

export const appEngine = engine({
  resources,
  transport,
  // Cache and queued offline writes survive reloads.
  persist: "flowboard",
  // Edits in another window show up here without refetching by hand.
  live: "/sync/events",
});
