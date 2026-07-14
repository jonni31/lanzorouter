# Lanzo Auto-Clean Zero-Credit

Background job that finds credit-exhausted provider connections and either
**deletes** or **disables** them, driven by the dashboard toggles.

## How it works
- Reads two settings blobs from the DB:
  - `providerAutoClean` — `{ provider: true/false }` (on/off per provider)
  - `providerAutoCleanAction` — `{ provider: "delete" | "disable" }` (default `delete`)
- Detects zero-credit via error signals (reliable when `balance` is null on farm keys):
  `errorCode 402`, `"Insufficient balance"`, or an explicit `balance <= 0`.
- Skips the vision false-positive (`No endpoints found that support image`).
- **delete** → removes the row. **disable** → `isActive=0` (routing skips it, key kept).
- WAL-safe: `busy_timeout` so it coexists with the live server.

## Install
```bash
cd deploy/autoclean
./install.sh
```
Copies `autoclean.py` → `/opt/lanzo-autoclean/`, installs the systemd
service + timer, enables the 10-minute timer.

## DB path
Defaults to `/home/ubuntu/.lanzo/db/data.sqlite`. Override with
`LANZO_DB_PATH` (env in the `.service` file, or inline when testing):
```bash
LANZO_DB_PATH=/path/to/data.sqlite python3 autoclean.py --dry-run
```

## Commands
```bash
python3 /opt/lanzo-autoclean/autoclean.py --dry-run   # report, no writes
sudo systemctl start lanzo-autoclean.service          # run once now
systemctl list-timers lanzo-autoclean.timer           # next fire time
journalctl -u lanzo-autoclean.service -n 20 --no-pager
```

## Files
| File | Purpose |
|---|---|
| `autoclean.py` | the job (delete/disable, error-string detection, WAL-safe) |
| `lanzo-autoclean.service` | oneshot systemd unit |
| `lanzo-autoclean.timer` | fires every 10 min (`OnUnitActiveSec=10min`) |
| `install.sh` | idempotent installer |
