// The `propose` area (member-app-propose): the member app's propose surface as thin
// adapters over the shared ops — `POST /api/propose` calls the SAME `runProposeMealPlan`
// the MCP tool wraps (one contract, D7), and `GET /api/propose/weather` calls the
// extracted `resolveTenantForecast` (D9). The propose POST is a STATELESS READ-SHAPED
// POST: no writes, safe to repeat, neither D8 write class (commit rides P1's class (b)
// plan ops) and deliberately NOT ETag'd (bodies vary; the client caches by request key).
// The propose session lives client-side ONLY — nothing here persists state (the spec'd
// negative guarantee); determinism ("same request body, same week") IS session resume.
// Session-gated per route.

import { Hono } from "hono";
import { z } from "zod";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonWithEtag } from "./etag.js";
import { jsonBody } from "./middleware.js";
import { runProposeMealPlan, PROPOSE_INPUT_SHAPE } from "../meal-plan-proposal-tool.js";
import { buildProposeDeps, resolveTenantForecast } from "../tools.js";

/** The tool's exact input schema (one contract — the shape is shared, not re-declared). */
const proposeInput = z.object(PROPOSE_INPUT_SHAPE);

export const proposeArea = new Hono<ApiEnv>()
  .post("/propose", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const parsed = proposeInput.safeParse(await jsonBody<unknown>(c));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ToolError("validation_failed", `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
    }
    const result = await runProposeMealPlan(c.env, tenant, parsed.data, buildProposeDeps(c.env, tenant.id));
    return c.json(result);
  })
  // The weather strip's read: preference-resolved forecast, ETag'd like every JSON GET.
  // `no_location` throws through the shared error table (a quiet member state, not a
  // failure page); upstream trouble comes back as the fetch's value-shaped error and is
  // re-thrown so it crosses the boundary with its code intact too.
  .get("/propose/weather", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const raw = c.req.query("days");
    let days: number | undefined;
    if (raw !== undefined) {
      days = Number(raw);
      if (!Number.isInteger(days) || days < 1 || days > 16) {
        throw new ToolError("validation_failed", "days must be an integer between 1 and 16");
      }
    }
    const forecast = await resolveTenantForecast(c.env, tenant.id, days);
    if ("error" in forecast) {
      throw new ToolError(forecast.error, "the weather forecast could not be resolved");
    }
    return jsonWithEtag(c, forecast);
  });
