# synoptik-web

The web UI for Synoptik's documents (REQ-0080, DES-0057, PLAN-0062). It holds no Lisp.

    packages/client   the Client type, a fetch client, typed operations
    packages/server   the proxy: createHandler, the allow list, the token, the
                      workspace and interface-state files, the listener
    packages/ui       the React components, styled with Tailwind
    apps/standalone   the Vite shell that mounts the components in a page

## Run it

    tools/synoptik-serve.sh            # the service, if it is not already up
    tools/synoptik-ui.sh start         # http://127.0.0.1:4790/

Add the directories that hold your repositories to `roots` in
`~/.synoptik/web.json` (INSTALL.md, "The web UI"), then use Workspace to add
them. `cd apps/standalone && npm run dev` serves the interface with hot reload
on :5173, which expects the server on :4790 (set `SYNOPTIK_UI_PORT`).

## Check it

    npx vitest run            # 42 cases: proxy, files, client, the YAML editor over
                              # every document in this tree; the contract cases
                              # run only when the service answers
    npx tsc -b packages/client packages/server && (cd apps/standalone && npx tsc --noEmit)
    CHROMIUM=/path/to/chrome node e2e/run.mjs   # a browser run against the live
                              # service, in a scratch repository (needs playwright-core)

The editor changes only the characters of the field you edit. `yamlEdit.ts` takes
node positions from a parse and splices into the original text, and its tests
reload every document under `docs/` to check it.
