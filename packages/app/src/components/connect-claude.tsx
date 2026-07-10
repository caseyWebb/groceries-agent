// The guided Connect-to-Claude modal (connect-modal): pure UI over the EXISTING
// distribution/connect flow — two tabs of numbered setup steps templated from the
// deployment's operator config (whoami's `operator`, never a hardcoded slug), with
// per-step copyable commands. The Claude.ai tab deliberately carries no Kroger step
// (consent is agent-initiated in chat via kroger_login_url); the Claude Code tab's
// optional Kroger step mints the member's personal one-time consent link through the
// existing session-gated /api/profile/kroger-login-url — the nonce-bound /oauth/init
// accepts no static URL, so there is nothing copyable to render for it.
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconBook,
  IconCheck,
  IconCopy,
  toast,
} from "@yamp/ui";
import { api } from "../lib/api";

/** The whoami `operator` payload (nulls degrade the copy — never a fabricated slug). */
export interface OperatorInfo {
  name: string | null;
  repo: string | null;
}

type Tab = "web" | "code";

interface Step {
  title: string;
  desc: string;
  /** A copyable command/slug; absent steps are instructions only. */
  cmd?: string;
  /** An action button (the Claude Code Kroger step) instead of a copyable command. */
  action?: { label: string; testId: string; run: () => Promise<void> };
}

/** Claude.ai tab: the five marketplace → connector steps (mock microcopy, templated). */
function webSteps(op: OperatorInfo): Step[] {
  const operator = op.name ?? "your operator";
  return [
    op.repo
      ? {
          title: "Add the marketplace",
          desc: "In Claude.ai, go to Customize → Plugins → Add → Add Marketplace → Add from a Repository, and paste this repo:",
          cmd: op.repo,
        }
      : {
          title: "Add the marketplace",
          desc: "In Claude.ai, go to Customize → Plugins → Add → Add Marketplace → Add from a Repository, and paste your operator's marketplace repo (ask your operator for it).",
        },
    {
      title: "Turn on auto-sync",
      desc: `Click the ⋯ menu next to ${op.repo ? op.repo.split("/")[1] : "the marketplace"} and toggle Sync automatically on, so you get updates ${operator} ships.`,
    },
    { title: "Install the yamp plugin", desc: "Find yamp in the marketplace list and click Install." },
    { title: "Open Connectors", desc: "Go back to Customize → Connectors." },
    {
      title: "Connect yamp",
      desc: "Select yamp, click Connect, and enter the invite code your operator sent you if prompted.",
    },
  ];
}

/** Claude Code tab: marketplace + install commands, the /mcp auth step, optional Kroger. */
function codeSteps(op: OperatorInfo, kroger: Step["action"]): Step[] {
  const operator = op.name ?? "your operator";
  return [
    op.repo
      ? {
          title: "Add the marketplace",
          desc: `Registers ${operator}'s yamp plugin marketplace. Adding a public marketplace needs no account.`,
          cmd: `/plugin marketplace add ${op.repo}`,
        }
      : {
          title: "Add the marketplace",
          desc: "Ask your operator for their marketplace repo, then run /plugin marketplace add <their repo>. Adding a public marketplace needs no account.",
        },
    {
      title: "Install the plugin",
      desc: "Installs the yamp skills and connects yamp to your Worker.",
      cmd: "/plugin install yamp@yamp",
    },
    {
      title: "Authorize the connector",
      desc: "Run this and pick yamp — approve the connection from this web app when the authorization page opens, or enter the invite code your operator sent you if prompted.",
      cmd: "/mcp",
    },
    {
      title: "Connect your Kroger cart",
      desc: "Optional — grants cart access so yamp can fill your Kroger order. This mints your personal one-time consent link and opens it.",
      action: kroger,
    },
  ];
}

export function ConnectClaudeModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operator: OperatorInfo;
}) {
  const [tab, setTab] = React.useState<Tab>("web");
  // "Copied" sticks to the last-copied step until another copy (the mock's behavior).
  const [copied, setCopied] = React.useState<string | null>(null);

  async function copy(cmd: string, key: string) {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(key);
    } catch {
      toast("Couldn't copy — select the command text instead");
    }
  }

  async function openKrogerConsent() {
    const res = await api.api.profile["kroger-login-url"].$get().catch(() => null);
    if (!res?.ok) {
      toast("Couldn't mint the Kroger link — try again");
      return;
    }
    const { url } = (await res.json()) as { url: string };
    window.open(url, "_blank", "noopener");
  }

  const steps =
    tab === "web"
      ? webSteps(props.operator)
      : codeSteps(props.operator, {
          label: "Open Kroger consent",
          testId: "connect-kroger",
          run: openKrogerConsent,
        });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="connect-modal gap-0 p-0 sm:max-w-[33rem]" data-testid="connect-modal">
        <div className="modal-head">
          <span className="brand-mark">
            <IconBook />
          </span>
          <div>
            <DialogTitle className="modal-title">Connect to Claude.ai</DialogTitle>
            <DialogDescription className="modal-sub">
              Run <strong>yamp</strong> as a chat agent inside Claude. Pick your client below and follow the
              steps — no GitHub or Kroger account needed on your end.
            </DialogDescription>
          </div>
        </div>
        <div className="modal-tabs">
          <div className="seg">
            <button
              type="button"
              aria-pressed={tab === "web"}
              data-testid="connect-tab-web"
              onClick={() => setTab("web")}
            >
              Claude.ai
            </button>
            <button
              type="button"
              aria-pressed={tab === "code"}
              data-testid="connect-tab-code"
              onClick={() => setTab("code")}
            >
              Claude Code
            </button>
          </div>
        </div>
        <div className="modal-steps">
          {steps.map((s, i) => {
            const n = i + 1;
            const key = `${tab}-${n}`;
            return (
              <div className="cstep" key={key} data-testid={`connect-step-${n}`}>
                <span className="cstep-n">{n}</span>
                <div className="cstep-title">{s.title}</div>
                <div className="cstep-desc">{s.desc}</div>
                {s.cmd ? (
                  <div className="cstep-cmd">
                    <code className="cstep-code" data-testid={`connect-cmd-${n}`}>
                      {s.cmd}
                    </code>
                    <button
                      type="button"
                      className="cstep-copy"
                      data-copied={copied === key || undefined}
                      data-testid={`connect-copy-${n}`}
                      onClick={() => void copy(s.cmd as string, key)}
                    >
                      {copied === key ? <IconCheck /> : <IconCopy />}
                      {copied === key ? "Copied" : "Copy"}
                    </button>
                  </div>
                ) : null}
                {s.action ? (
                  <div className="cstep-cmd">
                    <button
                      type="button"
                      className="cstep-copy"
                      data-testid={s.action.testId}
                      onClick={() => void s.action?.run()}
                    >
                      {s.action.label}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="modal-foot">
          <p className="note">
            Don't have an invite code? Ask your operator — codes are minted per member and shown once in the
            admin panel.
          </p>
          <a
            className="connect-open-claude"
            href="https://claude.ai/new"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="connect-open-claude"
          >
            Open Claude.ai
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
