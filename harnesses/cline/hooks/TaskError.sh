#!/bin/sh
# Never reads stdin. Cline wants JSON on stdout; tilt-signal --json prints {}.
exec "$(dirname "$0")/../../companion/bin/tilt-signal" idle --json </dev/null
