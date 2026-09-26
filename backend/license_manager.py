"""Gumroad license activation, the saved activation, and the weekly re-check.

A buyer enters the license key from their Gumroad receipt once. Gumroad's
public verify endpoint confirms it, and the activation is saved to a small
``license.json`` beside (not inside) the portfolio database, bound to this
computer. After that the app works offline: Gumroad is asked again once a
week, and only a definitive answer from Gumroad (unknown or disabled key,
refund, chargeback, open dispute, ended subscription) revokes the activation.
Network failures never revoke; they only start an offline grace period.

Enforcement is on for the packaged (PyInstaller) backend and off when running
from source, so development is never locked. ``PORTFOLIO_LICENSE_ENFORCE=1``
forces it on for testing, ``=0`` forces it off. It also stays off while no
Gumroad product ID is configured, so a release built before the ID is filled
in cannot lock every buyer out.
"""
from __future__ import annotations

import datetime as _dt
import functools
import hashlib
import json
import os
import platform
import subprocess
import sys
import threading
import time

import requests
from flask import jsonify, request

from config import DB_PATH


# The product's ID from Gumroad: edit the product, tick "Generate a unique
# license key per sale", and copy the product_id shown in that section.
GUMROAD_PRODUCT_ID = "0rro9W8meLpAlFfbSeRhuA=="
# Where the activation screen's "Buy a license" link points.
GUMROAD_PRODUCT_URL = ""

GUMROAD_VERIFY_URL = "https://api.gumroad.com/v2/licenses/verify"
GUMROAD_LIBRARY_URL = "https://app.gumroad.com/library"

RECHECK_INTERVAL = _dt.timedelta(days=7)
# How long past a missed weekly check the app keeps working offline.
OFFLINE_GRACE = _dt.timedelta(days=14)
# While a check is due but Gumroad is unreachable, retry at most this often.
RETRY_INTERVAL = _dt.timedelta(hours=1)
# Gumroad counts one "use" per new activation and cannot be decremented
# without the seller's API token, so no cap is enforced by default.
MAX_ACTIVATIONS = None

LICENSE_FILE_NAME = "license.json"
_CACHE_TTL_SEC = 2.0

_record_lock = threading.RLock()
_record_cache = {"loaded_at": 0.0, "path": None, "value": None}
_check_lock = threading.Lock()


class LicenseRejected(Exception):
    """Gumroad definitively refused the key or the purchase behind it."""


class LicenseCheckUnavailable(Exception):
    """Gumroad could not be asked (offline, timeout, outage, rate limit)."""


class LicenseNotConfigured(Exception):
    """This build has no Gumroad product ID."""


def _now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _iso(moment: _dt.datetime | None) -> str | None:
    return moment.isoformat(timespec="seconds") if moment else None


def _parse(value) -> _dt.datetime | None:
    try:
        moment = _dt.datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_dt.timezone.utc)


def product_id() -> str:
    return (os.environ.get("GUMROAD_PRODUCT_ID") or GUMROAD_PRODUCT_ID or "").strip()


def product_url() -> str:
    return (os.environ.get("GUMROAD_PRODUCT_URL") or GUMROAD_PRODUCT_URL or "").strip()


def enforcement_enabled() -> bool:
    override = str(os.environ.get("PORTFOLIO_LICENSE_ENFORCE", "")).strip().lower()
    if override in ("1", "true", "yes", "on"):
        return True
    if override in ("0", "false", "no", "off"):
        return False
    return bool(getattr(sys, "frozen", False))


def license_path() -> str:
    # Electron passes its per-computer userData folder. The database folder
    # is only a fallback because it can be pointed at a shared location.
    directory = os.environ.get("PORTFOLIO_LICENSE_DIR") or os.path.dirname(DB_PATH)
    return os.path.join(directory, LICENSE_FILE_NAME)


