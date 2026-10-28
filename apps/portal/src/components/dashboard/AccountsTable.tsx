import { Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@wso2/oxygen-ui';
import type { Account } from '../../types';
import { money } from '../../format';

export function AccountsTable({ accounts }: { accounts: Account[] }) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Account</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Number</TableCell>
            <TableCell align="right">Balance</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.id} hover>
              <TableCell sx={{ fontWeight: 600 }}>{account.name}</TableCell>
              <TableCell>
                <Chip label={account.type} size="small" variant="outlined" />
              </TableCell>
              <TableCell sx={{ color: 'text.secondary' }}>{account.id}</TableCell>
              {/* Tabular figures so the decimal points line up down the column. */}
              <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {money(account.balance, account.currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
