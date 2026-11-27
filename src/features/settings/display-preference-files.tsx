import { useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { useWorkspace } from "@/app/context";
import {
  displayPreferenceFileLimit,
  parseDisplayPreferenceFile,
  serializeDisplayPreferenceFile,
} from "@/app/display-preferences";
import { Panel } from "@/components/shared";
import { Button } from "@/components/ui/button";

export function DisplayPreferenceFiles() {
  const { theme, language, overviewLayout, applyDisplayPreferences, t } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const readGeneration = useRef(0);
  const [feedback, setFeedback] = useState("");

  useLayoutEffect(() => () => { readGeneration.current++; }, []);

  function exportPreferences() {
    const body = serializeDisplayPreferenceFile({ theme, language, overviewLayout });
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "singdeck-display-preferences.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFeedback("Display preferences exported.");
  }

  async function importPreferences(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const generation = ++readGeneration.current;
    const hash = location.hash;
    const isCurrent = () => generation === readGeneration.current && hash === location.hash;
    if (file.size > displayPreferenceFileLimit) {
      setFeedback("Display preference files must be 4 KB or smaller.");
      return;
    }

    setFeedback("Reading display preferences…");
    let content: string;
    try {
      content = await file.text();
    } catch {
      if (isCurrent()) setFeedback("Could not read the display preferences file.");
      return;
    }
    if (!isCurrent()) return;

    const preferences = parseDisplayPreferenceFile(content);
    if (!preferences) {
      setFeedback("This file is not a supported display preferences file.");
      return;
    }
    const saved = applyDisplayPreferences(preferences);
    setFeedback(saved
      ? "Display preferences imported."
      : "Display preferences applied for this visit. Browser storage is unavailable.");
  }

  return (
    <Panel title="Display preferences" description="Save or load the theme, language and Overview card order.">
      <div className="button-row">
        <Button type="button" variant="outline" onClick={exportPreferences}>
          {t("Export display preferences")}
        </Button>
        <Button type="button" variant="outline" onClick={() => input.current?.click()}>
          {t("Import display preferences")}
        </Button>
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={importPreferences} />
      </div>
      <p role="status" className={feedback ? "footnote" : "sr-only"}>
        {feedback && t(feedback)}
      </p>
    </Panel>
  );
}
