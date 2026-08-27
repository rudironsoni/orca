#!/bin/bash
# Remove only the Horca PATH symlink.
set -e

link="/usr/bin/horca"

if [ -L "$link" ]; then
  target="$(readlink "$link" || true)"
  case "$target" in
    /opt/Horca/*|/opt/horca-ide/*|/opt/horca/*)
      rm -f "$link"
      ;;
  esac
fi

exit 0
