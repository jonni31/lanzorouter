#!/usr/bin/env bash
# Install Lanzo Auto-Clean: copies the script to /opt, installs the systemd
# service + timer, and enables the 10-minute timer.
# Idempotent — safe to re-run after editing autoclean.py.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/lanzo-autoclean"
UNIT_DIR="/etc/systemd/system"

echo "==> Installing autoclean.py to ${INSTALL_DIR}"
sudo mkdir -p "${INSTALL_DIR}"
sudo cp "${SRC_DIR}/autoclean.py" "${INSTALL_DIR}/autoclean.py"
sudo chmod 644 "${INSTALL_DIR}/autoclean.py"

echo "==> Installing systemd units to ${UNIT_DIR}"
sudo cp "${SRC_DIR}/lanzo-autoclean.service" "${UNIT_DIR}/lanzo-autoclean.service"
sudo cp "${SRC_DIR}/lanzo-autoclean.timer"   "${UNIT_DIR}/lanzo-autoclean.timer"

echo "==> Reloading systemd + enabling timer"
sudo systemctl daemon-reload
sudo systemctl enable --now lanzo-autoclean.timer

echo "==> Done. Status:"
systemctl status lanzo-autoclean.timer --no-pager | head -5
echo
echo "Dry-run test:  python3 ${INSTALL_DIR}/autoclean.py --dry-run"
echo "Run once now:  sudo systemctl start lanzo-autoclean.service"
echo "View log:      journalctl -u lanzo-autoclean.service -n 20 --no-pager"
