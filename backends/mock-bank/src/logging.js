/**
 * Request logging, joined to the rest of the system by the same three ids the
 * other services stamp on every line:
 *
 *   session  everything one user did in a sitting   (W3C `baggage`)
 *   trace    everything one question touched        (W3C `traceparent`)
 *   span     the caller's operation within it       (W3C `traceparent`)
 *
 * This service is a leaf -- it starts no spans of its own -- so `span` is the
 * parent id from the incoming header. That is deliberately the useful one:
 * grepping it finds the exact MCP-server line that produced this call, which a
 * span invented here would not.
 *
 * Parsed straight from the headers rather than pulling in an OpenTelemetry SDK:
 * there are no spans to export from a service that only reads these ids.
 */

/** traceparent is `version-traceid-spanid-flags`, all fixed width. */
function parseTraceparent(header) {
  const parts = String(header ?? '').split('-');
  if (parts.length < 4 || parts[1]?.length !== 32 || parts[2]?.length !== 16) {
    return { trace: '-', span: '-' };
  }
  return { trace: parts[1], span: parts[2] };
}

/** baggage is `key=value,key=value`, values percent-encoded. */
function parseBaggage(header, key) {
  for (const entry of String(header ?? '').split(',')) {
    const [name, ...rest] = entry.split('=');
    if (name?.trim() === key && rest.length) {
      try {
        return decodeURIComponent(rest.join('=').split(';')[0].trim());
      } catch {
        return '-';
      }
    }
  }
  return '-';
}

export function requestLogger(req, res, next) {
  const { trace, span } = parseTraceparent(req.headers.traceparent);
  const session = parseBaggage(req.headers.baggage, 'session.id');
  const started = process.hrtime.bigint();

  // Logged on finish, not on arrival: one line per request carrying its
  // outcome, so a failure is never a line you have to pair up with another.
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(
      `${new Date().toISOString()} [session=${session} trace=${trace} span=${span}] ` +
        `${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms.toFixed(1)}ms)`,
    );
  });
  next();
}
