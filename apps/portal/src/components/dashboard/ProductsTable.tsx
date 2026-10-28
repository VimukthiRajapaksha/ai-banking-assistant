import { Box, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@wso2/oxygen-ui';
import type { Product } from '../../types';
import { money } from '../../format';

const term = (months: Product['termMonths']) =>
  months ? `${months.min}–${months.max} months` : 'No fixed term';

const range = (product: Product) =>
  product.maxAmount === null
    ? `From ${money(product.minAmount, product.currency)}`
    : `${money(product.minAmount, product.currency)} – ${money(product.maxAmount, product.currency)}`;

/** What the bank offers -- not what this customer holds.
 *
 * Nothing here is personal, which is why it loads without consent and why it
 * sits apart from the accounts above it.
 */
export function ProductsTable({ products }: { products: Product[] }) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Product</TableCell>
            <TableCell>Rate</TableCell>
            <TableCell>Amount</TableCell>
            <TableCell>Term</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.id} hover>
              <TableCell>
                <Box sx={{ fontWeight: 600 }}>{product.name}</Box>
                <Box sx={{ fontSize: 12, color: 'text.secondary' }}>{product.description}</Box>
              </TableCell>
              {/* Rate and its type on one line: they are one fact ("4.2% fixed"),
                  and stacking them made the row twice as tall as the two
                  columns beside it for no added meaning. Left-aligned like the
                  text columns around it: right-aligned, the chips differ in
                  width, so the rates themselves never lined up. */}
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box component="span" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {product.interestRate}%
                  </Box>
                  <Chip label={product.rateType} size="small" variant="outlined" />
                </Box>
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{range(product)}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{term(product.termMonths)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
