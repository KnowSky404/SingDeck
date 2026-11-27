import { createContext, useContext } from "react";
import type { InstanceSession } from "@/api/session";
import type { Snapshot } from "@/api/state";
import type { Profile } from "@/features/instances/profiles";
import type { Translate } from "@/lib/i18n";
import type { DisplayPreferences } from "./display-preferences";

export interface Workspace extends DisplayPreferences {
  profile: Profile;
  profiles: Profile[];
  session: InstanceSession;
  snapshot: Snapshot;
  setTheme: (theme: DisplayPreferences["theme"]) => void;
  setLanguage: (language: DisplayPreferences["language"]) => void;
  setOverviewLayout: (layout: DisplayPreferences["overviewLayout"]) => void;
  applyDisplayPreferences: (preferences: DisplayPreferences) => boolean;
  t: Translate;
  selectProfile: (id: string) => void;
  saveProfile: (profile: Profile, token: string, remember: boolean) => void;
  connect: () => void;
  disconnect: () => void;
  forgetSavedConnection: () => void;
  token: string;
  restoring: boolean;
  disconnecting: boolean;
  restoredConnection: boolean;
  remembering: boolean;
  storageError?: string;
}
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("Workspace provider is required");
  return workspace;
}
