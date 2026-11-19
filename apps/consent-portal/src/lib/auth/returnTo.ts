/** Only same-origin paths: a return target taken from a query string is
 * otherwise an open redirect. */
export function safeReturnTo(value: string | null | undefined): string {
  // `/\host` is read by browsers as `//host`, so a backslash anywhere is
  // refused along with the protocol-relative form.
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.startsWith('/auth/')) {
    return '/';
  }
  return value;
}