@functools.lru_cache(maxsize=1)
def machine_id() -> str:
    """A stable, hashed identifier for this computer.

    Binding the activation to it means copying the database folder (or the
    license file) to another computer does not carry the activation along.
    """
    raw = ""
    try:
        if sys.platform == "win32":
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Cryptography",
                0,
                winreg.KEY_READ | winreg.KEY_WOW64_64KEY,
            ) as key:
                raw = str(winreg.QueryValueEx(key, "MachineGuid")[0])
        elif sys.platform == "darwin":
            output = subprocess.run(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            for line in output.splitlines():
                if "IOPlatformUUID" in line:
                    raw = line.split("=", 1)[-1].strip().strip('"')
                    break
        else:
            for candidate in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
                try:
                    with open(candidate, encoding="utf-8") as handle:
                        raw = handle.read().strip()
                except OSError:
                    continue
                if raw:
                    break
    except Exception:
        raw = ""
    raw = raw or platform.node() or "unknown"
    return hashlib.sha256(f"portfolio-tracker|{raw}".encode("utf-8")).hexdigest()


def mask_key(key) -> str | None:
    key = str(key or "").strip()
    if not key:
        return None
    if len(key) <= 8:
        return "••••••••"
    return f"{key[:4]}••••{key[-4:]}"


# ── Saved activation ──────────────────────────────────────────────────────────

def _load_record(force=False):
    path = license_path()
    now = time.monotonic()
    with _record_lock:
        if (
            not force
            and _record_cache["path"] == path
            and now - _record_cache["loaded_at"] < _CACHE_TTL_SEC
        ):
            value = _record_cache["value"]
            return dict(value) if value else None
        try:
            with open(path, encoding="utf-8") as handle:
                value = json.load(handle)
            if not isinstance(value, dict) or not value.get("license_key"):
                value = None
        except (OSError, ValueError):
            value = None
        _record_cache.update(loaded_at=now, path=path, value=value)
        return dict(value) if value else None


def _write_record(record):
    path = license_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = f"{path}.tmp"
    with _record_lock:
        with open(temp_path, "w", encoding="utf-8") as handle:
            json.dump(record, handle, indent=2)
        os.replace(temp_path, path)
        _record_cache.update(loaded_at=0.0, path=None, value=None)


def _delete_record():
    with _record_lock:
        try:
            os.remove(license_path())
        except FileNotFoundError:
            pass
        _record_cache.update(loaded_at=0.0, path=None, value=None)


# ── Gumroad ───────────────────────────────────────────────────────────────────

def _purchase_block_reason(purchase) -> str | None:
    if purchase.get("refunded"):
        return "This purchase was refunded."
    if purchase.get("chargebacked"):
        return "This purchase was charged back."
    if purchase.get("disputed") and not purchase.get("dispute_won"):
        return "This purchase has an open payment dispute."
    if purchase.get("subscription_ended_at"):
        return "The subscription for this license has ended."
    return None


def verify_with_gumroad(license_key, gumroad_product_id, increment_uses=False):
    """Ask Gumroad about a key. Returns the payload or raises."""
    try:
        response = requests.post(
            GUMROAD_VERIFY_URL,
            data={
                "product_id": gumroad_product_id,
                "license_key": license_key,
                "increment_uses_count": "true" if increment_uses else "false",
            },
            timeout=15,
        )
    except requests.RequestException as exc:
        raise LicenseCheckUnavailable(f"Could not reach Gumroad: {exc}") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = None
    # Outages, rate limits and unreadable replies say nothing about the key.
    if response.status_code >= 500 or response.status_code == 429 or not isinstance(payload, dict):
        raise LicenseCheckUnavailable(f"Gumroad returned HTTP {response.status_code}.")
    if not payload.get("success"):
        raise LicenseRejected(payload.get("message") or "Gumroad did not recognize this license key.")

    reason = _purchase_block_reason(payload.get("purchase") or {})
    if reason:
        raise LicenseRejected(reason)
    return payload


# ── State ─────────────────────────────────────────────────────────────────────

def _evaluate(record, now):
    """Classify a saved activation without touching the network."""
    if not record:
        return {"state": "inactive", "licensed": False,
                "reason": "No license has been activated on this computer."}

    details = {
        "masked_key": mask_key(record.get("license_key")),
        "email": record.get("email"),
        "activated_at": record.get("activated_at"),
        "last_verified_at": record.get("last_verified_at"),
        "last_check_attempt_at": record.get("last_check_attempt_at"),
        "last_check_error": record.get("last_check_error"),
    }
    if record.get("machine") != machine_id():
        return {**details, "state": "inactive", "licensed": False,
                "reason": "This license was activated on a different computer. Activate it again here."}
    if record.get("revoked"):
        return {**details, "state": "revoked", "licensed": False,
                "reason": record.get("revoked_reason") or "Gumroad no longer accepts this license."}

    last_verified = _parse(record.get("last_verified_at"))
    if last_verified is None:
        return {**details, "state": "inactive", "licensed": False,
                "reason": "The saved activation is incomplete. Activate the license again."}

    next_check = last_verified + RECHECK_INTERVAL
    grace_ends = next_check + OFFLINE_GRACE
    details.update(next_check_at=_iso(next_check), grace_ends_at=_iso(grace_ends))

    # A last-verified time in the future means the clock moved backwards;
    # treat the check as due rather than trusting it indefinitely.
    if last_verified > now + _dt.timedelta(days=1):
        return {**details, "state": "overdue", "licensed": True, "check_due": True}
    if now < next_check:
        return {**details, "state": "active", "licensed": True, "check_due": False}
    if now < grace_ends:
        return {**details, "state": "overdue", "licensed": True, "check_due": True}
    return {**details, "state": "expired", "licensed": False, "check_due": True,
            "reason": "This license could not be re-verified with Gumroad for "
                      f"{(RECHECK_INTERVAL + OFFLINE_GRACE).days} days. Connect to the internet and check again."}


def license_status(force=False):
    configured = bool(product_id())
    enforced = enforcement_enabled() and configured
    status = _evaluate(_load_record(force=force), _now())
    status.update(
        enforced=enforced,
        configured=configured,
        product_url=product_url() or None,
        library_url=GUMROAD_LIBRARY_URL,
        recheck_days=RECHECK_INTERVAL.days,
        grace_days=OFFLINE_GRACE.days,
        checking=_check_lock.locked(),
    )
    if not enforced:
        status["licensed"] = True
    return status


def activate(license_key):
    license_key = str(license_key or "").strip()
    if not license_key:
        raise LicenseRejected("Enter the license key from your Gumroad receipt.")
    gumroad_product_id = product_id()
    if not gumroad_product_id:
        raise LicenseNotConfigured("Licensing is not configured in this build (no Gumroad product ID).")

    existing = _load_record(force=True)
    reactivation = bool(
        existing
        and existing.get("license_key") == license_key
        and existing.get("product_id") == gumroad_product_id
        and existing.get("machine") == machine_id()
    )
    # Only a new activation counts as a use on Gumroad; re-entering the same
    # key on the same computer (e.g. after a revoke was reversed) does not.
    payload = verify_with_gumroad(license_key, gumroad_product_id, increment_uses=not reactivation)
    uses = payload.get("uses")
    if MAX_ACTIVATIONS and not reactivation and isinstance(uses, int) and uses > MAX_ACTIVATIONS:
        raise LicenseRejected(
            f"This license has already been activated {uses - 1} times, the maximum is {MAX_ACTIVATIONS}."
        )

    purchase = payload.get("purchase") or {}
    now = _iso(_now())
    _write_record({
        "license_key": license_key,
        "product_id": gumroad_product_id,
        "machine": machine_id(),
        "email": purchase.get("email"),
        "sale_id": purchase.get("sale_id") or purchase.get("id"),
        "uses": uses,
        "activated_at": existing.get("activated_at") if reactivation and existing.get("activated_at") else now,
        "last_verified_at": now,
        "last_check_attempt_at": now,
        "last_check_error": None,
        "revoked": False,
        "revoked_reason": None,
    })
    return license_status(force=True)


def recheck(force=False):
    """Re-verify the saved activation with Gumroad when it is due.

    ``force`` checks now regardless of schedule (the "Check now" button),
    including a revoked activation, so a reversed refund or won dispute can
    restore it.
    """
    if not _check_lock.acquire(blocking=force):
        return license_status()
    try:
        record = _load_record(force=True)
        if not record or record.get("machine") != machine_id():
            return license_status(force=True)
        now = _now()
        if not force:
            if record.get("revoked") or not _evaluate(record, now).get("check_due"):
                return license_status(force=True)
            last_attempt = _parse(record.get("last_check_attempt_at"))
            if last_attempt and now - last_attempt < RETRY_INTERVAL and last_attempt <= now:
                return license_status(force=True)

        record["last_check_attempt_at"] = _iso(now)
        try:
            payload = verify_with_gumroad(record["license_key"], record.get("product_id") or product_id())
        except LicenseRejected as exc:
            record.update(revoked=True, revoked_reason=str(exc), revoked_at=_iso(now), last_check_error=None)
        except LicenseCheckUnavailable as exc:
            record["last_check_error"] = str(exc)
        else:
            purchase = payload.get("purchase") or {}
            record.update(
                last_verified_at=_iso(now),
                last_check_error=None,
                revoked=False,
                revoked_reason=None,
                email=purchase.get("email") or record.get("email"),
                uses=payload.get("uses", record.get("uses")),
            )
            record.pop("revoked_at", None)
        _write_record(record)
        return license_status(force=True)
    finally:
        _check_lock.release()


def recheck_in_background():
    """Start a due re-check without holding up the request that noticed it."""
    if _check_lock.locked():
        return
    record = _load_record()
    if not record or record.get("revoked"):
        return
    if not _evaluate(record, _now()).get("check_due"):
        return
    threading.Thread(target=recheck, name="license-recheck", daemon=True).start()


def deactivate():
    _delete_record()
    return license_status(force=True)


# ── Routes ────────────────────────────────────────────────────────────────────

def _license_guard():
    """Refuse data endpoints while an enforced license is not active."""
    if request.method == "OPTIONS":
        return None
    path = request.path
    if not path.startswith("/api/") or path == "/api/health" or path.startswith("/api/license/"):
        return None
    status = license_status()
    if status["licensed"]:
        return None
    return jsonify({
        "error": "Portfolio Tracker needs an active license.",
        "license_required": True,
        "license_state": status["state"],
    }), 403


def register_routes(app):
    app.before_request(_license_guard)

    @app.route("/api/license/status", methods=["GET"])
    def api_license_status():
        recheck_in_background()
        return jsonify(license_status())

    @app.route("/api/license/activate", methods=["POST"])
    def api_license_activate():
        data = request.get_json(silent=True) or {}
        try:
            return jsonify(activate(data.get("license_key")))
        except LicenseNotConfigured as exc:
            return jsonify({"error": str(exc)}), 409
        except LicenseRejected as exc:
            return jsonify({"error": str(exc)}), 400
        except LicenseCheckUnavailable as exc:
            return jsonify({"error": f"{exc} Check your internet connection and try again."}), 503

    @app.route("/api/license/check", methods=["POST"])
    def api_license_check():
        return jsonify(recheck(force=True))

    @app.route("/api/license/deactivate", methods=["POST"])
    def api_license_deactivate():
        return jsonify(deactivate())
