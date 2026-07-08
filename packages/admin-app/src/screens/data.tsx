// The Data explorer area's shared shell (operator-data-explorer, ported from the SSR
// pages/data.tsx). Three purpose-built explorers over D1 + the R2 corpus — Recipes
// (data-recipes.tsx), Stores (data-stores.tsx), and Guidance (data-guidance.tsx) — share
// this sub-nav; `detail` hides it entirely so an open record owns the full width (the
// SSR "sub-nav hides behind an open detail" requirement). All reads: search/mode/
// pagination and detail ride validated route search/path params, so every state stays
// deep-linkable exactly as the SSR query strings were.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { apiErrorOf } from "../lib/api";

const VIEWS = [
  { slug: "recipes", to: "/data/recipes", label: "Recipes" },
  { slug: "stores", to: "/data/stores", label: "Stores" },
  { slug: "guidance", to: "/data/guidance", label: "Guidance" },
] as const;

type DataView = (typeof VIEWS)[number]["slug"];

/** The Data area shell. `active` selects the sub-nav pill; `detail` hides the sub-nav
 *  entirely so an open record owns the full width. */
export const DataShell = ({
  active,
  detail,
  children,
}: {
  active: DataView;
  detail?: boolean;
  children?: React.ReactNode;
}) => (
  <>
    {!detail ? (
      <div className="data-nav">
        {VIEWS.map((v) => (
          <Link key={v.slug} to={v.to} className={v.slug === active ? "pill active" : "pill"}>
            {v.label}
          </Link>
        ))}
      </div>
    ) : null}
    {children}
  </>
);

/** A failed primary query's display message (the structured ApiError when it carries one). */
export function queryErrorMessage(e: unknown): string {
  return apiErrorOf(e)?.message ?? String(e);
}
