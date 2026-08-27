#!/bin/bash
# PATH symlink for the Horca CLI. Does not touch /usr/bin/orca-ide.
set -e

link="/usr/bin/horca"

for dir in /opt/Horca /opt/horca-ide /opt/horca; do
  sandbox="$dir/chrome-sandbox"
  if [ -f "$sandbox" ]; then
    chmod 4755 "$sandbox" || true
  fi

  shim="$dir/resources/bin/horca"
  if [ -x "$shim" ]; then
    if [ ! -e "$link" ] || [ -L "$link" ]; then
      ln -sf "$shim" "$link"
    fi
    break
  fi
done

exit 0
