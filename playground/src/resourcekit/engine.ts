import { engine } from "resourcekit";
import { issues } from "./resources";

export const resourceEngine = engine({
  resources: [issues],
  endpoint: "/sync",
});
