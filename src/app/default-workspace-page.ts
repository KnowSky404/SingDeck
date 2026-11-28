export const defaultWorkspacePages = [
  { value: "/", label: "Overview" },
  { value: "/proxies", label: "Outbounds" },
  { value: "/connections", label: "Connections" },
  { value: "/logs", label: "Logs" },
  { value: "/runtime-monitor", label: "Runtime monitor" },
  { value: "/diagnostics", label: "Diagnostics" },
  { value: "/settings", label: "Settings" },
] as const;

export type DefaultWorkspacePage = (typeof defaultWorkspacePages)[number]["value"];
const storageKey = "singdeck.default-workspace-page";

export function parseDefaultWorkspacePage(value: string | null): DefaultWorkspacePage {
  return defaultWorkspacePages.find((page) => page.value === value)?.value ?? "/";
}

export function loadDefaultWorkspacePage(): DefaultWorkspacePage {
  try {
    return parseDefaultWorkspacePage(localStorage.getItem(storageKey));
  } catch {
    return "/";
  }
}

export function saveDefaultWorkspacePage(page: DefaultWorkspacePage) {
  try {
    localStorage.setItem(storageKey, page);
  } catch {
    /* The selected page remains available in memory. */
  }
}
