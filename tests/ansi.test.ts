import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LogLine } from "@/features/logs/log-line";
import { appendLogs } from "@/api/state";
import { create } from "@bufbuild/protobuf";
import { LogSchema, LogLevel } from "@/proto/daemon/started_service_pb";
import { plainLog, parseAnsi } from "@/lib/ansi";

describe("safe ANSI log rendering", () => {
  it("decodes the reported message without losing timestamps or bracketed values", () => {
    const message =
      "\u001b[37mDEBUG\u001b[0m[16737] [\u001b[38;5;168m1679805080\u001b[0m 0ms] router: pre-match[0] inbound=[mixed-in tun-in] => sniff(500ms)";
    const parts = parseAnsi(message);
    expect(parts.map((p) => p.text).join("")).toBe(
      "DEBUG[16737] [1679805080 0ms] router: pre-match[0] inbound=[mixed-in tun-in] => sniff(500ms)",
    );
    expect(parts[0]).toMatchObject({
      text: "DEBUG",
      style: { color: "var(--ansi-7)" },
    });
    expect(parts.find((p) => p.text === "1679805080")?.style.color).toBe(
      "rgb(215, 95, 135)",
    );
    expect(parts.at(-1)?.style).toEqual({});
    expect(plainLog(message)).toBe(parts.map((p) => p.text).join(""));
  });
  it("handles ESC-stripped SGR markers while leaving ordinary bracketed text alone", () => {
    expect(plainLog("[37mDEBUG[0m[16737] router")).toBe("DEBUG[16737] router");
    expect(plainLog("timeout [0ms] [37ms] [500ms] and [0]")).toBe("timeout [0ms] [37ms] [500ms] and [0]");
  });
  it("supports 16/256/RGB colors, background colors and style resets", () => {
    const parts = parseAnsi(
      "\u001b[1;3;4;91;48;2;10;20;30mstyled\u001b[22;23;24;39;49mplain\u001b[38;2;20;40;60mRGB\u001b[0m",
    );
    expect(parts[0].style).toMatchObject({
      fontWeight: 700,
      fontStyle: "italic",
      textDecorationLine: "underline",
      color: "var(--ansi-9)",
      backgroundColor: "rgb(10, 20, 30)",
    });
    expect(parts[1].style.color).toBeUndefined();
    expect(parts[1].style.backgroundColor).toBeUndefined();
    expect(parts[2].style.color).toBe("rgb(20, 40, 60)");
    expect(parseAnsi("\u001b[38;5;255mgray")[0].style.color).toBe(
      "rgb(238, 238, 238)",
    );
  });
  it("removes non-style controls and keeps HTML as plain text with no executable markup", () => {
    const input =
      "\u001b]8;;https://example.org\u0007label\u001b]8;;\u0007\u001b[2K<img src=x onerror=alert(1)>";
    expect(plainLog(input)).toBe("label<img src=x onerror=alert(1)>");
    expect(parseAnsi(input)[0].text).toBe("label<img src=x onerror=alert(1)>");
    expect(
      parseAnsi("\u001b[38;2;999;2;3mtext").every(
        (p) => !String(p.style.color).includes("999"),
      ),
    ).toBe(true);
  });
  it("redacts credentials split by formatting and escapes markup in the actual renderer", () => {
    const [entry] = appendLogs(
      [],
      create(LogSchema, {
        messages: [
          {
            level: LogLevel.INFO,
            message:
              "private-\u001b[37mtoken\u001b[0m <img src=x onerror=alert(1)>",
          },
        ],
      }),
      { value: 0 },
      1,
      "private-token",
    );
    expect(entry.text).toBe("[redacted] <img src=x onerror=alert(1)>");
    expect(entry.message).not.toContain("private-token");
    const rendered = renderToStaticMarkup(createElement(LogLine, { entry }));
    expect(rendered).toContain("&lt;img");
    expect(rendered).not.toContain("<img");
    expect(rendered).not.toContain("private-token");
  });
});
