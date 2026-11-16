"""Sync Twitch global badges and user counts into local JSON snapshots.

Fetches global badge metadata from Twitch GQL and ownership counts from the
public PotatBotat badge API, writing `data/badges.json` and `data/changelog.json`.
"""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GQL_URL = "https://gql.twitch.tv/gql"
TWITCH_WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
POTAT_BADGES_URL = "https://api.potat.app/twitch/badges"

GQL_QUERY = """
query GlobalBadges {
  badges {
    setID
    version
    title
    description
    image1x: imageURL(size: NORMAL)
    image2x: imageURL(size: DOUBLE)
    image4x: imageURL(size: QUADRUPLE)
    clickAction
    clickURL
  }
}
"""

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
BADGES_PATH = DATA_DIR / "badges.json"
CHANGELOG_PATH = DATA_DIR / "changelog.json"

ROLE_SET_IDS = {
    "admin",
    "ambassador",
    "artist-badge",
    "bot-badge",
    "broadcaster",
    "global_mod",
    "lead_moderator",
    "moderator",
    "no_audio",
    "no_video",
    "partner",
    "staff",
    "twitchbot",
    "vip",
}

PLATFORM_SET_IDS = {
    "anonymous-cheerer",
    "bits",
    "bits-leader",
    "clips-leader",
    "founder",
    "glitchcon2020",
    "hype-train",
    "mod-founder",
    "predictions",
    "premium",
    "social-sharing",
    "sub-gift-leader",
    "sub-gifter",
    "subscriber",
    "turbo",
}

PAID_PLATFORM_IDS = {
    "anonymous-cheerer",
    "bits",
    "bits-leader",
    "founder",
    "hype-train",
    "mod-founder",
    "premium",
    "sub-gift-leader",
    "sub-gifter",
    "subscriber",
    "turbo",
}

PAID_RE = re.compile(
    r"\b(sub|subbed|subbing|subscribe|subscribed|subscribing|gift|gifted|gifting|"
    r"bits|cheer|cheered|cheering|support|supported|supporting|purchas\w*|turbo|tier)\b",
    re.IGNORECASE,
)
WATCH_RE = re.compile(
    r"\b(watch|watched|watching|view|viewed|viewing|tuned in|drop|drops|livestream|premiere)\b",
    re.IGNORECASE,
)
ACTION_RE = re.compile(
    r"\b(clip|clipped|clipping|chat|chatted|chatting|vote|voted|voting|"
    r"quest|campaign|creator|raid|share|shared|sharing)\b",
    re.IGNORECASE,
)
YEAR_RE = re.compile(r"\b(20\d{2})\b")


def classify_badge(badge: dict[str, Any]) -> str:
    """Assign a display category based on official Twitch metadata."""
    sid = (badge.get("setID") or "").lower()
    desc = (badge.get("description") or "").strip()
    click_url = badge.get("clickURL") or ""

    if sid in ROLE_SET_IDS or "twitch staff" in desc.lower():
        return "Role"
    if sid in PLATFORM_SET_IDS:
        return "Platform"
    if PAID_RE.search(desc):
        return "Paid / Sub"
    if WATCH_RE.search(desc):
        return "Free / Watch"
    if ACTION_RE.search(desc):
        return "Action"
    if "/directory/game/" in click_url:
        return "Legacy"
    return "Event"


def classify_cost(badge: dict[str, Any], category: str) -> str:
    """Determine cost classification: 'free', 'paid', or 'role'."""
    sid = (badge.get("setID") or "").lower()
    desc = (badge.get("description") or "").strip()
    click_action = (badge.get("clickAction") or "").upper()

    if category == "Role":
        return "role"
    if (
        sid in PAID_PLATFORM_IDS
        or category == "Paid / Sub"
        or click_action in {"SUBSCRIBE", "GET_TURBO"}
        or PAID_RE.search(desc)
    ):
        return "paid"
    return "free"


def extract_year(badge: dict[str, Any]) -> int | None:
    """Extract an explicit 20xx year from title, setID, or description if present."""
    haystack = " ".join(
        filter(None, [badge.get("title"), badge.get("setID"), badge.get("description")])
    )
    years = [int(y) for y in YEAR_RE.findall(haystack) if 2010 <= int(y) <= 2035]
    return max(years) if years else None


def badge_key(badge: dict[str, Any]) -> str:
    """Return unique composite key for a badge version."""
    return f"{badge['setID']}::{badge['version']}"


