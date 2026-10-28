/** The bank's product catalogue: what a customer could apply for.
 *
 * Not the customer's holdings -- nothing here is personal, which is why it
 * needs no consent and no token. That contrast is the point: the assistant can
 * answer "what loans do you offer?" without asking permission, and cannot
 * answer "what's my balance?" without it.
 *
 * Rates and limits only. A real catalogue carries eligibility rules, fee
 * schedules and disclosure documents; none of it changes how the assistant
 * behaves, so it would be surface with no caller.
 */
export const products = [
  {
    id: 'personal-loan',
    name: 'Personal Loan',
    type: 'LOAN',
    description: 'Unsecured borrowing for home improvements, consolidation or a large purchase.',
    interestRate: 5.9,
    rateType: 'FIXED',
    minAmount: 1000,
    maxAmount: 50000,
    termMonths: { min: 12, max: 84 },
    currency: 'USD',
  },
  {
    id: 'car-loan',
    name: 'Car Loan',
    type: 'LOAN',
    description: 'Secured against the vehicle, so the rate is lower than an unsecured loan.',
    interestRate: 4.2,
    rateType: 'FIXED',
    minAmount: 5000,
    maxAmount: 75000,
    termMonths: { min: 24, max: 84 },
    currency: 'USD',
  },
  {
    id: 'residential-mortgage',
    name: 'Residential Mortgage',
    type: 'MORTGAGE',
    description: 'Variable rate mortgage for a home you intend to live in.',
    interestRate: 6.45,
    rateType: 'VARIABLE',
    minAmount: 50000,
    maxAmount: 1000000,
    termMonths: { min: 60, max: 360 },
    currency: 'USD',
  },
  {
    id: 'high-yield-savings',
    name: 'High-Yield Savings',
    type: 'SAVINGS',
    description: 'Instant access savings with interest paid monthly.',
    interestRate: 4.1,
    rateType: 'VARIABLE',
    minAmount: 1,
    maxAmount: null,
    termMonths: null,
    currency: 'USD',
  },
  {
    id: 'business-loan',
    name: 'Small Business Loan',
    type: 'LOAN',
    description: 'Working capital or equipment finance for established businesses.',
    interestRate: 7.25,
    rateType: 'VARIABLE',
    minAmount: 10000,
    maxAmount: 250000,
    termMonths: { min: 12, max: 120 },
    currency: 'USD',
  },
];
