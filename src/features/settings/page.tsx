import { version } from "../../../package.json";
import { useState } from "react";
import { FlaskConical, WifiOff } from "lucide-react";
import { useWorkspace } from "@/app/context";
import { Notice, PageHeading, Panel } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConnectionForm } from "@/features/instances/connection-form";
import type { Theme } from "@/features/instances/profiles";

export default function Settings() {
  const workspace = useWorkspace();
  const { profile, theme, setTheme, mockControl } = workspace;
  const [offline, setOffline] = useState(mockControl.offline),
    [failNext, setFailNext] = useState(mockControl.failNext);
  return (
    <>
      <PageHeading
        title="Settings"
        description="Make this workspace your own."
      />
      <div className="settings-grid">
        <Panel
          title="Instance connection"
          description="Connect only to a trusted sing-box Service API."
        >
          <ConnectionForm />
        </Panel>
        <div className="feature-stack">
          <Panel
            title="Appearance"
            description="Follow your system, or choose a theme."
          >
            <ToggleGroup
              type="single"
              value={theme}
              onValueChange={(value) => value && setTheme(value as Theme)}
              variant="outline"
              aria-label="Theme"
            >
              {(["light", "dark", "system"] as const).map((value) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  aria-label={`${value} theme`}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Panel>
          <Panel
            title="Development sandbox"
            description="Demo data never replaces a failed real connection."
          >
            {profile.mode !== "mock" ? (
              <>
                <p className="muted-copy">
                  Explore streaming traffic, proxy selection, connection
                  controls and logs without contacting a server.
                </p>
                <Button
                  variant="outline"
                  onClick={() => workspace.selectProfile("demo")}
                >
                  <FlaskConical data-icon="inline-start" />
                  Explore demo
                </Button>
              </>
            ) : (
              <FieldGroup>
                <Notice title="Mock mode">
                  All displayed instance data is simulated.
                </Notice>
                <Field orientation="horizontal">
                  <Switch
                    id="simulate-offline"
                    checked={offline}
                    onCheckedChange={(value) => {
                      mockControl.setOffline(value);
                      setOffline(value);
                    }}
                  />
                  <FieldLabel htmlFor="simulate-offline">
                    <WifiOff />
                    Simulate disconnect
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Switch
                    id="simulate-rpc"
                    checked={failNext}
                    onCheckedChange={(value) => {
                      mockControl.setFailNext(value);
                      setFailNext(value);
                    }}
                  />
                  <FieldLabel htmlFor="simulate-rpc">
                    Fail next mutation
                  </FieldLabel>
                </Field>
                <FieldDescription>
                  Turn disconnect off to exercise automatic recovery. Fail next
                  mutation applies to one select, test or close operation.
                </FieldDescription>
              </FieldGroup>
            )}
          </Panel>
          <Panel
            title="About SingDeck"
            description="A native workspace for your network."
          >
            <dl className="detail-list">
              <div>
                <dt>Dashboard</dt>
                <dd>{version}</dd>
              </div>
              <div>
                <dt>Supported API</dt>
                <dd>4</dd>
              </div>
              <div>
                <dt>Core baseline</dt>
                <dd>1.14.0+</dd>
              </div>
              <div>
                <dt>Transport</dt>
                <dd>gRPC-Web</dd>
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
