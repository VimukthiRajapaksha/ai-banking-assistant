# Setting up this repository with Claude

The goal is usually to get the local stack running. `deploy/local/README.md` is
the source of truth. This file is the order of work and where to stop.

## Order

1. **Check that WSO2 Agent Manager is running.**
   - `curl -s -o /dev/null -w '%{http_code}' http://thunder.amp.localhost:8080/.well-known/openid-configuration` must print `200`.
   - `curl -s -o /dev/null -w '%{http_code}' http://localhost:9000/healthz` must print `200`.

   If either fails, **stop and tell the user.** Agent Manager is installed and
   configured separately (https://github.com/wso2/agent-manager). Do not try to
   install it from here. After a Colima or k3d restart, it needs the steps
   under "Things the docs do not tell you" in `gateway-policies/README.md`.
2. **Get the ThunderID credential from the user.** This is Step 1 in
   `deploy/local/README.md`. A human has to create it in the ThunderID
   console, and no script can. Ask for the client ID and secret. Do not invent
   them.
3. **Create `deploy/local/.env`** from `deploy/local/.env.example`. Ask the user
   for `ANTHROPIC_API_KEY` and `APEX_USER_PASSWORD`. Leave the other values as
   they are unless the user says otherwise.
4. **Run `scripts/check-prereqs.sh`** and fix whatever it reports.
5. **Run `scripts/start.sh`.** The first run takes several minutes, because
   APIM boots slowly. It ends by running `scripts/doctor.sh`.
6. Tell the user to open http://portal.apex.localhost and sign in as
   `alex@apexbank.com`. Payments need a passkey, which the user sets up under
   **Settings** in the portal. That cannot be done headlessly.

## Rules

- **Never commit secrets.** Only `.env.example` files are committed.
  `deploy/local/.env`, `deploy/local/env/*.env` and
  `deploy/local/.env.generated` are gitignored and stay that way.
- **Never edit `deploy/local/.env.generated`.** The provisioners own it. They
  are idempotent and keep the secrets it already holds. If one is wrong, fix
  the input and re-run `scripts/start.sh`.
- **Do not set up the APIM API by hand.** `deploy/local/init/apim-init.sh`
  already publishes it, binds the scopes, registers ThunderID as key manager,
  and deploys a revision.
- **Use `scripts/start.sh`, not a bare `docker compose up`.** Compose reads the
  env files when it creates containers, which is before the provisioners have
  written their output.
- **`deploy/local/external/openfgc` is fetched, not ours.** Change it only
  through `deploy/local/consent/openfgc-portal.patch`.
- **The NPI guardrail (`gateway-policies/`) is optional.** Build it only if the
  user asks. It needs the `ap` CLI and a checkout of `wso2/agent-manager`.

## When something fails

- `docker compose -f deploy/local/docker-compose.yml logs <service>`. The
  provisioners print the failing call and the reason.
- The "Troubleshooting" section of `deploy/local/README.md` covers the known
  traps: `*.localhost` inside containers, Vite `EMFILE`, APIM `404` and `403`,
  and missing passkeys.
