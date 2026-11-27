export function redactNativeConnectionText(
  value: string,
  redactText: (value: string) => string,
) {
  if (value.includes("%")) {
    // Tolerant decoding keeps malformed escapes from shielding an encoded credential.
    const escaped = value.replaceAll("+", "%2B").replaceAll("&", "%26");
    const decoded = new URLSearchParams(`value=${escaped}`).get("value") ?? value;
    if (decoded !== value && redactText(decoded) !== decoded) return "[redacted]";
  }
  return redactText(value);
}
