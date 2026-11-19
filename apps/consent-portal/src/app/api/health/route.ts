/** Liveness for the platform. Deliberately does not call ThunderID or
 * Asgardeo: an upstream outage should not get this container restarted. */
export function GET() {
  return Response.json({ status: 'ok' });
}
