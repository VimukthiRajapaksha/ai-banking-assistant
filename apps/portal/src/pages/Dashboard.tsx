import { useMemo, useState } from 'react';
import { Box, Typography } from '@wso2/oxygen-ui';
import { useIdTokenProfile } from '../auth/useIdTokenProfile';
import { useAccounts, useProducts, useTransactions } from '../hooks/useBankData';
import { AccountsTable } from '../components/dashboard/AccountsTable';
import { DataSection } from '../components/dashboard/DataSection';
import { ProductsTable } from '../components/dashboard/ProductsTable';
import { TransactionsTable } from '../components/dashboard/TransactionsTable';
import { money } from '../format';
import { useOnBankDataChanged } from '../bankEvents';

export function Dashboard() {
  const { givenName } = useIdTokenProfile();

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const accounts = useAccounts();
  const transactions = useTransactions(page, rowsPerPage);
  const products = useProducts();

  // A payment made through the chat changes the balance and adds a row.
  // Back to the first page, which is where the new row lands.
  useOnBankDataChanged(() => {
    accounts.reload();
    setPage(0);
    transactions.reload();
  });

  // Net worth is the sum of what the bank reports, in the currency it reports.
  // Mixed currencies would need rates the bank doesn't expose, so this states
  // the currency rather than assuming one.
  const netWorth = useMemo(
    () => (accounts.data ?? []).reduce((total, account) => total + account.balance, 0),
    [accounts.data],
  );
  const currency = accounts.data?.[0]?.currency ?? 'USD';

  return (
    <Box
      sx={{
        // AppShell's content area is a flex row: without these the page
        // shrinks to its widest table and leaves a gap on the right.
        flex: 1,
        minWidth: 0,
        pt: 4,
        pb: 8,
        px: { xs: 2, md: 4 },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 4,
          mb: 5,
        }}
      >
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Welcome back{givenName ? `, ${givenName}` : ''}
        </Typography>

        <Box
          sx={{
            px: 4,
            py: 3,
            borderRadius: 1,
            bgcolor: 'glass.fill',
            backdropFilter: 'blur(12px)',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography
            variant="caption"
            color="primary.main"
            sx={{ fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}
          >
            Total balance
          </Typography>
          <Typography variant="h3" sx={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
            {/* Nothing is shown until the accounts are in: a total that starts
                at zero and jumps is worse than one that arrives late. */}
            {(accounts.loading && !accounts.data) || accounts.error ? '—' : money(netWorth, currency)}
          </Typography>
        </Box>
      </Box>

      <DataSection
        id="accounts"
        title="Accounts"
        loading={accounts.loading && !accounts.data}
        error={accounts.error}
        isEmpty={accounts.data?.length === 0}
        emptyMessage="You have no accounts with us yet."
      >
        <AccountsTable accounts={accounts.data ?? []} />
      </DataSection>

      <DataSection
        id="transactions"
        title="Recent activity"
        loading={transactions.loading && !transactions.data}
        error={transactions.error}
        isEmpty={transactions.data?.total === 0}
        emptyMessage="No transactions on your accounts yet."
      >
        <TransactionsTable
          transactions={transactions.data?.items ?? []}
          total={transactions.data?.total ?? 0}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={setPage}
          onRowsPerPageChange={(rows) => {
            setRowsPerPage(rows);
            setPage(0);
          }}
        />
      </DataSection>

      <DataSection
        id="products"
        title="Products you could apply for"
        loading={products.loading}
        error={products.error}
        isEmpty={products.data?.length === 0}
        emptyMessage="No products are available right now."
      >
        <ProductsTable products={products.data ?? []} />
      </DataSection>

    </Box>
  );
}