def fetch_live_badges() -> list[dict[str, Any]]:
    """Query Twitch GQL for the current global badge list."""
    payload = json.dumps({"query": GQL_QUERY}).encode("utf-8")
    req = urllib.request.Request(
        GQL_URL,
        data=payload,
        headers={
            "Client-ID": TWITCH_WEB_CLIENT_ID,
            "Content-Type": "application/json",
            "User-Agent": "badgestatus-sync/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    raw_badges = data.get("data", {}).get("badges")
    if not isinstance(raw_badges, list) or not raw_badges:
        raise RuntimeError(f"Unexpected Twitch GQL response: {data}")
    return raw_badges


def fetch_user_counts() -> dict[str, tuple[int, float]]:
    """Fetch public Twitch badge ownership counts from PotatBotat API."""
    counts: dict[str, tuple[int, float]] = {}
    try:
        req = urllib.request.Request(
            POTAT_BADGES_URL,
            headers={"User-Agent": "Mozilla/5.0 (compatible; badgestatus-sync/1.0)"},
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        for item in payload.get("data", []):
            key = f"{item['badge']}::{item['version']}"
            uc = item.get("user_count")
            pct = item.get("percentage")
            if isinstance(uc, int):
                counts[key] = (uc, round(float(pct), 4) if pct is not None else 0.0)
    except Exception as exc:
        print(f"Warning: could not fetch user counts from PotatBotat: {exc}")
    return counts


def load_json(path: Path, default: Any) -> Any:
    """Load JSON file if it exists, otherwise return default."""
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def normalize_badge(
    raw: dict[str, Any],
    prev: dict[str, Any] | None,
    count_info: tuple[int, float] | None,
    now_iso: str,
    is_seed: bool,
) -> dict[str, Any]:
    """Build normalized badge record preserving existing tracking metadata."""
    description = (raw.get("description") or "").strip()
    category = classify_badge(raw)
    cost = classify_cost(raw, category)

    user_count = count_info[0] if count_info else (prev.get("userCount") if prev else None)
    percentage = count_info[1] if count_info else (prev.get("percentage") if prev else None)

    return {
        "setID": raw["setID"],
        "version": str(raw["version"]),
        "title": (raw.get("title") or raw["setID"]).strip(),
        "description": description,
        "category": category,
        "cost": cost,
        "year": extract_year(raw),
        "userCount": user_count,
        "percentage": percentage,
        "image1x": raw["image1x"],
        "image2x": raw["image2x"],
        "image4x": raw["image4x"],
        "clickAction": raw.get("clickAction"),
        "clickURL": raw.get("clickURL"),
        "firstSeen": prev["firstSeen"] if prev and prev.get("firstSeen") else now_iso,
        "lastUpdated": prev.get("lastUpdated", now_iso) if prev else now_iso,
        "isInitialSeed": prev.get("isInitialSeed", is_seed) if prev else is_seed,
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    prev_doc = load_json(BADGES_PATH, {})
    prev_list = prev_doc.get("badges", []) if isinstance(prev_doc, dict) else []
    prev_map = {badge_key(b): b for b in prev_list}
    # Treat legacy snapshots without userCount/cost fields smoothly without noisy changelog spam
    is_seed = len(prev_map) == 0

    changelog_doc = load_json(CHANGELOG_PATH, {"events": []})
    events: list[dict[str, Any]] = changelog_doc.get("events", [])

    live_raw = fetch_live_badges()
    user_counts = fetch_user_counts()
    live_sorted = sorted(live_raw, key=lambda b: (b["setID"].lower(), str(b["version"])))

    next_badges: list[dict[str, Any]] = []
    live_keys: set[str] = set()
    new_changes: list[dict[str, Any]] = []

    compare_fields = ("title", "description", "image4x", "clickURL")

    for raw in live_sorted:
        key = badge_key(raw)
        live_keys.add(key)
        prev = prev_map.get(key)
        norm = normalize_badge(raw, prev, user_counts.get(key), now_iso, is_seed)

        if not is_seed and prev is None:
            new_changes.append(
                {
                    "type": "added",
                    "timestamp": now_iso,
                    "setID": norm["setID"],
                    "version": norm["version"],
                    "title": norm["title"],
                    "description": norm["description"],
                    "category": norm["category"],
                    "cost": norm["cost"],
                    "image2x": norm["image2x"],
                }
            )
        elif not is_seed and prev is not None:
            changed = [f for f in compare_fields if prev.get(f) != norm.get(f)]
            if changed:
                norm["lastUpdated"] = now_iso
                new_changes.append(
                    {
                        "type": "updated",
                        "timestamp": now_iso,
                        "setID": norm["setID"],
                        "version": norm["version"],
                        "title": norm["title"],
                        "fields": changed,
                        "image2x": norm["image2x"],
                    }
                )

        next_badges.append(norm)

    if not is_seed:
        for key, prev in prev_map.items():
            if key not in live_keys:
                new_changes.append(
                    {
                        "type": "removed",
                        "timestamp": now_iso,
                        "setID": prev["setID"],
                        "version": prev["version"],
                        "title": prev.get("title", prev["setID"]),
                        "image2x": prev.get("image2x"),
                    }
                )

    badges_changed = prev_list != next_badges
    unique_sets = len({b["setID"] for b in next_badges})

    if badges_changed or is_seed:
        output = {
            "syncedAt": now_iso,
            "totalBadges": len(next_badges),
            "uniqueSets": unique_sets,
            "trackedOwners": sum(1 for b in next_badges if b.get("userCount") is not None),
            "badges": next_badges,
        }
        with BADGES_PATH.open("w", encoding="utf-8", newline="\n") as fh:
            json.dump(output, fh, ensure_ascii=False, indent=2)
            fh.write("\n")

    if new_changes or not CHANGELOG_PATH.exists():
        updated_events = (new_changes + events)[:250]
        with CHANGELOG_PATH.open("w", encoding="utf-8", newline="\n") as fh:
            json.dump(
                {"updatedAt": now_iso, "events": updated_events},
                fh,
                ensure_ascii=False,
                indent=2,
            )
            fh.write("\n")

    print(
        f"Synced {len(next_badges)} badges ({unique_sets} sets), "
        f"{sum(1 for b in next_badges if b.get('userCount') is not None)} with owner counts. "
        f"Changes recorded: {len(new_changes)}."
    )


if __name__ == "__main__":
    main()
