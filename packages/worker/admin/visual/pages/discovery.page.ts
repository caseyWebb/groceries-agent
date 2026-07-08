// Discovery (/admin/discovery) — the candidate-pipeline view (stat strip, filter pills,
// progression-track cards); Satellites is its sub-page. Fixtures: SEED.discovery rows in
// discovery_log — a retryable error (non-null next_retry_at → Retry/Delete buttons), a
// dietary-gated skip, and an import — see seed.mjs.
import { expect, type Locator, type Page } from "@playwright/test";
import { SEED } from "../seed.mjs";
import { AdminPage } from "./base.page";
import { DialogComponent } from "../components/dialog.component";

export class DiscoveryPage extends AdminPage {
  readonly path = "/admin/discovery";
  readonly area = "discovery";

  async landmark(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Discovery" })).toBeVisible();
  }

  /** A seeded candidate's card is on the pipeline (by its title). */
  async expectCandidate(title: string = SEED.discovery.errTitle): Promise<void> {
    await expect(this.page.getByText(title).first()).toBeVisible();
  }

  satellites(): SatellitesPage {
    return new SatellitesPage(this.page);
  }
}

/** Discovery › Satellites (/admin/discovery/satellites) — the satellite ingest liveness view + the
 *  source-health audit (satellite-source-audit). The landmark is the unconditional Throughput section
 *  label (time-free). The screen renders from the SPA's ["satellites"] query; the audit rows only
 *  exist once that query resolves, so a plain click + visibility assertion suffices (auto-wait —
 *  hydration is app-level, no per-island retry needed). */
export class SatellitesPage extends AdminPage {
  readonly path = "/admin/discovery/satellites";
  readonly area = "discovery-satellites";

  constructor(page: Page) {
    super(page);
  }

  async landmark(): Promise<void> {
    await expect(this.page.locator("p.group-label", { hasText: "Throughput" })).toBeVisible();
  }

  /** A source's audit row, scoped by its name (the `.ig-srcx-name` cell). */
  sourceRow(source: string): Locator {
    return this.page.locator(".ig-srcx", { has: this.page.locator(".ig-srcx-name", { hasText: source }) });
  }

  /** The accept/fail quality label for a source ("92% ok" / "60% failing" / "rejecting"). */
  qualityLabel(source: string): Locator {
    return this.sourceRow(source).locator(".ig-qual-lbl");
  }

  /** The degrading-source quarantine recommendation chip. */
  recommendationChip(source: string): Locator {
    return this.sourceRow(source).locator(".ig-rec");
  }

  /** The recommendation chip's "Quarantine" button (opens the confirm dialog). */
  quarantineButton(source: string): Locator {
    return this.sourceRow(source).locator(".ig-rec-btn");
  }

  /** The held-state block on a quarantined source. */
  quarantinedBlock(source: string): Locator {
    return this.sourceRow(source).locator(".ig-quar");
  }

  /** The held block's "Un-quarantine" button. */
  unquarantineButton(source: string): Locator {
    return this.sourceRow(source).locator(".ig-quar-undo");
  }

  /** A source's rejection-ledger drill-down (revealed after its head is toggled). */
  drilldown(source: string): Locator {
    return this.sourceRow(source).locator(".ig-drill");
  }

  /** Toggle a source's drill-down open (plain click — the row renders after the query resolves). */
  async openDrilldown(source: string): Promise<Locator> {
    const drill = this.drilldown(source);
    await this.sourceRow(source).locator(".ig-srcx-head").click();
    await expect(drill).toBeVisible();
    return drill;
  }

  /** The quarantine confirm modal (Radix dialog, scoped by its accessible name). */
  quarantineConfirm(): DialogComponent {
    return new DialogComponent(this.page.getByRole("dialog", { name: /^Quarantine/ }));
  }

  /** Open the confirm dialog from a source's recommendation chip. */
  async openQuarantineConfirm(source: string): Promise<DialogComponent> {
    const dialog = this.quarantineConfirm();
    await dialog.openVia(this.quarantineButton(source));
    return dialog;
  }

  /** Confirm a pending quarantine (the confirm dialog's destructive submit). */
  async confirmQuarantine(): Promise<void> {
    await this.quarantineConfirm().root.getByRole("button", { name: "Quarantine source" }).click();
  }

  /** Un-quarantine a held source (the hold clears optimistically — asserts it releases). */
  async unquarantine(source: string): Promise<void> {
    const held = this.quarantinedBlock(source);
    await this.unquarantineButton(source).click();
    await expect(held).toBeHidden();
  }
}
