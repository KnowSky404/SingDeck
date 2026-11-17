import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceProvider } from "./provider";
import App from "./app";
import "@/styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  </StrictMode>,
);
