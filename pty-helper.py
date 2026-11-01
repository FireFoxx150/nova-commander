# Runs a shell in a pseudo-terminal for Nova Commander's terminal panel.
# Usage: pty-helper.py <shell> <cwd> <cols> <rows>
# Output from the shell goes to stdout; keystrokes arrive on stdin. A resize is sent as
# NUL, "R", cols, ",", rows, NUL, which never appears in normal typing.
import fcntl, os, pty, re, select, struct, sys, termios

shell, cwd, cols, rows = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
RESIZE = re.compile(rb'\x00R(\d+),(\d+)\x00')

pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.environ.setdefault('TERM', 'xterm-256color')
    os.execvp(shell, [shell, '-l'])

def resize(c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))

resize(cols, rows)
while True:
    ready, _, _ = select.select([fd, 0], [], [])
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if not data:
            break
        for m in RESIZE.finditer(data):
            resize(int(m.group(1)), int(m.group(2)))
        data = RESIZE.sub(b'', data)
        if data:
            os.write(fd, data)
try:
    os.kill(pid, 9)
except OSError:
    pass
