import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertDesktopNavigationContract,
  assertRuntimeNavigationContract,
  STATIC_SCREEN_PATHS,
} from "../scripts/static-navigation-contract.mjs";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
let fixtureDirectory;

function fixture(name, source) {
  const path = join(fixtureDirectory, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, "utf8");
  return path;
}

function assertFixture(source, name = "fixture.tsx") {
  assertRuntimeNavigationContract({
    sourcePaths: [fixture(name, source)],
    internalRoutes: STATIC_SCREEN_PATHS,
  });
}

describe("static navigation source contract", () => {
  beforeEach(() => {
    fixtureDirectory = mkdtempSync(join(tmpdir(), "clockhand-navigation-"));
  });

  afterEach(() => {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  });

  it("accepts the current runtime implementation", () => {
    expect(() =>
      assertDesktopNavigationContract({ desktopDir }),
    ).not.toThrow();
  });

  it("rejects namespace access to next/navigation useRouter", () => {
    expect(() =>
      assertFixture(`
        import * as Navigation from "next/navigation";
        export function BrokenLink() {
          const router = Navigation.useRouter();
          return <button onClick={() => router.push("/tasks")}>Tasks</button>;
        }
      `),
    ).toThrow(/next\/navigation useRouter/);
  });

  it("rejects an aliased named useRouter import", () => {
    expect(() =>
      assertFixture(`
        import { useRouter as useDocumentRouter } from "next/navigation";
        export const router = useDocumentRouter;
      `, "named-alias.ts"),
    ).toThrow(/next\/navigation useRouter/);
  });

  it("rejects useRouter obtained through dynamic import", () => {
    expect(() =>
      assertFixture(`
        export async function loadRouter() {
          const Navigation = await import("next/navigation");
          return Navigation.useRouter().replace("/runs");
        }
      `, "dynamic-import.ts"),
    ).toThrow(/next\/navigation useRouter/);
  });

  it("rejects useRouter destructured from require", () => {
    expect(() =>
      assertFixture(`
        const { useRouter: useLegacyRouter } = require("next/navigation");
        export const router = useLegacyRouter();
      `, "require-navigation.ts"),
    ).toThrow(/next\/navigation useRouter/);
  });

  it.each([
    [
      "named alias",
      'import { redirect as go } from "next/navigation"; go("/tasks");',
    ],
    [
      "namespace",
      'import * as Navigation from "next/navigation"; Navigation.permanentRedirect("/tasks");',
    ],
    [
      "default namespace",
      'import Navigation from "next/navigation"; Navigation.redirect("/tasks");',
    ],
    [
      "require destructuring",
      'const { permanentRedirect: go } = require("next/navigation"); go("/tasks");',
    ],
    [
      "dynamic import",
      '(await import("next/navigation")).redirect("/tasks");',
    ],
    [
      "namespace alias chain",
      'const first = require("next/navigation"); const second = first; const go = second.permanentRedirect; go("/tasks");',
    ],
  ])("rejects redirect APIs through %s", (_caseName, source) => {
    expect(() => assertFixture(source, "redirect.ts")).toThrow(
      /read-only API allowlist/,
    );
  });

  it("rejects a next/navigation namespace that escapes analysis", () => {
    expect(() =>
      assertFixture(`
        import * as Navigation from "next/navigation";
        registerNavigationModule(Navigation);
      `, "escaped-namespace.ts"),
    ).toThrow(/cannot be proven read-only/);
  });

  it.each([
    ["next/link through require", 'const Link = require("next/link");'],
    ["next/router through dynamic import", 'const router = import("next/router");'],
  ])("rejects %s", (_caseName, source) => {
    expect(() => assertFixture(source, "forbidden-module.ts")).toThrow(
      /Use AppLink or the document navigation helpers/,
    );
  });

  it.each([
    ['<a href="/tasks">Tasks</a>', "literal-anchor.tsx"],
    ['<a href={`/tasks?task=${taskId}`}>Task</a>', "template-anchor.tsx"],
    [
      'const route = "/runs"; export const link = <a href={route}>Runs</a>',
      "const-anchor.tsx",
    ],
    [
      'export const link = <a href={external ? "https://example.com" : "/settings"}>Settings</a>',
      "conditional-anchor.tsx",
    ],
    [
      'export const Link = ({ href }) => <a href={href}>Link</a>',
      "dynamic-anchor.tsx",
    ],
    [
      'export const Link = (props) => <a {...props}>Link</a>',
      "spread-anchor.tsx",
    ],
    [
      'export const Link = (props) => <a href="https://example.com" {...props}>Link</a>',
      "overriding-spread-anchor.tsx",
    ],
  ])("rejects unsafe raw anchor %s", (source, name) => {
    const fixtureSource = source.startsWith("<a")
      ? `export const link = ${source};`
      : source;
    expect(() => assertFixture(fixtureSource, name)).toThrow(/Raw anchors/);
  });

  it.each([
    ['history.pushState({}, "", "/tasks");', "history-path.ts"],
    [
      'window.history.replaceState({}, "", destination);',
      "history-dynamic.ts",
    ],
    [
      'const browserHistory = window.history; const replace = browserHistory.replaceState; replace({}, "", "/runs");',
      "history-alias.ts",
    ],
  ])("rejects cross-screen or unresolved History URL: %s", (source, name) => {
    expect(() => assertFixture(source, name)).toThrow(
      /query\/hash-only URL/,
    );
  });

  it("allows read-only next/navigation hooks and static external anchors", () => {
    expect(() =>
      assertFixture(`
        import * as Navigation from "next/navigation";
        import { usePathname, useSearchParams as useQuery } from "next/navigation";

        export function SafeLinks({ href }: { href: string }) {
          const path = Navigation.usePathname() ?? usePathname();
          const query = useQuery();
          return <>
            <a href="https://example.com">External</a>
            <a href="mailto:team@example.com">Email</a>
            <a href="tel:+81000000000">Phone</a>
            <a href="#details">Details</a>
            <span>{href}{path}{query.size}</span>
          </>;
        }
      `),
    ).not.toThrow();
  });

  it("allows query/hash-only History updates", () => {
    expect(() =>
      assertFixture(`
        const query = condition ? "?task=task_1" : "?view=archived";
        history.pushState({}, "", query);
        window.history.replaceState({}, "", \`#run-\${runId}\`);
      `, "history-query.ts"),
    ).not.toThrow();
  });

  it("allows the reasoned dynamic anchor exception for the Markdown renderer", () => {
    expect(() =>
      assertFixture(`
        export const MarkdownAnchor = ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">{children}</a>
        );
      `, "components/markdown-content.tsx"),
    ).not.toThrow();
  });
});
