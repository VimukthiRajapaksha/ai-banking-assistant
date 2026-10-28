/** Placeholders for the chat input: example questions, a different one each
 * time the panel opens.
 *
 * A real question says more than a description would: it shows that this is
 * an assistant you talk to, and what it can do, in the customer's own words. */
const PLACEHOLDERS = [
  'What did I spend this week?',
  "What's my balance?",
  'Show my last 5 transactions.',
  'How much did I spend on groceries?',
  'Pay my electric bill.',
  'Move $200 to savings.',
  'Any big payments this month?',
  "What's my savings rate?",
  'When did I last get paid?',
  'Which loan suits me best?',
];

/** Where the rotation starts, so it does not always open on the same one. */
const FIRST_PLACEHOLDER = Math.floor(Math.random() * PLACEHOLDERS.length);

/** The placeholder for the nth opening of the panel. Stepping through the list
 * rather than drawing at random shows every one before any repeats, and is a
 * pure function of the count -- a random draw at render time would run twice
 * under StrictMode and lose track of what was last shown. */
export function placeholderFor(opening: number): string {
  return PLACEHOLDERS[(FIRST_PLACEHOLDER + opening) % PLACEHOLDERS.length];
}
