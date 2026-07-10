import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldProps = {
  label: string;
  htmlFor?: string;
  description?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

export function Field({
  label,
  htmlFor,
  description,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const generatedId = useId();
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  function mergeDescribedBy(existing: unknown) {
    return [typeof existing === "string" ? existing : undefined, describedBy]
      .filter(Boolean)
      .join(" ") || undefined;
  }

  function enhanceChild(child: ReactNode): ReactNode {
    if (!isValidElement(child)) {
      return child;
    }

    const element = child as ReactElement<{
      id?: string;
      children?: ReactNode;
      "aria-describedby"?: string;
      "aria-invalid"?: boolean | "true" | "false";
    }>;
    const type = element.type;
    const isNativeControl =
      type === "input" || type === "textarea" || type === "select";
    const shouldAnnotate = Boolean(element.props.id) || isNativeControl;
    const enhancedChildren = element.props.children
      ? Children.map(element.props.children, enhanceChild)
      : element.props.children;

    if (shouldAnnotate) {
      return cloneElement(element, {
        "aria-describedby": mergeDescribedBy(element.props["aria-describedby"]),
        "aria-invalid": error ? true : element.props["aria-invalid"],
        children: enhancedChildren,
      });
    }

    return cloneElement(element, {
      children: enhancedChildren,
    });
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center">
        <Label htmlFor={htmlFor}>{label}</Label>
        {required ? (
          <span className="ml-1 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </div>
      {Children.map(children, enhanceChild)}
      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground text-pretty">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
