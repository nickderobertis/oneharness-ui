import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { JsonCode, parseJsonText } from "./json-code";

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

export function MessageResponse({ children, label }: { children: string; label: string }) {
  const json = parseJsonText(children);
  if (json !== undefined) {
    return <JsonCode className="whitespace-pre" label={`${label} formatted JSON`} value={json} />;
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
