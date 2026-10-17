#!/bin/bash
# Start and stop the web UI's Node server: the proxy to the Synoptik service and
# the static build of src/web/apps/standalone. REQ-0080, DES-0057 D6.
#
#   tools/synoptik-ui.sh start      build if needed, then run in the background
#   tools/synoptik-ui.sh stop
#   tools/synoptik-ui.sh status
#   tools/synoptik-ui.sh run        in the foreground, for a unit file
#
# It listens on 127.0.0.1:4790. SYNOPTIK_UI_HOST=0.0.0.0 reaches it from a phone
# and the server then refuses to start without SYNOPTIK_UI_TOKEN, because it
# forwards to a service that has no credential of its own. The workspace and the
# interface state are kept in ~/.synoptik (SYNOPTIK_WEB_HOME overrides).

set -u
set -o pipefail
root=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd) || exit 1
web="$root/src/web"
state="${SYNOPTIK_WEB_HOME:-$HOME/.synoptik}"
pidfile="$state/ui.pid"
logfile="$state/ui.log"

build() {
  command -v node >/dev/null || { echo "node is not on PATH; the web UI needs Node 22 or later." >&2; exit 1; }
  [ -d "$web/node_modules" ] || (cd "$web" && npm install --ignore-scripts --silent) || exit 1
  (cd "$web" && npx tsc -b packages/client packages/server) || exit 1
}

running() { [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; }

case "${1:-status}" in
  run)
    build
    exec node "$web/packages/server/dist/cli.js"
    ;;
  start)
    if running; then echo "synoptik-ui already running (pid $(cat "$pidfile"))."; exit 0; fi
    build
    mkdir -p "$state" && chmod 700 "$state"
    nohup node "$web/packages/server/dist/cli.js" >>"$logfile" 2>&1 &
    echo $! >"$pidfile"
    sleep 1
    if running; then
      echo "synoptik-ui started (pid $(cat "$pidfile")), log $logfile"
    else
      echo "synoptik-ui did not start:" >&2; tail -5 "$logfile" >&2; rm -f "$pidfile"; exit 1
    fi
    ;;
  stop)
    if running; then kill "$(cat "$pidfile")" && rm -f "$pidfile" && echo "synoptik-ui stopped."
    else rm -f "$pidfile"; echo "synoptik-ui is not running."; fi
    ;;
  status)
    if running; then echo "synoptik-ui running (pid $(cat "$pidfile"))."; else echo "synoptik-ui is not running."; exit 3; fi
    ;;
  *)
    echo "usage: $0 start|stop|status|run" >&2; exit 2
    ;;
esac
