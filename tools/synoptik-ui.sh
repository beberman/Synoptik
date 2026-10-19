#!/bin/bash
# Start and stop the web UI's Node server: the proxy to the Synoptik service and
# the static build of src/web/apps/standalone. REQ-0080, DES-0057 D6.
#
#   tools/synoptik-ui.sh start      build if needed, then run in the background
#   tools/synoptik-ui.sh stop
#   tools/synoptik-ui.sh restart
#   tools/synoptik-ui.sh status
#   tools/synoptik-ui.sh run        in the foreground, for a unit file
#
# It listens on 127.0.0.1:4790. SYNOPTIK_UI_HOST=0.0.0.0 reaches it from a phone
# and the server then refuses to start without SYNOPTIK_UI_TOKEN, because it
# forwards to a service that has no credential of its own. The workspace and the
# interface state are kept in ~/.synoptik (SYNOPTIK_WEB_HOME overrides).
#
# `start` also starts the agent host (DES-0057 D20, D21) on 127.0.0.1:4795 when
# `claude` is on PATH, and the server reaches it with a token kept in
# ~/.synoptik/agent-host.token. The host runs agents only in SYNOPTIK_HOST_REPOS,
# or else in the repositories the service watches when the host starts, so a
# repository added later needs `restart`. Terminals need `tmux` and `python3`
# too. SYNOPTIK_UI_AGENTS=off starts the server alone. `stop` leaves the tmux
# sessions running, so a conversation survives a restart.

set -u
set -o pipefail
root=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd) || exit 1
web="$root/src/web"
state="${SYNOPTIK_WEB_HOME:-$HOME/.synoptik}"
pidfile="$state/ui.pid"
logfile="$state/ui.log"
host_pidfile="$state/agent-host.pid"
host_logfile="$state/agent-host.log"
host_tokenfile="$state/agent-host.token"
host_port="${SYNOPTIK_HOST_PORT:-4795}"
service="${SYNOPTIK_URL:-http://127.0.0.1:4780}"

build() {
  command -v node >/dev/null || { echo "node is not on PATH; the web UI needs Node 22 or later." >&2; exit 1; }
  [ -d "$web/node_modules" ] || (cd "$web" && npm install --ignore-scripts --silent) || exit 1
  (cd "$web" && npx tsc -b packages/client packages/agents packages/server packages/agent-host) || exit 1
}

alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
running() { alive "$pidfile"; }

# The repositories the host may run agents in, separated by `:`: the
# environment's, or the git repositories the service watches now.
host_repos() {
  if [ -n "${SYNOPTIK_HOST_REPOS:-}" ]; then echo "$SYNOPTIK_HOST_REPOS"; return; fi
  curl -s -m 5 "$service/v1/status" | python3 -c '
import json, os, sys
try:
    roots = [r["root"].rstrip("/") for r in json.load(sys.stdin).get("repositories", [])]
except Exception:
    roots = []
print(":".join(r for r in roots if os.path.isdir(os.path.join(r, ".git"))))'
}

start_host() {
  [ "${SYNOPTIK_UI_AGENTS:-on}" = off ] && return 0
  if ! command -v claude >/dev/null; then echo "claude is not on PATH; the agent host is not started."; return 0; fi
  if alive "$host_pidfile"; then echo "agent host already running (pid $(cat "$host_pidfile"))."; return 0; fi
  local repos
  repos=$(host_repos)
  if [ -z "$repos" ]; then echo "The service watches no git repository and SYNOPTIK_HOST_REPOS is unset; the agent host is not started."; return 0; fi
  if [ ! -s "$host_tokenfile" ]; then
    (umask 077 && od -An -tx1 -N32 /dev/urandom | tr -d ' \n' >"$host_tokenfile") || return 1
  fi
  chmod 600 "$host_tokenfile"
  SYNOPTIK_HOST_TOKEN=$(cat "$host_tokenfile") SYNOPTIK_HOST_REPOS="$repos" SYNOPTIK_HOST_PORT="$host_port" \
    nohup node "$web/packages/agent-host/dist/cli.js" >>"$host_logfile" 2>&1 &
  echo $! >"$host_pidfile"
  sleep 1
  if alive "$host_pidfile"; then
    echo "agent host started (pid $(cat "$host_pidfile")) for ${repos//:/, }, log $host_logfile"
  else
    echo "agent host did not start:" >&2; tail -5 "$host_logfile" >&2; rm -f "$host_pidfile"
  fi
}

# The server reaches the host when one is running.
host_env() {
  if alive "$host_pidfile" && [ -s "$host_tokenfile" ]; then
    export SYNOPTIK_AGENT_HOST_URL="http://127.0.0.1:$host_port"
    export SYNOPTIK_AGENT_HOST_TOKEN
    SYNOPTIK_AGENT_HOST_TOKEN=$(cat "$host_tokenfile")
  fi
}

stop_all() {
  if running; then kill "$(cat "$pidfile")" && rm -f "$pidfile" && echo "synoptik-ui stopped."
  else rm -f "$pidfile"; echo "synoptik-ui is not running."; fi
  if alive "$host_pidfile"; then kill "$(cat "$host_pidfile")" && rm -f "$host_pidfile" && echo "agent host stopped."
  else rm -f "$host_pidfile"; fi
}

start_all() {
  if running; then echo "synoptik-ui already running (pid $(cat "$pidfile"))."; exit 0; fi
  build
  mkdir -p "$state" && chmod 700 "$state"
  start_host
  host_env
  nohup node "$web/packages/server/dist/cli.js" >>"$logfile" 2>&1 &
  echo $! >"$pidfile"
  sleep 1
  if running; then
    echo "synoptik-ui started (pid $(cat "$pidfile")), log $logfile"
  else
    echo "synoptik-ui did not start:" >&2; tail -5 "$logfile" >&2; rm -f "$pidfile"; exit 1
  fi
}

case "${1:-status}" in
  run)
    build
    mkdir -p "$state" && chmod 700 "$state"
    start_host
    host_env
    exec node "$web/packages/server/dist/cli.js"
    ;;
  start) start_all ;;
  stop) stop_all ;;
  restart) stop_all; sleep 1; start_all ;;
  status)
    if alive "$host_pidfile"; then echo "agent host running (pid $(cat "$host_pidfile"))."; else echo "agent host is not running."; fi
    if running; then echo "synoptik-ui running (pid $(cat "$pidfile"))."; else echo "synoptik-ui is not running."; exit 3; fi
    ;;
  *)
    echo "usage: $0 start|stop|restart|status|run" >&2; exit 2
    ;;
esac
