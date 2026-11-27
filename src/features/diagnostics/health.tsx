import { Copy, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspace } from "@/app/context";
import {
  Choice,
  EmptyState,
  Notice,
  PageHeading,
  Panel,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ServiceStatus_Type, type DeprecatedWarning } from "@/proto/daemon/started_service_pb";

const releases = new Intl.Collator("en", { numeric: true });

function migrationURL(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (
    url.origin === "https://sing-box.sagernet.org" &&
    url.pathname === "/migration/" &&
    !url.username &&
    !url.password &&
    !url.search &&
    (url.hash === "" || /^#migrate-[a-z0-9-]+$/.test(url.hash))
  )
    return url.href;
}

function compareWarnings(a: DeprecatedWarning, b: DeprecatedWarning) {
  const urgency = Number(b.impending) - Number(a.impending);
  if (urgency !== 0) return urgency;
  if (!a.scheduledVersion || !b.scheduledVersion)
    return Number(!a.scheduledVersion) - Number(!b.scheduledVersion);
  return releases.compare(a.scheduledVersion, b.scheduledVersion);
}

export default function ConfigurationHealth() {
  const { session, snapshot, t } = useWorkspace();
  const { capabilities, checkingWarnings, phase, version, warnings } =
    snapshot;
  const capability = capabilities.deprecatedWarnings;
  const [urgency, setUrgency] = useState("all");
  const [copyFeedback, setCopyFeedback] = useState("");
  const visible = useMemo(
    () =>
      warnings
        ?.filter(
          (warning) =>
            urgency === "all" || warning.impending === (urgency === "impending"),
        )
        .sort(compareWarnings) ?? [],
    [warnings, urgency],
  );
  const coreRunning = snapshot.service?.status === ServiceStatus_Type.STARTED;
  const serviceError = snapshot.streamErrors.service;
  const checking = checkingWarnings ||
    (coreRunning && !serviceError && (
      phase === "reconnecting" || (phase === "connected" && !session.canRefreshWarnings)
    ));
  const canRefresh =
    phase === "connected" &&
    session.canRefreshWarnings &&
    capability.status !== "unsupported";

  async function copy(warning: DeprecatedWarning, migration?: string) {
    const details = [
      warning.message,
      warning.description,
      t(warning.impending ? "Impending removal" : "Deprecated"),
      warning.deprecatedVersion &&
        `${t("Deprecated version")} ${warning.deprecatedVersion}`,
      warning.scheduledVersion &&
        `${t("Scheduled removal version")} ${warning.scheduledVersion}`,
      migration,
    ];
    try {
      await navigator.clipboard.writeText(details.filter(Boolean).join("\n"));
      setCopyFeedback("Warning copied.");
    } catch {
      setCopyFeedback("Could not copy the warning. Check clipboard permissions.");
    }
  }

  return (
    <>
      <PageHeading title="Configuration health" />
      <Panel
        title="Configuration health"
        description="Deprecation warnings reported by the core."
      >
        <dl className="detail-list">
          <div>
            <dt>{t("Core version")}</dt>
            <dd>{version?.version ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("API version")}</dt>
            <dd>{version?.apiVersion ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("Deprecation warnings")}</dt>
            <dd>{warnings?.length ?? "—"}</dd>
          </div>
        </dl>
      </Panel>
      <div className="toolbar">
        <Choice
          label="Warning urgency"
          value={urgency}
          onChange={setUrgency}
          options={[
            { value: "all", label: t("All warnings") },
            { value: "impending", label: t("Impending removal") },
            { value: "deprecated", label: t("Other deprecations") },
          ]}
        />
        <Button
          variant="outline"
          disabled={!canRefresh || checking}
          aria-busy={checking || undefined}
          onClick={() => {
            setCopyFeedback("");
            void session.refreshWarnings();
          }}
        >
          {checking ? (
            <LoaderCircle className="spin" data-icon="inline-start" />
          ) : (
            <RefreshCw data-icon="inline-start" />
          )}
          {t("Refresh warnings")}
        </Button>
      </div>
      <p role="status" className={copyFeedback ? "footnote" : "sr-only"}>
        {t(copyFeedback)}
      </p>
      {capability.error && (
        <Notice title="Warnings unavailable">
          {t(capability.error)}{" "}
          {warnings?.length ? t("Retained data may be stale.") : null}
        </Notice>
      )}
      {checking && (
        <p className="footnote" role="status">
          {t("Checking for deprecation warnings…")}
        </p>
      )}
      {!checking && !canRefresh && !capability.error && (
        <Notice title="Warnings unavailable">
          {t(serviceError ?? (coreRunning
            ? "Reconnect to the core to check for warnings."
            : "The core must be running to check for warnings."))}
        </Notice>
      )}
      {warnings?.length === 0 &&
        !checking &&
        capability.status === "supported" && (
          <EmptyState
            title="No warnings reported"
            description="Some instances report deprecations only in their logs. Use the core logs or sing-box check for broader configuration validation."
          />
        )}
      {warnings && warnings.length > 0 && visible.length === 0 && (
        <EmptyState
          title="No matching warnings"
          description="Choose another urgency filter to see more warnings."
        />
      )}
      {visible.length > 0 && (
        <ul className="feature-stack list-none">
          {visible.map((warning) => {
            const migration = migrationURL(warning.migrationLink);
            return (
              <li key={JSON.stringify(warning)} className="min-w-0">
                <Panel
                  title={
                    <h2 className="wrap-anywhere">
                      {warning.message || t("Deprecation warning")}
                    </h2>
                  }
                >
                  <Badge variant={warning.impending ? "destructive" : "secondary"}>
                    {t(warning.impending ? "Impending removal" : "Deprecated")}
                  </Badge>
                  {warning.description && (
                    <p className="mt-2 wrap-anywhere text-sm text-muted-foreground">
                      {warning.description}
                    </p>
                  )}
                  <dl className="detail-list">
                    <div>
                      <dt>{t("Deprecated version")}</dt>
                      <dd>{warning.deprecatedVersion || "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("Scheduled removal version")}</dt>
                      <dd>{warning.scheduledVersion || "—"}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copy(warning, migration)}
                    >
                      <Copy data-icon="inline-start" />
                      {t("Copy warning")}
                    </Button>
                    {migration && (
                      <Button variant="link" size="sm" asChild>
                        <a href={migration} target="_blank" rel="noreferrer">
                          {t("Migration guide")}
                          <ExternalLink data-icon="inline-end" />
                        </a>
                      </Button>
                    )}
                  </div>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
