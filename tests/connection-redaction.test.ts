import { expect, it } from "vitest";
import { redactNativeConnectionText } from "@/features/connections/redaction";

it("redacts literal and percent-encoded values in otherwise unchanged native text", () => {
  const marker = "synthetic+&/marker";
  const redact = (value: string) => value.replaceAll(marker, "[redacted]");
  const encoded = "path=%zz&synthetic+%26%2fmarker";
  expect(redactNativeConnectionText(encoded, redact)).toBe("[redacted]");
  expect(redactNativeConnectionText(`domain=${marker}`, redact)).toBe("domain=[redacted]");
  expect(redactNativeConnectionText("legitimate%20text+&", redact)).toBe("legitimate%20text+&");
});

it("suppresses a field containing both forms of a value with a literal percent escape", () => {
  const marker = "synthetic%2Fmarker";
  const redact = (value: string) => value.replaceAll(marker, "[redacted]");
  const mixed = `literal=${marker}&escaped=${encodeURIComponent(marker)}`;
  expect(redactNativeConnectionText(mixed, redact)).toBe("[redacted]");
});
