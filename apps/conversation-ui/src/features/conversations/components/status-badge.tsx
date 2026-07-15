const labels: Readonly<Record<string, string>> = {
  completed: "Completed",
  failed: "Failed",
  running: "Running",
  stopped: "Stopped",
};

export function StatusBadge({ state }: { state: string }) {
  const tone = Object.hasOwn(labels, state) ? state : "unknown";
  return (
    <span className={`status status--${tone}`}>
      <span aria-hidden="true" className="status__dot" />
      {labels[state] ?? state}
    </span>
  );
}
