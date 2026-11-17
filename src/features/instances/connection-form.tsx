import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { createNativeClient, validateEndpoint } from "@/api/client";
import { assertCompatible, CompatibilityError } from "@/api/state";
import { describeError } from "@/api/errors";
import { useWorkspace } from "@/app/context";
import { Choice, Notice } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

export function ConnectionForm({ entry = false }: { entry?: boolean }) {
  const workspace = useWorkspace();
  const { profile, profiles, saveProfile } = workspace;
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
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function cancel() {
    request.current?.abort();
    setTesting(false);
    setMessage("");
    workspace.disconnect();
  }
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
  const busy =
    testing ||
    (entry &&
      ["connecting", "reconnecting"].includes(workspace.snapshot.phase));
  return (
    <form onSubmit={save}>
      <FieldGroup>
        {!entry && (
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
        )}
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
            disabled={busy}
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
            disabled={busy}
            placeholder="Held in memory only"
          />
          <FieldDescription>
            Never stored in localStorage, URLs or build artifacts. Re-enter
            after a reload.
          </FieldDescription>
        </Field>
        <div className="security-note">
          <ShieldCheck />
          <p>
            Local instances can use http://127.0.0.1:9090. Allow this site’s
            local-network permission and API CORS origin. Use HTTPS for remote
            instances.
          </p>
        </div>
        <div className="button-row">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void test()}
          >
            {testing && (
              <LoaderCircle className="spin" data-icon="inline-start" />
            )}
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button type="submit" disabled={busy}>
            {entry ? (busy ? "Connecting…" : "Connect") : "Save & connect"}
          </Button>
        </div>
        {entry && busy && (
          <Button type="button" variant="ghost" onClick={cancel}>
            Cancel connection
          </Button>
        )}
        {entry && workspace.snapshot.error && (
          <Notice title="Connection failed">{workspace.snapshot.error}</Notice>
        )}
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
      {!entry && (
        <>
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
        </>
      )}
    </form>
  );
}
