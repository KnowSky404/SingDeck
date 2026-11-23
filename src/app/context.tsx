import { createContext, useContext } from "react";
import type { InstanceSession } from "@/api/session";
import type { Snapshot } from "@/api/state";
import type { Profile, Theme } from "@/features/instances/profiles";
import type { Language, Translate } from "@/lib/i18n";

export interface Workspace {
  profile: Profile;
  profiles: Profile[];
  session: InstanceSession;
  snapshot: Snapshot;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
  selectProfile: (id: string) => void;
  saveProfile: (profile: Profile, token: string, remember: boolean) => void;
  connect: () => void;
  disconnect: () => void;
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
