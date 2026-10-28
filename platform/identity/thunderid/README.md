# Apex Bank on the hosted ThunderID

Provisioned through the console: **Import / Export → Import Configuration**,
always uploading `apex-thunderid.env` alongside the YAML file. Create it from
`apex-thunderid.env.example` and keep it out of git: it holds the secrets.

## Order

| Step | What | How |
|---|---|---|
| 1 | OU, theme, layout, resource server, flows | Import `01-foundation.yaml` |
| 2 | Applications and the agent | Import `02-applications.yaml` |
| 3 | The customer and the roles | Import `03-users-and-roles.yaml` |

Re-importing a file is safe: import updates resources that already exist.

## Resource server: full parent paths

`apex:mcp:accounts:read` reuses handles the bank also has (`accounts`,
`transactions`, `payees`, `payments`). The hosted ThunderID allows that, but a
bare `parent: accounts` is then ambiguous and the import fails with IMP-1002.
Every `parent:` in `01-foundation.yaml` is therefore the parent's full path,
e.g. `parent: "apex:bank:accounts"`. Keep it that way when adding resources.

Roles are checked against the resource server when they are created, so
`03-users-and-roles.yaml` must come after `01-foundation.yaml`.

## If an import reports a failure

The console's import stops at the **first** failed resource and skips
everything after it, and only a short toast says so. To see the reason, open
DevTools → Network before importing, then open the `import` request's response
and find the entry in `results` with `"status": "failed"`.
