import { Table, TierBadge } from "operator-admin-kit";

export const Members = () => (
  <Table
    head={
      <>
        <th>member</th>
        <th>recipes</th>
      </>
    }
  >
    <tr>
      <td>casey</td>
      <td>
        <TierBadge status="indexed" />
      </td>
    </tr>
    <tr>
      <td>sam</td>
      <td>
        <TierBadge status="pending" />
      </td>
    </tr>
    <tr>
      <td>jordan</td>
      <td>
        <TierBadge status="skipped" />
      </td>
    </tr>
  </Table>
);
