import { Field } from "operator-admin-kit";

export const Username = () => (
  <Field label="Username" name="username" placeholder="e.g. casey" />
);

export const Prefilled = () => (
  <Field label="Invite code" name="invite_code" value="A1B2C3D4" />
);
