import { useCallback, useEffect, useRef, useState } from 'react';
import { useAsgardeo } from '@asgardeo/react';
import { fetchAccounts, fetchProducts, fetchTransactions } from '../api/bankClient';
import type { Account, Product, TransactionPage } from '../types';

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Runs one authenticated bank call and tracks its three outcomes.
 *
 * Every request is aborted when its inputs change or the component unmounts,
 * so a slow first page cannot land after a faster second one and overwrite it.
 * `loading` starts true: there is no honest moment where the screen has no
 * data and is not waiting for any.
 */
function useBankCall<T>(
  call: (token: string, signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> & { reload: () => void } {
  const { getAccessToken } = useAsgardeo();
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);

  // The SDK returns a fresh getAccessToken on every render, so depending on it
  // directly would restart the request continuously.
  const tokenFn = useRef(getAccessToken);
  useEffect(() => {
    tokenFn.current = getAccessToken;
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true }));

    (async () => {
      try {
        const token = await tokenFn.current();
        const data = await call(token, controller.signal);
        if (!controller.signal.aborted) setState({ data, error: null, loading: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ data: null, error: error instanceof Error ? error.message : 'Request failed', loading: false });
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useAccounts() {
  return useBankCall<Account[]>(useCallback((token, signal) => fetchAccounts(token, signal), []), []);
}

export function useProducts() {
  return useBankCall<Product[]>(useCallback((token, signal) => fetchProducts(token, signal), []), []);
}

export function useTransactions(page: number, rowsPerPage: number) {
  return useBankCall<TransactionPage>(
    useCallback(
      (token, signal) => fetchTransactions(token, { limit: rowsPerPage, offset: page * rowsPerPage }, signal),
      [page, rowsPerPage],
    ),
    [page, rowsPerPage],
  );
}
