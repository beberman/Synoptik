#!/usr/bin/env python3
"""Run a command in a pseudo-terminal and relay it over standard streams.

The agent host's terminal (DES-0057 D21). Node has no pseudo-terminal of its
own, so the host runs this with the command after `--`:

    pty-bridge.py --size 120x40 -- tmux attach -t =synoptik-Synoptik-1a2b3c4d

Bytes on standard input go to the terminal, and what the terminal writes comes
out on standard output. Each line on file descriptor 3 is a new size, as
`<cols>x<rows>`. Setting it on the terminal sends SIGWINCH to the program in
it. The bridge exits with the program's status when the program ends, and
hangs the program up when standard input closes.
"""
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

CONTROL = 3


def set_size(fd, text):
    try:
        cols, rows = (int(n) for n in text.strip().split("x"))
    except ValueError:
        return
    if 0 < cols < 1000 and 0 < rows < 1000:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main(argv):
    size = "80x24"
    if len(argv) >= 2 and argv[0] == "--size":
        size, argv = argv[1], argv[2:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    if not argv:
        sys.stderr.write("usage: pty-bridge.py [--size COLSxROWS] -- command ...\n")
        return 2

    pid, master = pty.fork()
    if pid == 0:
        try:
            os.execvp(argv[0], argv)
        finally:
            os._exit(127)
    set_size(master, size)

    try:
        control = os.fdopen(CONTROL, "r", buffering=1)
        readers = [0, master, CONTROL]
    except OSError:
        control = None
        readers = [0, master]

    while True:
        ready, _, _ = select.select(readers, [], [])
        if master in ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                data = b""
            if not data:
                break
            os.write(1, data)
        if 0 in ready:
            data = os.read(0, 65536)
            if not data:
                os.kill(pid, signal.SIGHUP)
                readers.remove(0)
            else:
                os.write(master, data)
        if CONTROL in ready and control is not None:
            line = control.readline()
            if line:
                set_size(master, line)
            else:
                readers.remove(CONTROL)

    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
