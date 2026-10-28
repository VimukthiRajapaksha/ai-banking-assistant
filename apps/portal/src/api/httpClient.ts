/** Shared authenticated fetch -- each caller supplies its own token, so a
 * bank-audience token and a chat-audience token can never be mixed up by
 * accident (same reasoning as the split between bankClient and chatClient). */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** A fresh W3C trace context for one user action.
 *
 * The browser starts the trace because the question starts here: every hop
 * downstream continues this trace rather than beginning its own, so one
 * question is one trace across the UI, agent, MCP server and bank. */
export function newTraceparent(): string {
  return continueTrace(hex(16));
}

/** Another request in an existing trace: same trace id, fresh span id. */
export function continueTrace(traceId: string): string {
  return `00-${traceId}-${hex(8)}-01`;
}

/** The one log this app keeps.
 *
 * It prints the two ids the backends stamp on every line -- the trace for this
 * request and the session for this sitting -- so a single question can be
 * followed from here through the agent, the MCP server and the bank. Nothing
 * else is logged: the request and response bodies carry tokens and account
 * data, and the earlier debug logging printed both. */
function logRequest(method: string, url: string, status: number | string, trace?: { traceparent: string; sessionId?: string }) {
  if (!trace) return;
  const traceId = trace.traceparent.split('-')[1] ?? '-';
  console.info(`[session=${trace.sessionId ?? '-'} trace=${traceId}] ${method} ${url} -> ${status}`);
}

export async function authedFetch<T>(
  url: string,
  token: string,
  init?: RequestInit,
  trace?: { traceparent: string; sessionId?: string },
): Promise<T> {
  const method = init?.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(trace ? { traceparent: trace.traceparent } : {}),
        // W3C baggage: propagated untouched across services, which is how the
        // session id reaches logs the browser never talks to.
        ...(trace?.sessionId ? { baggage: `session.id=${trace.sessionId}` } : {}),
      },
    });
  } catch (error) {
    // A request blocked before it is sent (CORS preflight, network down)
    // never reaches any backend, so this line is the only record it happened.
    logRequest(method, url, 'network error', trace);
    throw error;
  }

  logRequest(method, url, response.status, trace);
  if (!response.ok) {
    throw new ApiError(response.status, `${method} ${url} returned ${response.status}`);
  }
  return (await response.json()) as T;
}
