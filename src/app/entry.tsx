import {
  ArrowRight,
  FlaskConical,
  Network,
  Layers3,
  Terminal,
} from "lucide-react";
import { useWorkspace } from "./context";
import { Brand } from "@/components/brand";
import { Choice, Panel } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConnectionForm } from "@/features/instances/connection-form";
import type { Theme } from "@/features/instances/profiles";

export default function EntryPage() {
  const { theme, setTheme, selectProfile, snapshot } = useWorkspace();
  return (
    <div className="entry-screen">
      <header className="entry-header">
        <Brand />
        <Choice
          label="Theme"
          value={theme}
          onChange={(value) => setTheme(value as Theme)}
          options={["light", "dark", "system"].map((value) => ({
            value,
            label: `${value[0].toUpperCase() + value.slice(1)} theme`,
          }))}
        />
      </header>
      <main className="entry-main">
        <div className="entry-intro">
          <h1>Connect your network.</h1>
          <p>
            Choose a trusted sing-box instance, or explore SingDeck with demo
            data.
          </p>
        </div>
        <div className="entry-grid">
          <Panel
            title="Connect an instance"
            description="Enter the native Service API address and your Bearer token."
          >
            <ConnectionForm entry />
          </Panel>
          <Panel
            title="Take a look around"
            description="No instance needed. A separate workspace, with clearly labeled simulated data."
            className="entry-demo"
          >
            <Badge variant="secondary">Demo workspace</Badge>
            <ul className="entry-features">
              <li>
                <Layers3 />
                Switch outbounds and explore proxy groups
              </li>
              <li>
                <Network />
                Inspect and filter live connections
              </li>
              <li>
                <Terminal />
                Follow a stream of runtime logs
              </li>
            </ul>
            <Button
              disabled={snapshot.phase === "connecting"}
              onClick={() => {
                location.hash = "/";
                selectProfile("demo");
              }}
            >
              <FlaskConical data-icon="inline-start" />
              Explore demo
              <ArrowRight data-icon="inline-end" />
            </Button>
            <p className="footnote">
              Demo never connects to your local instance.
            </p>
          </Panel>
        </div>
        <p className="entry-footer">
          Your browser connects directly to your instance. Tokens stay in
          memory.
        </p>
      </main>
    </div>
  );
}
