"use client";

import { type FormEvent, useState } from "react";

export function useReplyForm(onSubmit: (message: string) => Promise<void>) {
  const [message, setMessage] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = message.trim();
    if (!value) {
      setValidationError("Write a message first");
      return;
    }
    if (value.length > 32_000) {
      setValidationError("Message must contain at most 32000 characters");
      return;
    }
    setValidationError(null);
    try {
      await onSubmit(value);
      setMessage("");
    } catch {
      // The mutation error is rendered by the form; retain the draft for a retry.
    }
  }

  return { message, setMessage, submit, validationError };
}
