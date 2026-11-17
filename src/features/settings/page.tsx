import { useEffect, useRef, useState, type FormEvent } from "react";
import { FlaskConical, LoaderCircle, ShieldCheck, WifiOff } from "lucide-react";
import { createNativeClient, validateEndpoint } from "@/api/client";
import { assertCompatible, CompatibilityError } from "@/api/state";
import { describeError } from "@/api/errors";
import { useWorkspace } from "@/app/context";
import { Choice, Notice, PageHeading, Panel } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Theme } from "@/features/instances/profiles";

export default function Settings() {
  const workspace = useWorkspace();
  const { profile, profiles, theme, setTheme, saveProfile, mockControl } =
    workspace;
  const native = profile.mode === "native" ? profile : profiles[0];
  const [name, setName] = useState(native.name),
    [endpoint, setEndpoint] = useState(native.endpoint),
    [token, setToken] = useState(
      profile.mode === "native" ? workspace.token : "",
    );
  const [autoReconnect, setAutoReconnect] = useState(
    native.preferences.autoReconnect,
  );
  const [intervalMs, setIntervalMs] = useState(
      String(native.preferences.intervalMs),
    ),
    [windowSeconds, setWindowSeconds] = useState(
      String(native.preferences.windowSeconds),
    );
  const [testing, setTesting] = useState(false),
    [message, setMessage] = useState(""),
    [invalid, setInvalid] = useState(false);
  const [offline, setOffline] = useState(mockControl.offline),
    [failNext, setFailNext] = useState(mockControl.failNext);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function validate() {
    if (!name.trim()) throw new Error("Enter an instance name.");
    return validateEndpoint(endpoint.trim());
  }
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      const clean = validate();
      setInvalid(false);
      saveProfile(
        {
          ...native,
          name: name.trim(),
          endpoint: clean,
          tls: clean.startsWith("https:"),
          preferences: {
            autoReconnect,
            intervalMs: Number(intervalMs),
            windowSeconds: Number(windowSeconds),
          },
        },
        token,
      );
      setMessage("Profile saved. Token is held in memory only.");
    } catch (error) {
      setInvalid(true);
      setMessage(error instanceof Error ? error.message : "Invalid profile.");
    }
  }
  async function test() {
    let clean: string;
    try {
      clean = validate();
      setInvalid(false);
    } catch (error) {
      setInvalid(true);
      setMessage(error instanceof Error ? error.message : "Invalid profile.");
      return;
    }
    request.current?.abort();
    const scope = new AbortController();
    request.current = scope;
    setTesting(true);
    setMessage("");
    try {
      const version = await createNativeClient(clean, token).getVersion(
        {},
        { signal: scope.signal },
      );
      assertCompatible(version);
      setMessage(
        `Connection verified: sing-box ${version.version} · API ${version.apiVersion}.`,
      );
    } catch (error) {
      if (!scope.signal.aborted)
        setMessage(
          error instanceof CompatibilityError
            ? error.message
            : describeError(error),
        );
    } finally {
      if (!scope.signal.aborted) setTesting(false);
    }
  }
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
          <form onSubmit={save}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="instance-name">Instance name</FieldLabel>
                <Input
                  id="instance-name"
                  value={name}
                  maxLength={80}
                  required
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="endpoint">API endpoint</FieldLabel>
                <Input
                  id="endpoint"
                  type="url"
                  value={endpoint}
                  required
                  aria-invalid={invalid}
                  placeholder="https://your-instance.example"
                  onChange={(e) => setEndpoint(e.target.value)}
                />
                <FieldDescription>
                  Listener origin or reverse-proxy API prefix. Do not include
                  /dashboard/.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="token">Bearer token</FieldLabel>
                <Input
                  id="token"
                  type="password"
                  value={token}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Held in memory only"
                />
                <FieldDescription>
                  Never stored in localStorage, URLs or build artifacts.
                  Re-enter after a reload.
                </FieldDescription>
              </Field>
              <div className="security-note">
                <ShieldCheck />
                <p>
                  Use HTTPS for remote instances, or a loopback SSH tunnel.
                  Browser certificate and local-network policies remain
                  enforced.
                </p>
              </div>
              <div className="button-row">
                <Button
                  type="button"
                  variant="outline"
                  disabled={testing}
                  onClick={() => void test()}
                >
                  {testing && (
                    <LoaderCircle className="spin" data-icon="inline-start" />
                  )}
                  {testing ? "Testing…" : "Test connection"}
                </Button>
                <Button type="submit" disabled={testing}>
                  Save & connect
                </Button>
              </div>
              {message && (
                <p className="form-message" role="status">
                  {message}
                </p>
              )}
              {workspace.storageError && (
                <Notice title="Settings not persisted">
                  {workspace.storageError}
                </Notice>
              )}
            </FieldGroup>
            <div className="settings-divider" />
            <h3>Live data preferences</h3>
            <FieldGroup>
              <Field orientation="horizontal">
                <Switch
                  id="auto-reconnect"
                  checked={autoReconnect}
                  onCheckedChange={setAutoReconnect}
                />
                <FieldLabel htmlFor="auto-reconnect">
                  Automatically reconnect
                </FieldLabel>
              </Field>
              <Field>
                <FieldLabel>Traffic sample interval</FieldLabel>
                <Choice
                  label="Traffic sample interval"
                  value={intervalMs}
                  onChange={setIntervalMs}
                  options={[
                    { value: "1000", label: "Every 1 second" },
                    { value: "2000", label: "Every 2 seconds" },
                    { value: "5000", label: "Every 5 seconds" },
                  ]}
                />
              </Field>
              <Field>
                <FieldLabel>Chart time window</FieldLabel>
                <Choice
                  label="Chart time window"
                  value={windowSeconds}
                  onChange={setWindowSeconds}
                  options={[
                    { value: "60", label: "Last 60 seconds" },
                    { value: "180", label: "Last 3 minutes" },
                    { value: "300", label: "Last 5 minutes" },
                  ]}
                />
                <FieldDescription>
                  Apply with Save & connect. Changing settings starts a fresh
                  subscription scope.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
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
                <dd>0.1.0</dd>
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
