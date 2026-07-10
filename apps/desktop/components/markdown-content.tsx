import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type MarkdownContentProps = {
  content: string;
  className?: string;
};

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h2 className="mb-2 mt-5 text-balance text-base font-semibold first:mt-0">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="mb-2 mt-5 text-balance text-sm font-semibold first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mb-2 mt-4 text-balance text-sm font-semibold first:mt-0">
      {children}
    </h4>
  ),
  h4: ({ children }) => (
    <h5 className="mb-2 mt-4 text-balance text-sm font-semibold first:mt-0">
      {children}
    </h5>
  ),
  h5: ({ children }) => (
    <h6 className="mb-2 mt-4 text-balance text-sm font-semibold first:mt-0">
      {children}
    </h6>
  ),
  h6: ({ children }) => (
    <h6 className="mb-2 mt-4 text-balance text-sm font-semibold first:mt-0">
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p className="my-3 text-pretty first:mt-0 last:mb-0">{children}</p>
  ),
  a: ({ children, href, title }) => (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer"
      className="break-words font-medium text-accent-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  ul: ({ children, className }) => (
    <ul
      className={cn(
        "my-3 flex list-disc flex-col gap-1 pl-5 first:mt-0 last:mb-0",
        className,
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children, className }) => (
    <ol
      className={cn(
        "my-3 flex list-decimal flex-col gap-1 pl-5 first:mt-0 last:mb-0",
        className,
      )}
    >
      {children}
    </ol>
  ),
  li: ({ children, className }) => (
    <li className={cn("pl-1 text-pretty", className)}>{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l pl-3 text-muted-foreground first:mt-0 last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code
      className={cn(
        "rounded bg-background px-1 py-0.5 font-mono text-xs",
        className,
      )}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 max-h-96 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-5 first:mt-0 last:mb-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-md border first:mt-0 last:mb-0">
      <table className="w-full min-w-max border-collapse text-left text-xs">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b px-3 py-2 font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b px-3 py-2 align-top">{children}</td>
  ),
  input: ({ checked, disabled, type }) => (
    <input
      type={type}
      checked={checked}
      disabled={disabled}
      readOnly
      className="mr-2 size-3.5 align-middle"
    />
  ),
  hr: () => <Separator role="separator" className="my-4" />,
};

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn("min-w-0 break-words text-sm leading-7", className)}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={markdownComponents}
        urlTransform={defaultUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
