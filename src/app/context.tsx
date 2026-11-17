import { createContext, useContext } from "react";
import type { InstanceSession } from "@/api/session";
import type { Snapshot } from "@/api/state";
import type { MockControl } from "@/mocks/client";
import type { Profile, Theme } from "@/features/instances/profiles";

export interface Workspace {
  profile: Profile;
  profiles: Profile[];
  session: InstanceSession;
  snapshot: Snapshot;
  mockControl: MockControl;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  selectProfile: (id: string) => void;
  saveProfile: (profile: Profile, token: string) => void;
  connect: () => void;
  disconnect: () => void;
  token: string;
  storageError?: string;
}
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("Workspace provider is required");
  return workspace;
}
