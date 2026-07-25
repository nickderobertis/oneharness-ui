"use client";

import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useReplyForm } from "../hooks/use-reply-form";

export function ReplyForm({
  error,
  onSubmit,
  pending,
}: {
  error: Error | null;
  onSubmit: (message: string) => Promise<void>;
  pending: boolean;
}) {
  const { message, setMessage, submit, validationError } = useReplyForm(onSubmit);

  return (
    <form className="mx-auto max-w-[850px]" onSubmit={submit}>
      <Label htmlFor="oneharness-reply">Continue this session</Label>
      <div className="flex items-end gap-2.5 rounded-xl border border-input bg-popover p-2 shadow-[0_18px_60px_rgb(0_0_0/.25)] focus-within:border-primary">
        <Textarea
          aria-describedby="reply-help reply-error"
          aria-invalid={validationError !== null || error !== null}
          className="max-h-45 min-h-12 resize-y border-0 bg-transparent p-2.5 shadow-none focus-visible:ring-0"
          disabled={pending}
          id="oneharness-reply"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Ask a follow-up…"
          rows={2}
          value={message}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Send reply"
              className="size-10 shrink-0 rounded-[10px]"
              disabled={pending}
              size="icon"
              type="submit"
            >
              <Send />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Send reply</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-4 justify-between px-1 pt-1.5 text-[9px] text-subtle">
        <span id="reply-help">Ctrl/⌘ Enter to send · continues the exact native session</span>
        <span aria-live="polite">{pending ? "Continuing session…" : ""}</span>
      </div>
      <p className="text-sm font-medium text-destructive" id="reply-error" role="alert">
        {validationError ?? error?.message}
      </p>
    </form>
  );
}
