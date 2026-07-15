"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowIcon } from "@/components/ui/icons";

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
  const { formState, handleSubmit, register, reset } = useForm<FormValues>({
    defaultValues: { message: "" },
    resolver: zodResolver(formSchema),
  });
  const submit = handleSubmit(async ({ message }) => {
    try {
      await onSubmit(message);
      reset();
    } catch {
      // The mutation error is rendered below; retain the draft for a retry.
    }
  });
  return (
    <form className="reply-form" onSubmit={submit}>
      <label htmlFor="reply">Continue this session</label>
      <div className="reply-form__control">
        <textarea
          aria-describedby="reply-help reply-error"
          disabled={pending}
          id="reply"
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Ask a follow-up…"
          rows={2}
          {...register("message")}
        />
        <button aria-label="Send reply" className="send-button" disabled={pending} type="submit">
          <ArrowIcon />
        </button>
      </div>
      <div className="reply-form__footer">
        <span id="reply-help">Ctrl/⌘ Enter to send · continues the exact native session</span>
        <span aria-live="polite">{pending ? "Continuing session…" : ""}</span>
      </div>
      <p className="form-error" id="reply-error" role="alert">
        {formState.errors.message?.message ?? error?.message ?? ""}
      </p>
    </form>
  );
}
