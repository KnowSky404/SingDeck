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

it("detects nested percent and form variants while retaining unrelated native text", () => {
  const marker = "synthetic+ space/marker";
  const redact = (value: string) => value.replaceAll(marker, "[redacted]");
  const encodedForm = new URLSearchParams({ marker }).toString().slice("marker=".length);
  const doublyEncoded = encodeURIComponent(encodedForm);
  expect(redactNativeConnectionText(doublyEncoded, redact)).toBe("[redacted]");
  expect(redactNativeConnectionText("p=synthetic%2B+space%2Fmarker", redact))
    .toBe("[redacted]");
  expect(redactNativeConnectionText("safe+value%252F", redact)).toBe("safe+value%252F");
});
