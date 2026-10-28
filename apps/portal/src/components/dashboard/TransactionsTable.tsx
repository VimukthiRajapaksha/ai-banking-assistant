import {
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
} from '@wso2/oxygen-ui';
import type { Transaction } from '../../types';
import { money, shortDate } from '../../format';

/** Recent activity across every account.
 *
 * Paged on the server: the bank reports how many transactions match, and each
 * page is a request. Fetching everything to page it in the browser would move
 * the customer's whole history over the wire to show ten rows.
 */
export function TransactionsTable({
  transactions,
  total,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
}: {
  transactions: Transaction[];
  total: number;
  page: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rows: number) => void;
}) {
  return (
    <>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Description</TableCell>
              {/* Rows come from more than one account, so each has to say which. */}
              <TableCell>Account</TableCell>
              <TableCell>Category</TableCell>
              <TableCell align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transactions.map((txn) => (
              <TableRow key={txn.id} hover>
                <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{shortDate(txn.date)}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{txn.description}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{txn.accountName}</TableCell>
                <TableCell>
                  <Chip label={txn.category} size="small" variant="outlined" />
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                    // Money in is the exception worth colouring; money out is
                    // most rows, and colouring those would be noise.
                    color: txn.amount > 0 ? 'success.main' : 'text.primary',
                  }}
                >
                  {txn.amount > 0 ? '+' : ''}
                  {money(txn.amount, txn.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        rowsPerPageOptions={[5, 10, 25]}
        count={total}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={(_event, next) => onPageChange(next)}
        onRowsPerPageChange={(event) => onRowsPerPageChange(parseInt(event.target.value, 10))}
      />
    </>
  );
}
