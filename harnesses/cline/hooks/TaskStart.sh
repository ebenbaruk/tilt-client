#!/bin/sh
# Cline pipes the event JSON (the prompt, for UserPromptSubmit) on stdin: never read it.
# Cline wants JSON on stdout; tilt-signal --json prints {}.
exec "$(dirname "$0")/../../companion/bin/tilt-signal" working --json </dev/null
