#!/usr/bin/env bash
set -euo pipefail

# Creates a 2GB swapfile for low-memory VPS (Chromium needs it).
SWAPFILE="${SWAPFILE:-/swapfile}"
SWAPSIZE="${SWAPSIZE:-2G}"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo."
  exit 1
fi

if swapon --show | grep -q "$SWAPFILE"; then
  echo "Swap already enabled: $SWAPFILE"
  free -h
  exit 0
fi

if [[ -f "$SWAPFILE" ]]; then
  echo "Found existing $SWAPFILE, enabling..."
else
  echo "Creating $SWAPSIZE swap at $SWAPFILE"
  fallocate -l "$SWAPSIZE" "$SWAPFILE" || dd if=/dev/zero of="$SWAPFILE" bs=1M count=2048
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE"
fi

swapon "$SWAPFILE"

if ! grep -q "$SWAPFILE" /etc/fstab; then
  echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
fi

echo "Swap enabled"
free -h
