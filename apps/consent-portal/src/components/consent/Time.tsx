'use client';

import { useEffect, useState } from 'react';
import { Box } from '@wso2/oxygen-ui';
import { dateTime, relative } from '@/lib/format';

/** A timestamp, rendered in the browser's time zone.
 *
 * The server renders in its own zone, which is rarely the customer's; the
 * mismatch on hydration is expected and corrected on mount, so the warning is
 * suppressed for this element only. */
export function DateTime({ value }: { value: number }) {
  return (
    <Box component="time" dateTime={new Date(value).toISOString()} suppressHydrationWarning>
      {dateTime(value)}
    </Box>
  );
}

/** The current time, ticking each minute, so anything worded against it --
 * "ends in", "ended" -- stays true on a page left open. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** "in 42 minutes". */
export function Relative({ value }: { value: number }) {
  const now = useNow();
  return (
    <Box component="span" suppressHydrationWarning>
      {relative(value, now)}
    </Box>
  );
}
