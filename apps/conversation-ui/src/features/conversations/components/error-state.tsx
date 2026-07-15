import { RefreshIcon } from "@/components/ui/icons";

export function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <section aria-labelledby="error-title" className="state-card state-card--error" role="alert">
      <p className="eyebrow">Local connection</p>
      <h2 id="error-title">Couldn&apos;t load conversations</h2>
      <p>{error.message}</p>
      {"detail" in error && typeof error.detail === "string" ? (
        <details>
          <summary>Technical detail</summary>
          <pre>{error.detail}</pre>
        </details>
      ) : null}
      <button className="button button--secondary" onClick={onRetry} type="button">
        <RefreshIcon /> Retry
      </button>
    </section>
  );
}
