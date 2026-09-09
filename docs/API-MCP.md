# API and MCP

The HTTP application and MCP operate on the same PostgreSQL workspace service. API root: `/api/v1`. The app runs at http://127.0.0.1:3001 locally. Configure the public HTTPS origin for deployment.

## Authentication and permissions

The first account is created at `/auth/setup`; later sessions use `/auth/login`. Browser sessions are HttpOnly cookies. Cookie-authenticated mutations require `X-Socrates-CSRF: 1`; an Origin, when present, must match APP_ORIGIN. `/auth/logout` revokes the session.

The app pins every protected request to its displayed user with `X-Socrates-Account: <user-id>`. If another tab switches the shared cookie to a different account, protected reads, writes and logout return 409 `ACCOUNT_CHANGED`. The old tab keeps its recovery data under the original account and offers an explicit page reload. Bearer clients may omit this header; clients that display a cookie-backed account should send it to prevent cross-tab identity races.

Open the avatar menu, then **Settings → AI & integrations → Manage connections** to create an API connection. The plaintext token appears once. Keep it in the client's environment or secret store. The database stores a hash; revocation takes effect on subsequent API calls.

Scopes form a hierarchy:

- `read`: read/search.
- `read, write`: normal create/update and move to Trash.
- `read, write, purge`: also permanently remove content and replace a workspace backup.

Tokens cannot create tokens, change account credentials, or obtain browser sessions. Permanent deletion still checks references. Neither elevated scopes nor MCP can silently overwrite frozen content through an ordinary edit.

## Versions and errors

`GET /workspace/status` returns `{revision,counts}`. `GET /workspace` returns `{revision,data}` for the UI/migration projection. Every content mutation carries `expectedRevision` in its JSON body or `If-Match: "<revision>"`. The initial release deliberately serializes changes per workspace, including independent notes; concurrent edits can return 409.

Use `Idempotency-Key` for retries of the same request. A matching retry returns the committed result; the same key with a different request returns 409. After permanent removal or a full replacement, prior idempotency responses are cleared so cached snapshots cannot retain deleted content. A retry from before that removal must re-read and reconcile instead of replaying the old snapshot.

Errors have the form:

```json
{"error":{"code":"VERSION_CONFLICT","message":"The workspace changed on the server.","currentRevision":12}}
```

Do not automatically overwrite with a newer revision. Preserve local edits, read current objects, and make an intentional new change. Other codes distinguish authentication, scope, validation, missing objects, unavailable source notes and referenced-note purge errors.

## Object routes

| Object | Routes and behavior | UI entry |
| --- | --- | --- |
| Notes | `/notes` GET/POST, `/notes/:id` GET/PATCH/DELETE; DELETE moves to Trash | Dashboard / note popup |
| Note tags | `/notes/:id/tags` GET/PUT; `/notes/:id/references` GET | Note editor / linked maps |
| Tags | `/tags` GET/POST, `/tags/:name` GET/PATCH/DELETE; `/tags/suggestions` GET | Tag Manager / suggestions |
| Maps | `/maps` GET/POST, `/maps/:id` GET/PATCH/DELETE | Brainstorm / Knowledge Maps |
| Nodes | `/maps/:mapId/nodes` and `/:id` GET/POST/PATCH/DELETE | Board and Layers |
| Connections | `/maps/:mapId/edges` and `/:id` GET/POST/PATCH/DELETE | Board and Layers |
| Map tag order | `/maps/:id/tags` GET/PUT | Map details |
| Note order | `/maps/:id/note-order` PUT `{noteIds:[...]}` | Map details |
| Revisions | `/maps/:id/revisions` GET/POST; `/:number` GET/PATCH/DELETE; `/:number/restore` POST | Saved map version history |
| Trash | `/trash` GET; `/trash/notes/:id/restore`, `/trash/maps/:id/restore` POST; same object `/purge` POST or DELETE | Trash |
| Preferences | `/me/preferences` GET/PATCH/PUT | Settings |
| API connections | `/connections` GET/POST; `/:id` PATCH/DELETE | Settings |
| Activity | `/activity` GET/DELETE; `/:id` DELETE | Settings |

Lists accept bounded `limit`/`offset` and `q` where relevant, returning `items,total,limit,offset`. IDs remain prefixed strings compatible with the prototype. Tag path IDs are their display names; URL-encode them. Renaming a tag updates its current associations and leaves historical snapshots intact. Deleting a tag removes its current associations; tags do not have a separate recoverable Trash lifecycle in this release.

Note references, parent groups and edge endpoints must exist in the same owner/map. Shapes use node `type: "shape"`, `data.shape: "rectangle" | "ellipse"`, `style.width/height`, `data.strokeStyle: "solid" | "dashed"` and the muted palette. Node coordinates remain parent-local. Saved revisions are created server-side from validated draft geometry and the transaction's source notes. Restoration changes the current draft structure/order and retains current source-note bodies.

The compatibility `PUT /workspace` is atomic and versioned. Mode `edit` enforces immutable existing revisions. Mode `import` requires an empty workspace. Mode `replace` is an explicit full restore with purge scope; it validates the entire backup before replacing anything. Existing client export/import libraries generate genuine Markdown, DOCX, XLSX and `.socrates.zip`; this release does not expose an asynchronous transfer-job API.

## Example: create a note

Read `/workspace/status`, then use its revision:

```sh
curl http://127.0.0.1:3001/api/v1/notes \
  -H "Authorization: Bearer $SOCRATES_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: capture-2026-09-09-001' \
  --data '{"expectedRevision":0,"summary":"复盘 helps me connect stories","body":"今天想到……","tags":["复盘","Stories"]}'
```

Replace the example revision with the actual current one. REST mutation responses include `{revision,data,result}`; the browser uses `data` as the canonical projection. MCP returns compact mutation outcomes to avoid sending the entire library with every write.

## MCP clients

For a client that supports authenticated Streamable HTTP:

- URL: `http://127.0.0.1:3001/mcp` locally, or `https://your-host/mcp`.
- Header: `Authorization: Bearer <Settings token>`.

This is a stateless Streamable HTTP endpoint using the official SDK. It supports clients that can supply a bearer token. It is not an OAuth discovery/consent server; clients that require OAuth registration may need the local stdio adapter.

Example stdio configuration (replace the path and token):

```json
{
  "mcpServers": {
    "socrates": {
      "command": "node",
      "args": ["/absolute/path/to/Socrates/server/src/mcp-stdio.mjs"],
      "env": {
        "SOCRATES_API_URL": "http://127.0.0.1:3001",
        "SOCRATES_API_TOKEN": "<token from Settings>"
      }
    }
  }
}
```

Use Node directly in MCP configuration so npm's startup banners cannot enter the JSON-RPC stream. The API must already be running. Do not put the token in a shared repository.

The server provides 50 typed tools, including `workspace_get`, `notes_list/create/update/delete`, `tags_suggestions`, `maps_create`, `nodes_create/update`, `edges_create/update`, `revisions_create/restore`, and Trash/preferences/activity tools. `workspace_get` defaults to revision/counts; use paginated object tools for normal work, and `includeData:true` only when a complete projection is actually needed. Note and map contents are returned as user data, not as instructions to execute. There is no arbitrary SQL or request-URL tool.
