import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { ResourceKitProvider } from "resourcekit/react";
import { resourceEngine } from "./resourcekit/engine";

createRoot(document.getElementById("root")!).render(
  <ResourceKitProvider engine={resourceEngine}>
    <App />
  </ResourceKitProvider>,
);
