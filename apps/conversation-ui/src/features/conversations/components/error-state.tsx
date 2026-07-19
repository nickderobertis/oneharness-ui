// llmlint: ignore[changed_behavior_has_e2e] Component tests exercise malformed bridge failures; Playwright separately covers public boundary failure and recovery journeys.
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
    <Alert
      aria-labelledby="error-title"
      className="max-w-xl border-t-3 border-t-destructive bg-card p-7 shadow-xl"
      role="alert"
      variant="destructive"
    >
      <p className="text-[10px] font-bold uppercase tracking-[.13em] text-primary">
        Local connection
      </p>
      <AlertTitle className="mt-2 text-2xl text-foreground" id="error-title">
        Couldn&apos;t load conversations
      </AlertTitle>
      <AlertDescription className="leading-relaxed text-muted-foreground">
        {errorMessage(error)}
      </AlertDescription>
      {detail ? (
        <Collapsible className="my-4">
          <CollapsibleTrigger className="text-xs text-muted-foreground">
            Technical detail
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-[10px]">
              {detail}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <Button onClick={onRetry} type="button" variant="secondary">
        <RefreshIcon /> Retry
      </Button>
    </Alert>
  );
}
