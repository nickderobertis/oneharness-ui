import type { ReactNode } from "react";
import { cn } from "@/components/utils";

// The scanner runs over text this component produced with JSON.stringify, so the grammar is
// exactly JSON. Class names match the highlight.js JSON tokens the stylesheet already themes for
// fenced code, keeping one colour vocabulary across the transcript.
const jsonTokenPattern = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;

export function parseJsonText(source: string): unknown | undefined {
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

function toJsonText(value: unknown, indent = 2): string {
  try {
    return JSON.stringify(value, null, indent) ?? String(value);
  } catch {
    return String(value);
  }
}

/** One-line JSON for dense summaries such as a collapsed tool row. */
export function compactJsonText(value: unknown): string {
  return toJsonText(value, 0);
}

function tokenClass(value: string, isKey: boolean): string {
  if (value.startsWith('"')) return isKey ? "hljs-attr" : "hljs-string";
  return value === "true" || value === "false" || value === "null" ? "hljs-literal" : "hljs-number";
}

function tokens(source: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plainFrom = 0;
  for (const match of source.matchAll(jsonTokenPattern)) {
    const value = match[0];
    const start = match.index;
    if (start > plainFrom) nodes.push(source.slice(plainFrom, start));
    plainFrom = start + value.length;
    const isKey = /^\s*:/.test(source.slice(plainFrom));
    nodes.push(
      <span className={tokenClass(value, isKey)} key={`${start}-${value.length}`}>
        {value}
      </span>,
    );
  }
  if (plainFrom < source.length) nodes.push(source.slice(plainFrom));
  return nodes;
}

export function JsonCode({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: unknown;
}) {
  return (
    <pre aria-label={label} className={cn("message-json", className)}>
      <code>{tokens(toJsonText(value))}</code>
    </pre>
  );
}
