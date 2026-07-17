import { RefreshIcon } from "@/components/ui/icons";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "The local bridge returned an unexpected error.";
}

function errorDetail(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("detail" in error)) return null;
  return typeof error.detail === "string" ? error.detail : null;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const detail = errorDetail(error);
  return (
    <section aria-labelledby="error-title" className="state-card state-card--error" role="alert">
      <p className="eyebrow">Local connection</p>
      <h2 id="error-title">Couldn&apos;t load conversations</h2>
      <p>{errorMessage(error)}</p>
      {detail ? (
        <details>
          <summary>Technical detail</summary>
          <pre>{detail}</pre>
        </details>
      ) : null}
      <button className="button button--secondary" onClick={onRetry} type="button">
        <RefreshIcon /> Retry
      </button>
    </section>
  );
}
