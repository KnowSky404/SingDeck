import {
  ArrowRight,
  FlaskConical,
  Network,
  Layers3,
  Terminal,
} from "lucide-react";
import { useWorkspace } from "./context";
import { Brand } from "@/components/brand";
import { Panel } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConnectionForm } from "@/features/instances/connection-form";
import { WorkspaceControls } from "@/components/workspace-controls";

export default function EntryPage() {
  const { t, profile, selectProfile, snapshot, restoring } = useWorkspace();
  return (
    <div className="entry-screen">
      <header className="entry-header">
        <Brand />
        <WorkspaceControls />
      </header>
      <main className="entry-main">
        <div className="entry-intro">
          <h1>{t("Connect your network.")}</h1>
          <p>
            {t(
              "Choose a trusted sing-box instance, or explore SingDeck with demo data.",
            )}
          </p>
        </div>
        <div className="entry-grid">
          <Panel
            title={t("Connect an instance")}
            description={t(
              "Enter the native Service API address and your Bearer token.",
            )}
          >
            <ConnectionForm key={profile.id} />
          </Panel>
          <Panel
            title={t("Take a look around")}
            description={t(
              "No instance needed. A separate workspace, with clearly labeled simulated data.",
            )}
            className="entry-demo"
          >
            <Badge variant="secondary">{t("Demo workspace")}</Badge>
            <ul className="entry-features">
              <li>
                <Layers3 />
                {t("Switch outbounds and explore proxy groups")}
              </li>
              <li>
                <Network />
                {t("Inspect and filter live connections")}
              </li>
              <li>
                <Terminal />
                {t("Follow a stream of runtime logs")}
              </li>
            </ul>
            <Button
              disabled={restoring || snapshot.phase === "connecting"}
              onClick={() => {
                location.hash = "/";
                selectProfile("demo");
              }}
            >
              <FlaskConical data-icon="inline-start" />
              {t("Explore demo")}
              <ArrowRight data-icon="inline-end" />
            </Button>
            <p className="footnote">
              {t("Demo never connects to your local instance.")}
            </p>
          </Panel>
        </div>
        <p className="entry-footer">
          {t("Your browser connects directly to your instance.")}
        </p>
      </main>
    </div>
  );
}
