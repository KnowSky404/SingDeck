import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLanguage, translate } from "@/lib/i18n";

afterEach(() => vi.unstubAllGlobals());
describe("language selection and interpolation", () => {
  it("prefers a saved language and otherwise follows the browser even when storage fails", () => {
    vi.stubGlobal("navigator", { language: "zh-CN" });
    vi.stubGlobal("localStorage", { getItem: () => "en" });
    expect(loadLanguage()).toBe("en");
    vi.stubGlobal("localStorage", { getItem: () => "unsupported" });
    expect(loadLanguage()).toBe("zh");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("unavailable");
      },
    });
    expect(loadLanguage()).toBe("zh");
  });
  it("translates UI strings while preserving interpolated instance names and unknown server text", () => {
    expect(translate("zh")("Selected: {name}", { name: "Overview" })).toBe(
      "已选择：Overview",
    );
    expect(translate("en")("Selected: {name}", { name: "节点" })).toBe(
      "Selected: 节点",
    );
    expect(
      translate("zh")("Dashboard version {version}", { version: "v0.4.0" }),
    ).toBe("面板版本 v0.4.0");
    expect(translate("zh")("server-specific message")).toBe(
      "server-specific message",
    );
  });
});
