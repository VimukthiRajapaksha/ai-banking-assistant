import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Dev server only. This app is reached through Caddy at
 * http://portal.apex.localhost, which serves the SPA and, on the same origin,
 * proxies `/bank-api/*` to the APIM gateway and `/chat` to the agent -- see
 * external-services/caddy/Caddyfile for why those two have to be same-origin.
 *
 * There is deliberately no `proxy` block here any more: it duplicated Caddy's
 * job, and only worked for whoever opened the app on the published port
 * directly, which is no longer how it is served.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: Number(process.env.VITE_DEV_PORT ?? 18000),
    // Vite refuses requests whose Host header it does not recognise; Caddy
    // forwards the original one.
    allowedHosts: ['portal.apex.localhost'],
    // Under Docker (Colima's sshfs mounts, and a container user namespace whose
    // fs.inotify.max_user_instances is 128) inotify both exhausts itself at
    // startup with EMFILE and never sees host edits. Polling avoids inotify
    // entirely. Native `npm run dev` leaves this unset and keeps inotify.
    watch: process.env.VITE_USE_POLLING
      ? { usePolling: true, interval: 300 }
      : undefined,
  },
})
