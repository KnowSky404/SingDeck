export function redactNativeConnectionText(
  value: string,
  redactText: (value: string) => string,
) {
  if (!value.includes("%") && !value.includes("+")) return redactText(value);
  let candidates = new Set([value]);
  // shortcut: check up to three encoding layers, extend if another supported source nests deeper.
  for (let layer = 0; layer < 3 && candidates.size > 0; layer++) {
    const next = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate.includes("%") && !candidate.includes("+")) continue;
      // Tolerant decoding keeps malformed escapes from shielding encoded credentials.
      const escaped = candidate.replaceAll("&", "%26");
      const encodings = escaped.includes("+")
        ? [escaped, escaped.replaceAll("+", "%2B")]
        : [escaped];
      for (const encoded of encodings) {
        const decoded = new URLSearchParams(`value=${encoded}`).get("value") ?? candidate;
        if (decoded === candidate || next.has(decoded)) continue;
        if (redactText(decoded) !== decoded) return "[redacted]";
        next.add(decoded);
      }
    }
    candidates = next;
  }
  return redactText(value);
}
