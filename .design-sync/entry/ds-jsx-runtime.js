// The hono->React element shim, baked into the design-export entry. esbuild's
// automatic runtime compiles `<div class="card">` to jsx("div", { class: "card" });
// React wants `className`/`htmlFor`, so we rename at the factory boundary and
// delegate to the REAL react/jsx-runtime (left external here, so the design-sync
// converter's own reactShim later redirects it to window.React.createElement).
// The component SOURCE (src/admin/ui/kit.tsx) is never edited.
import { jsx as rjsx, jsxs as rjsxs, Fragment } from "react/jsx-runtime";

function fix(props) {
  if (!props || (props.class == null && props.for == null)) return props;
  const { class: cls, for: htmlFor, ...rest } = props;
  if (cls != null) rest.className = cls;
  if (htmlFor != null) rest.htmlFor = htmlFor;
  return rest;
}

export const jsx = (type, props, key) => rjsx(type, fix(props), key);
export const jsxs = (type, props, key) => rjsxs(type, fix(props), key);
export { Fragment };
