#!/usr/bin/env python3
"""
Lanzo Auto-Clean Zero-Credit v1
- Reads UI toggles from settings blob: providerAutoClean (on/off per provider)
  and providerAutoCleanAction (delete | disable, default delete).
- Detects credit-exhausted connections via error signals (reliable for farm keys
  where the `balance` field is null): errorCode 402, "Insufficient balance",
  or an explicit balance <= 0.
- Applies the configured action:
    delete  -> remove the row entirely
    disable -> set isActive=0 (routing filters isActive=1, so it's skipped)
- WAL-safe: busy_timeout + short transaction so it coexists with the live server.
- --dry-run: report what WOULD happen without writing.
"""

import sqlite3
import json
import sys
import os
from datetime import datetime, timezone

DB_PATH = os.environ.get("LANZO_DB_PATH", "/home/ubuntu/.lanzo/db/data.sqlite")
DRY_RUN = "--dry-run" in sys.argv


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_toggles(db):
    row = db.execute("SELECT data FROM settings WHERE id=1").fetchone()
    if not row:
        return {}, {}
    d = json.loads(row[0])
    return (d.get("providerAutoClean") or {}, d.get("providerAutoCleanAction") or {})


def is_vision_false_positive(err):
    return ("No endpoints found that support image" in err) or ("image input" in err)


def is_credit_exhausted(data):
    """Zero-credit signals only (not generic dead-key)."""
    err = str(data.get("lastError", ""))
    code = data.get("errorCode", 0)
    bal = data.get("balance", None)

    if is_vision_false_positive(err):
        return False

    if code == 402:
        return True
    el = err.lower()
    if "insufficient" in el and "balance" in el:
        return True
    if isinstance(bal, (int, float)) and bal <= 0:
        return True
    return False


def main():
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.execute("PRAGMA busy_timeout=10000")

    auto_clean, actions = load_toggles(db)
    on_providers = [p for p, enabled in auto_clean.items() if enabled]

    if not on_providers:
        db.close()
        return

    deleted = 0
    disabled = 0
    per_provider = {}

    for provider in on_providers:
        action = actions.get(provider, "delete")
        rows = db.execute(
            "SELECT id, name, data, isActive FROM providerConnections WHERE provider=?",
            (provider,),
        ).fetchall()

        for rid, rname, rdata, ractive in rows:
            if action == "disable" and ractive == 0:
                continue
            try:
                data = json.loads(rdata)
            except Exception:
                continue
            if not is_credit_exhausted(data):
                continue

            per_provider.setdefault(provider, {"delete": 0, "disable": 0})
            if action == "disable":
                per_provider[provider]["disable"] += 1
                disabled += 1
                if not DRY_RUN:
                    data["testStatus"] = "unavailable"
                    data["autoDisabledAt"] = now_iso()
                    data["autoDisabledReason"] = "zero credit (auto-clean)"
                    db.execute(
                        "UPDATE providerConnections SET isActive=0, data=?, updatedAt=? WHERE id=?",
                        (json.dumps(data), now_iso(), rid),
                    )
            else:
                per_provider[provider]["delete"] += 1
                deleted += 1
                if not DRY_RUN:
                    db.execute("DELETE FROM providerConnections WHERE id=?", (rid,))

    if not DRY_RUN:
        db.commit()

    db.close()

    tag = "[lanzo-autoclean DRY-RUN]" if DRY_RUN else "[lanzo-autoclean]"
    if deleted or disabled:
        detail = ", ".join(
            f"{p}: del={v['delete']} dis={v['disable']}" for p, v in per_provider.items()
        )
        print(f"{tag} deleted={deleted} disabled={disabled} | {detail}")
    else:
        print(f"{tag} nothing to clean (providers ON: {', '.join(on_providers)})")


if __name__ == "__main__":
    main()
