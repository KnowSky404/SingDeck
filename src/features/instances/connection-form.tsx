import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { createNativeClient, validateEndpoint } from "@/api/client";
import { assertCompatible, CompatibilityError } from "@/api/state";
import { describeError } from "@/api/errors";
import { useWorkspace } from "@/app/context";
import { Notice } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

export function ConnectionForm() {
  const workspace = useWorkspace();
  const { profile, profiles, saveProfile, t } = workspace;
  const native = profile.mode === "native" ? profile : profiles[0];
  const [endpoint, setEndpoint] = useState(native.endpoint),
    [token, setToken] = useState(
      profile.mode === "native" ? workspace.token : "",
    );
  const [testing, setTesting] = useState(false),
    [message, setMessage] = useState<string | { version: string; api: number }>(
      "",
    ),
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
          endpoint: clean,
          tls: clean.startsWith("https:"),
        },
        token,
      );
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
      setMessage({ version: version.version, api: version.apiVersion });
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
    ["connecting", "reconnecting"].includes(workspace.snapshot.phase);
  return (
    <form onSubmit={save}>
      <FieldGroup>
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor="endpoint">{t("API endpoint")}</FieldLabel>
          <Input
            id="endpoint"
            type="url"
            value={endpoint}
            required
            aria-invalid={invalid}
            placeholder={t("https://your-instance.example")}
            onChange={(e) => setEndpoint(e.target.value)}
            disabled={busy}
          />
          <FieldDescription>
            {t(
              "Listener origin or reverse-proxy API prefix. Do not include /dashboard/.",
            )}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="token">{t("Bearer token")}</FieldLabel>
          <Input
            id="token"
            type="password"
            value={token}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setToken(e.target.value)}
            disabled={busy}
            placeholder={t("Held in memory only")}
          />
          <FieldDescription>
            {t(
              "Never stored in localStorage, URLs or build artifacts. Re-enter after a reload.",
            )}
          </FieldDescription>
        </Field>
        <div className="security-note">
          <ShieldCheck />
          <p>
            {t(
              "Local instances can use http://127.0.0.1:9090. Allow this site’s local-network permission and API CORS origin. Use HTTPS for remote instances.",
            )}
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
            {t(testing ? "Testing…" : "Test connection")}
          </Button>
          <Button type="submit" disabled={busy}>
            {t(busy ? "Connecting…" : "Connect")}
          </Button>
        </div>
        {busy && (
          <Button type="button" variant="ghost" onClick={cancel}>
            {t("Cancel connection")}
          </Button>
        )}
        {workspace.snapshot.error && (
          <Notice title={t("Connection failed")}>
            {t(workspace.snapshot.error)}
          </Notice>
        )}
        {message && (
          <p className="form-message" role="status">
            {typeof message === "string"
              ? t(message)
              : t(
                  "Connection verified: sing-box {version} · API {api}.",
                  message,
                )}
          </p>
        )}
        {workspace.storageError && (
          <Notice title={t("Settings not persisted")}>
            {t(workspace.storageError)}
          </Notice>
        )}
      </FieldGroup>
    </form>
  );
}
