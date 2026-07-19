const labels: Readonly<Record<string, string>> = {
  completed: "Completed",
  failed: "Failed",
  running: "Running",
  stopped: "Stopped",
};

export function StatusBadge({ state }: { state: string }) {
  const tone = Object.hasOwn(labels, state) ? state : "unknown";
  return (
    <Badge
      className={cn("shrink-0 gap-1.5 uppercase tracking-[.03em]", {
        "text-destructive": tone === "failed",
        "text-primary": tone === "running",
        "text-success": tone === "completed",
        "text-warning": tone === "stopped",
      })}
      variant="outline"
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full bg-current", tone === "running" && "animate-pulse")}
      />
      {labels[state] ?? state}
    </Badge>
  );
}

import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/utils";
