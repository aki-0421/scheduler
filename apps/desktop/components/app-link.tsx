import {
  forwardRef,
  type ComponentPropsWithoutRef,
} from "react";

import { toStaticScreenHref } from "@/lib/navigation";

type AppLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  href: string;
};

export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(
  ({ href, ...props }, ref) => (
    <a
      ref={ref}
      href={toStaticScreenHref(href)}
      data-clockhand-navigation="document"
      {...props}
    />
  ),
);

AppLink.displayName = "AppLink";
