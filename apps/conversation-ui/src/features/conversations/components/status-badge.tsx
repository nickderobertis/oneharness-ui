const labels: Readonly<Record<string, string>> = {
  completed: "Completed",
  failed: "Failed",
  running: "Running",
  stopped: "Stopped",
};

export function StatusBadge({ state }: { state: string }) {
  return (
    <span className={`status status--${state}`}>
      <span aria-hidden="true" className="status__dot" />
      {labels[state] ?? state}
    </span>
  );
}
