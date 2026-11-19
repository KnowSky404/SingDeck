import { version } from "../../../package.json";
import { useWorkspace } from "@/app/context";
import { PageHeading, Panel } from "@/components/shared";
import { Button } from "@/components/ui/button";

export default function Settings() {
  const { profile, snapshot, t } = useWorkspace();
  return (
    <>
      <PageHeading title={t("Settings")} />
      <div className="settings-grid">
        <Panel title={t("Instance details")}>
          <dl className="detail-list">
            <div>
              <dt>{t("API endpoint")}</dt>
              <dd>
                {profile.mode === "mock"
                  ? t("Demo workspace")
                  : profile.endpoint}
              </dd>
            </div>
            <div>
              <dt>{t("Core version")}</dt>
              <dd>{snapshot.version?.version ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("API version")}</dt>
              <dd>{snapshot.version?.apiVersion ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("Transport")}</dt>
              <dd>gRPC-Web</dd>
            </div>
          </dl>
        </Panel>
        <Panel title={t("Dashboard compatibility")}>
          <dl className="detail-list">
            <div>
              <dt>{t("Dashboard")}</dt>
              <dd>{version}</dd>
            </div>
            <div>
              <dt>{t("Supported API")}</dt>
              <dd>4</dd>
            </div>
            <div>
              <dt>{t("Core baseline")}</dt>
              <dd>1.14.0+</dd>
            </div>
          </dl>
          <div className="button-row">
            <Button variant="outline" asChild>
              <a
                href="https://github.com/KnowSky404/SingDeck/releases/latest"
                target="_blank"
                rel="noreferrer"
              >
                {t("Download dashboard")}
              </a>
            </Button>
            <Button variant="link" asChild>
              <a
                href="https://github.com/KnowSky404/SingDeck/blob/main/docs/deployment.md"
                target="_blank"
                rel="noreferrer"
              >
                {t("Local deployment guide")}
              </a>
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
