import stripAnsi from "strip-ansi";
import type { CSSProperties } from "react";

export interface AnsiSegment {
  text: string;
  style: CSSProperties;
}

function normalize(message: string): string {
  if (
    message.includes("\u001b") ||
    message.includes("\u009b") ||
    !/\[0m(?!s\])/.test(message)
  )
    return message;
  // Some log writers drop ESC; only interpret their SGR markers when a reset is present.
  return message.replace(/\[([\d;]*)m(?!s\])/g, (marker, parameters: string) => {
    const first = Number(parameters.split(";")[0]);
    return first <= 9 ||
      (first >= 22 && first <= 49) ||
      (first >= 90 && first <= 107)
      ? `\u001b${marker}`
      : marker;
  });
}
export function plainLog(message: string): string {
  return stripAnsi(normalize(message));
}

function indexedColor(index: number): string {
  if (index < 16) return `var(--ansi-${index})`;
  if (index >= 232) {
    const value = 8 + (index - 232) * 10;
    return `rgb(${value}, ${value}, ${value})`;
  }
  const n = index - 16,
    levels = [0, 95, 135, 175, 215, 255];
  return `rgb(${levels[Math.floor(n / 36)]}, ${levels[Math.floor(n / 6) % 6]}, ${levels[n % 6]})`;
}
const byte = (value: number) =>
  Number.isInteger(value) && value >= 0 && value <= 255;

export function parseAnsi(message: string): AnsiSegment[] {
  const input = normalize(message),
    segments: AnsiSegment[] = [];
  let style: CSSProperties = {},
    cursor = 0;
  const append = (text: string) => {
    const clean = stripAnsi(text);
    if (clean) segments.push({ text: clean, style: { ...style } });
  };
  // eslint-disable-next-line no-control-regex -- CSI is the ANSI control sequence being decoded.
  for (const match of input.matchAll(/(?:\u001b\[|\u009b)([\d;]*)m/g)) {
    append(input.slice(cursor, match.index));
    const codes = match[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) style = {};
      else if (code === 1) style.fontWeight = 700;
      else if (code === 2) style.opacity = 0.7;
      else if (code === 3) style.fontStyle = "italic";
      else if (code === 4 || code === 9)
        style.textDecorationLine = [
          ...new Set([
            ...(style.textDecorationLine?.split(" ") ?? []),
            code === 4 ? "underline" : "line-through",
          ]),
        ].join(" ");
      else if (code === 22) {
        delete style.fontWeight;
        delete style.opacity;
      } else if (code === 23) delete style.fontStyle;
      else if (code === 24 || code === 29)
        style.textDecorationLine =
          style.textDecorationLine
            ?.split(" ")
            .filter(
              (value) => value !== (code === 24 ? "underline" : "line-through"),
            )
            .join(" ") || undefined;
      else if (code === 39) delete style.color;
      else if (code === 49) delete style.backgroundColor;
      else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97))
        style.color = indexedColor(code >= 90 ? code - 90 + 8 : code - 30);
      else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107))
        style.backgroundColor = indexedColor(
          code >= 100 ? code - 100 + 8 : code - 40,
        );
      else if (code === 38 || code === 48) {
        const property = code === 38 ? "color" : "backgroundColor";
        if (codes[i + 1] === 5) {
          if (byte(codes[i + 2])) style[property] = indexedColor(codes[i + 2]);
          i += 2;
        } else if (codes[i + 1] === 2) {
          const rgb = codes.slice(i + 2, i + 5);
          if (rgb.length === 3 && rgb.every(byte))
            style[property] = `rgb(${rgb.join(", ")})`;
          i += 4;
        }
      }
    }
    cursor = match.index + match[0].length;
  }
  append(input.slice(cursor));
  return segments;
}
