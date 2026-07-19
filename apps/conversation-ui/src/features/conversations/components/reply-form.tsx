"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Send } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const formSchema = z.object({
  message: z.string().trim().min(1, "Write a message first").max(32_000),
});
type FormValues = z.infer<typeof formSchema>;

export function ReplyForm({
  error,
  onSubmit,
  pending,
}: {
  error: Error | null;
  onSubmit: (message: string) => Promise<void>;
  pending: boolean;
}) {
  const form = useForm<FormValues>({
    defaultValues: { message: "" },
    resolver: zodResolver(formSchema),
  });
  const submit = form.handleSubmit(async ({ message }) => {
    try {
      await onSubmit(message);
      form.reset();
    } catch {
      // The mutation error is rendered below; retain the draft for a retry.
    }
  });
  return (
    <Form {...form}>
      <form className="mx-auto max-w-[850px]" onSubmit={submit}>
        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Continue this session</FormLabel>
              <div className="flex items-end gap-2.5 rounded-xl border border-input bg-popover p-2 shadow-[0_18px_60px_rgb(0_0_0/.25)] focus-within:border-primary">
                <FormControl>
                  <Textarea
                    aria-describedby="reply-help reply-error"
                    className="max-h-45 min-h-12 resize-y border-0 bg-transparent p-2.5 shadow-none focus-visible:ring-0"
                    disabled={pending}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder="Ask a follow-up…"
                    rows={2}
                    {...field}
                  />
                </FormControl>
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
                <span id="reply-help">
                  Ctrl/⌘ Enter to send · continues the exact native session
                </span>
                <span aria-live="polite">{pending ? "Continuing session…" : ""}</span>
              </div>
              <FormMessage id="reply-error" role="alert">
                {error?.message}
              </FormMessage>
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
