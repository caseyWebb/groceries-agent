# operator-admin-kit — build conventions

A small **operator-admin** kit (member management, service status, recipe-projection admin). The components are authored in hono/jsx and server-rendered in the real panel; this export compiles them to React so a design maps 1:1 onto shippable markup. Import every component from `window.OperatorAdmin.*` (the root `_ds_bundle.js`).

## Setup — no provider, just the stylesheet

These are **presentational** components: **no context/provider to wrap**, and no event handlers (the host app wires behavior). All styling is **global CSS** reachable from `styles.css` (its `@import` closure carries the component styles and the `:root` tokens). Put page content inside the centered column:

```jsx
<div className="wrap">       {/* or "wrap wrap-wide" for the wider 60rem layout */}
  …
</div>
```

## Styling idiom — global semantic classes, NOT utilities

There is **no Tailwind / atomic / utility-class system and no style props** here — do not invent `bg-*`, `p-*`, `flex` utility classes; they will not resolve. Compose the components, plus this fixed semantic class vocabulary and the two CSS tokens:

| Need | Class / token |
|---|---|
| Page column | `wrap`, `wrap wrap-wide` |
| Panel / surface | `card` (or the `Card` component) |
| Key–value row | `row`, with child spans `k` (label) and `v` (value) |
| Button group | `form-actions` |
| Top nav | `nav`, `nav-link`, `nav-link active` |
| De-emphasized text | `muted`, `small` |
| Highlight / one-time secret box | `minted`, `once` |
| Brand accent / danger color | `var(--accent)` (#f4a259), `var(--danger)` (#b00020) |

For status and feedback, prefer the components over raw classes: `Dot` (`state`: ok | fail | never | muted), `TierBadge` (`status`: indexed | skipped | pending | orphaned), `Pill` (`active`), `ErrorBanner` (`message`).

## Where the truth lives

The bundle's `styles.css` and its `@import`s are the authority for the full class + token set — match those names exactly. Each component's `<Name>.d.ts` is its prop contract and `<Name>.prompt.md` its usage notes.

## Idiomatic example

```jsx
const { Card, Table, TierBadge, Button } = window.OperatorAdmin;

<div className="wrap">
  <Card>
    <h2>Members</h2>
    <Table head={<><th>member</th><th>recipes</th></>}>
      <tr><td>casey</td><td><TierBadge status="indexed" /></td></tr>
      <tr><td>sam</td><td><TierBadge status="pending" /></td></tr>
    </Table>
    <div className="form-actions">
      <Button>Onboard member</Button>
      <Button variant="danger">Revoke</Button>
    </div>
  </Card>
</div>
```
