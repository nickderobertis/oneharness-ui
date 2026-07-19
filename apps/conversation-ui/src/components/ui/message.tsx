import type { ComponentProps, ReactNode } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/components/utils";

const allowedMarkdownElements = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

type MessageProps = ComponentProps<"div"> & {
  from: "assistant" | "user";
};

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        from === "user"
          ? "flex justify-end"
          : "grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3.5",
        className,
      )}
      data-message-author={from}
      {...props}
    />
  );
}

export function MessageContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-w-0", className)} {...props} />;
}

export function MessageAvatar({ children }: { children: ReactNode }) {
  return (
    <Avatar aria-hidden="true" className="size-8 rounded-[9px]">
      <AvatarFallback className="bg-primary text-[9px] font-extrabold text-primary-foreground">
        {children}
      </AvatarFallback>
    </Avatar>
  );
}

function parseJson(source: string): unknown | undefined {
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

export function MessageResponse({ children, label }: { children: string; label: string }) {
  const json = parseJson(children);
  if (json !== undefined) {
    return (
      <pre aria-label={`${label} formatted JSON`} className="message-json whitespace-pre">
        <code>{JSON.stringify(json, null, 2)}</code>
      </pre>
    );
  }

  return (
    <div className="message-markdown">
      <Markdown
        allowedElements={[...allowedMarkdownElements]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml={true}
      >
        {children}
      </Markdown>
    </div>
  );
}
