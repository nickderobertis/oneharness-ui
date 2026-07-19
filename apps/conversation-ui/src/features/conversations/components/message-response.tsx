import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

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
