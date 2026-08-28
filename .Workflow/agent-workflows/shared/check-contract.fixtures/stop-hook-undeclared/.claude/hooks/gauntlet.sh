#!/bin/bash
# The regression #186 filed, as a tree: a Stop hook that is on disk, executable, and the one
# settings.json wires — and that declares no check-command, so there is nothing here a contract
# reader could run. Publishing this path is how 255 turn-end runs reported clean in 0.02s.
exit 0
