// Docker-only Vite config for the OpenFGC consent portal SPA.
//
// Mounted into the container next to the upstream vite.config.ts so that file
// stays untouched. Adds what running under Docker needs: bind on all
// interfaces, fix the port, and poll instead of using inotify (see the note in
// apps/portal/vite.config.ts) -- and the Apex theme (see apex-theme/).
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import base from './vite.config'

const shim = fileURLToPath(new URL('./apex-theme/oxygen-ui-shim.ts', import.meta.url))

/** The tab title, in the same "<portal> | ApexBank" form the bank portal
 * uses -- set here because the upstream index.html is left untouched. */
const apexTitle: Plugin = {
  name: 'apex-title',
  transformIndexHtml: (html) => html.replace(/<title>[^<]*<\/title>/, '<title>Consent Portal | ApexBank</title>'),
}

export default defineConfig(async (env) => {
  const resolved = typeof base === 'function' ? await base(env) : base
  return mergeConfig(resolved, {
    plugins: [apexTitle],
    resolve: {
      // The portal's main.tsx imports AcrylicOrangeTheme from Oxygen UI; the
      // shim re-exports the package with the Apex theme under that name.
      // Exact match only: the shim itself reaches the real package through
      // '@wso2/oxygen-ui/index', which this must not catch.
      alias: [{ find: /^@wso2\/oxygen-ui$/, replacement: shim }],
    },
    optimizeDeps: {
      // Pre-bundle the specifier the shim actually imports, so the app and
      // the shim share one copy of MUI (and so one theme context).
      include: ['@wso2/oxygen-ui/index'],
    },
    server: {
      host: '0.0.0.0',
      port: 18060,
      watch: { usePolling: true, interval: 300 },
    },
  })
})
