import { Button } from "operator-admin-kit";

export const Primary = () => <Button>Onboard member</Button>;

export const Variants = () => (
  <div className="form-actions">
    <Button>Save</Button>
    <Button variant="link">Rotate invite</Button>
    <Button variant="danger">Revoke</Button>
    <Button variant="danger-solid">Delete tenant</Button>
  </div>
);

export const Submit = () => (
  <Button type="submit" variant="danger-solid">
    Confirm revoke
  </Button>
);
