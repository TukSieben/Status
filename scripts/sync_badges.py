"""Sync Twitch global badges, owner counts, and live event drop schedules.

Fetches:
1. Official global badges from Twitch GQL.
2. Public badge owner counts/percentages from PotatBotat.
3. Active and upcoming drop schedules + objectives from StreamDatabase & CatQuery.

Outputs `data/badges.json` and `data/changelog.json`.
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
CATQUERY_EVENTS_URL = "https://api.catquery.com/eventBadges"
SDB_BADGES_URL = "https://streamdatabase.com/twitch/global-badges"
SDB_EVENTS_URL = "https://streamdatabase.com/events"

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

ALWAYS_AVAILABLE_IDS = {
    "anonymous-cheerer",
    "bits",
    "bits-leader",
    "clips-leader",
    "founder",
    "hype-train",
    "mod-founder",
    "no_audio",
    "no_video",
    "predictions",
    "premium",
    "social-sharing",
    "sub-gift-leader",
    "sub-gifter",
    "subscriber",
    "turbo",
}

PLATFORM_SET_IDS = ALWAYS_AVAILABLE_IDS | {"glitchcon2020"}

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


def normalize_iso(date_str: str | None, time_str: str | None, default_time: str) -> str | None:
    """Combine YYYY-MM-DD and HH:MM[:SS.sss] into UTC ISO-8601 string."""
    if not date_str:
        return None
    t = (time_str or default_time).strip()
    if re.fullmatch(r"\d{2}:\d{2}", t):
        t = f"{t}:00"
    if not t.endswith("Z"):
        t = f"{t}Z"
    try:
        dt = datetime.fromisoformat(f"{date_str}T{t}".replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None


def format_minutes(minutes: int) -> str:
    """Format watch duration nicely (e.g. 90 -> '1h 30m')."""
    if minutes >= 60:
        h, m = divmod(minutes, 60)
        return f"{h}h {m}m" if m else f"{h}h"
    return f"{minutes}m"


def format_objective(av: dict[str, Any], event_title: str | None) -> tuple[str | None, str | None]:
    """Build clean human-readable unlock objective and category/game string."""
    cats = list(
        dict.fromkeys(
            c.get("game", {}).get("name")
            for c in (av.get("categories") or [])
            if isinstance(c, dict) and isinstance(c.get("game"), dict) and c["game"].get("name")
        )
    )
    if len(cats) > 2:
        game_name = f"{cats[0]}, {cats[1]} (+{len(cats) - 2} categories)"
    elif cats:
        game_name = ", ".join(cats)
    else:
        game_name = event_title

    parts: list[str] = []
    for group in av.get("objectives") or []:
        if not isinstance(group, list):
            continue
        group_parts: list[str] = []
        for obj in group:
            if not isinstance(obj, dict):
                continue
            otype = obj.get("type")
            if otype == "twitch_watch":
                mins = obj.get("minutes")
                days = obj.get("days")
                if isinstance(mins, int) and mins > 0:
                    group_parts.append(f"Watch {format_minutes(mins)}")
                elif isinstance(days, int) and days > 0:
                    group_parts.append(f"Watch {days} day(s)")
                else:
                    group_parts.append("Watch stream")
            elif otype == "twitch_subscription":
                tier = obj.get("tier") or 1
                amt = obj.get("amount") or 1
                group_parts.append(
                    f"Subscribe (Tier {tier})" if amt == 1 else f"{amt}x Tier {tier} Subs"
                )
            elif otype == "twitch_gift_subscription":
                tier = obj.get("tier") or 1
                amt = obj.get("amount") or 1
                group_parts.append(
                    f"Gift {amt} Tier {tier} Sub" if amt == 1 else f"Gift {amt} Tier {tier} Subs"
                )
            elif otype == "twitch_bits":
                amt = obj.get("amount")
                group_parts.append(f"Cheer {amt} Bits" if amt else "Cheer Bits")
            elif otype == "twitch_clip":
                group_parts.append("Create or share a Clip")
        if group_parts:
            joined = " or ".join(dict.fromkeys(group_parts))
            if joined not in parts:
                parts.append(joined)

    objective = " & ".join(parts) if parts else None
    if objective and game_name:
        objective = f"{objective} in {game_name}"
    ch_count = av.get("channel_count")
    if objective and isinstance(ch_count, int) and ch_count > 0:
        objective = f"{objective} ({ch_count} eligible channels)"
    return objective, game_name


DEBUG_DUMP: dict[str, Any] = {}  # TEMP DEBUG
LOGIN_RE = re.compile(r"^[a-z0-9_]{2,25}$")


SKIP_KEYS = {"categories", "game", "objectives", "submitted_by", "submitter", "author", "created_by", "user", "votes", "likes"}


def extract_channels(av: dict[str, Any]) -> list[dict[str, str]]:
    """Find the channels a badge is restricted to (if any) in a StreamDatabase availability block.

    StreamDatabase nests channel objects in different shapes, so walk the structure and pick up
    every dict that carries a Twitch login. Categories, objectives and the person who submitted
    the entry are skipped. Returns [] for badges that can be earned on any channel.
    """
    count = av.get("channel_count")
    if not isinstance(count, int) or count <= 0:
        return []
    found: dict[str, dict[str, str]] = {}

    def walk(node: Any, key: str = "") -> None:
        if key in SKIP_KEYS:
            return
        if isinstance(node, dict):
            login = node.get("login") or node.get("user_login") or node.get("broadcaster_login")
            if isinstance(login, str) and LOGIN_RE.match(login.lower()):
                login = login.lower()
                found.setdefault(
                    login,
                    {
                        "login": login,
                        "displayName": str(node.get("display_name") or node.get("displayName") or login),
                        "avatar": str(
                            node.get("profile_image_url") or node.get("profileImageURL") or node.get("avatar") or ""
                        ),
                    },
                )
            for k, v in node.items():
                walk(v, k)
        elif isinstance(node, list):
            for v in node:
                walk(v, key)

    preferred = [k for k in ("channels", "twitch_channels", "allowed_channels") if k in av]
    for k in preferred:
        walk(av[k], "")
    if not found:
        walk(av)
    return list(found.values())[:count]


def fetch_json(url: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 20) -> Any:
    """Perform HTTP request and decode JSON response."""
    req = urllib.request.Request(
        url,
        data=data,
        headers=headers or {"User-Agent": "Mozilla/5.0 (compatible; badgestatus-sync/1.0)"},
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_next_page_props(url: str, timeout: int = 22) -> dict[str, Any]:
    """Extract Next.js __NEXT_DATA__ pageProps from StreamDatabase SSR pages."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
    )
    html = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html)
    if not m:
        return {}
    return json.loads(m.group(1)).get("props", {}).get("pageProps", {})


def fetch_live_badges() -> list[dict[str, Any]]:
    """Query Twitch GQL for the current global badge list."""
    payload = json.dumps({"query": GQL_QUERY}).encode("utf-8")
    data = fetch_json(
        GQL_URL,
        data=payload,
        headers={
            "Client-ID": TWITCH_WEB_CLIENT_ID,
            "Content-Type": "application/json",
            "User-Agent": "badgestatus-sync/1.0",
        },
        timeout=30,
    )
    raw_badges = data.get("data", {}).get("badges")
    if not isinstance(raw_badges, list) or not raw_badges:
        raise RuntimeError(f"Unexpected Twitch GQL response: {data}")
    return raw_badges


def fetch_user_counts() -> dict[str, tuple[int, float]]:
    """Fetch public Twitch badge ownership counts from PotatBotat API."""
    counts: dict[str, tuple[int, float]] = {}
    try:
        payload = fetch_json(POTAT_BADGES_URL, timeout=20)
        for item in payload.get("data", []):
            key = f"{item['badge']}::{item['version']}"
            uc = item.get("user_count")
            pct = item.get("percentage")
            if isinstance(uc, int):
                counts[key] = (uc, round(float(pct), 4) if pct is not None else 0.0)
    except Exception as exc:
        print(f"Warning: PotatBotat fetch failed: {exc}")
    return counts


def fetch_event_schedules() -> dict[str, dict[str, Any]]:
    """Collect active/upcoming badge schedule windows and objectives by setID."""
    schedules: dict[str, dict[str, Any]] = {}

    # 1. CatQuery (fast JSON fallback/baseline)
    try:
        cat_data = fetch_json(CATQUERY_EVENTS_URL, timeout=12)
        for b in cat_data.get("badges", []):
            sid = b.get("id")
            if not sid:
                continue
            schedules[sid] = {
                "startAt": b.get("startAt"),
                "endAt": b.get("endAt"),
                "cost": "free" if b.get("free") else "paid",
                "eventName": None,
                "objective": None,
                "game": None,
            }
    except Exception as exc:
        print(f"Warning: CatQuery fetch failed: {exc}")

    # 2. StreamDatabase global-badges SSR (authoritative start/end & cost)
    try:
        gb_props = fetch_next_page_props(SDB_BADGES_URL, timeout=25)
        for item in gb_props.get("initialTwitchGlobalBadges", []):
            sid = item.get("current", {}).get("set_id")
            if not sid:
                continue
            start_at = normalize_iso(item.get("start_at_date"), item.get("start_at_time"), "00:00:00")
            end_at = normalize_iso(item.get("end_at_date"), item.get("end_at_time"), "23:59:59")
            cost_val = item.get("cost")
            entry = schedules.setdefault(sid, {})
            if start_at:
                entry["startAt"] = start_at
            if end_at:
                entry["endAt"] = end_at
            if cost_val in {"free", "paid"}:
                entry["cost"] = cost_val
            if item.get("added_at"):
                entry["addedAt"] = item["added_at"]
    except Exception as exc:
        print(f"Warning: StreamDatabase global-badges fetch failed: {exc}")

    # 3. StreamDatabase /events SSR (exact objective, game category & event window)
    try:
        ev_props = fetch_next_page_props(SDB_EVENTS_URL, timeout=25)
        for ev in ev_props.get("initialEvents", []):
            ev_title = ev.get("title")
            ev_start = normalize_iso(ev.get("start_at_date"), ev.get("start_at_time"), "00:00:00")
            ev_end = normalize_iso(ev.get("end_at_date"), ev.get("end_at_time"), "23:59:59")
            for b in ev.get("twitch_global_badges", []):
                sid = b.get("current", {}).get("set_id")
                if not sid:
                    continue
                av_list = b.get("availability") or []
                av = av_list[0] if av_list else {}
                objective, game_name = format_objective(av, ev_title)
                entry = schedules.setdefault(sid, {})
                channels = extract_channels(av)
                if channels:
                    entry["channels"] = channels
                # TEMP DEBUG: dump raw availability of channel-restricted badges to inspect the shape
                if isinstance(av.get("channel_count"), int) and av["channel_count"] > 0:
                    DEBUG_DUMP[sid] = {"availability": av, "badge_keys": sorted(b.keys())}
                if ev_start and not entry.get("startAt"):
                    entry["startAt"] = ev_start
                if ev_end and not entry.get("endAt"):
                    entry["endAt"] = ev_end
                if ev_title:
                    entry["eventName"] = ev_title
                if objective:
                    entry["objective"] = objective
                if game_name:
                    entry["game"] = game_name
                if av.get("cost") in {"free", "paid"}:
                    entry["cost"] = av["cost"]
    except Exception as exc:
        print(f"Warning: StreamDatabase events fetch failed: {exc}")

    return schedules


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
    sched: dict[str, Any] | None,
    now_iso: str,
    now_dt: datetime,
    is_seed: bool,
) -> dict[str, Any]:
    """Build normalized badge record combining Twitch, owner counts, and drop schedules."""
    sid = raw["setID"]
    description = (raw.get("description") or "").strip()
    category = classify_badge(raw)
    cost = (sched or {}).get("cost") or classify_cost(raw, category)

    # Preserve unexpired schedule info from previous snapshot if current fetch missed it
    start_at = (sched or {}).get("startAt")
    end_at = (sched or {}).get("endAt")
    objective = (sched or {}).get("objective")
    event_name = (sched or {}).get("eventName")
    game_name = (sched or {}).get("game")
    channels = (sched or {}).get("channels") or []

    if not end_at and prev and prev.get("endAt"):
        try:
            if datetime.fromisoformat(prev["endAt"].replace("Z", "+00:00")) > now_dt:
                start_at = prev.get("startAt")
                end_at = prev.get("endAt")
                objective = objective or prev.get("objective")
                event_name = event_name or prev.get("eventName")
                game_name = game_name or prev.get("game")
                channels = channels or prev.get("channels") or []
        except ValueError:
            pass

    user_count = count_info[0] if count_info else (prev.get("userCount") if prev else None)
    percentage = count_info[1] if count_info else (prev.get("percentage") if prev else None)

    return {
        "setID": sid,
        "version": str(raw["version"]),
        "title": (raw.get("title") or sid).strip(),
        "description": description,
        "category": category,
        "cost": cost,
        "alwaysAvailable": sid.lower() in ALWAYS_AVAILABLE_IDS,
        "year": extract_year(raw),
        "userCount": user_count,
        "percentage": percentage,
        "startAt": start_at,
        "endAt": end_at,
        "eventName": event_name,
        "game": game_name,
        "objective": objective,
        "channels": channels,
        "image1x": raw["image1x"],
        "image2x": raw["image2x"],
        "image4x": raw["image4x"],
        "clickAction": raw.get("clickAction"),
        "clickURL": raw.get("clickURL"),
        "firstSeen": (sched or {}).get("addedAt") or (prev["firstSeen"] if prev and prev.get("firstSeen") else now_iso),
        "lastUpdated": prev.get("lastUpdated", now_iso) if prev else now_iso,
        "isInitialSeed": prev.get("isInitialSeed", is_seed) if prev else is_seed,
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    prev_doc = load_json(BADGES_PATH, {})
    prev_list = prev_doc.get("badges", []) if isinstance(prev_doc, dict) else []
    prev_map = {badge_key(b): b for b in prev_list}
    is_seed = len(prev_map) == 0

    changelog_doc = load_json(CHANGELOG_PATH, {"events": []})
    events: list[dict[str, Any]] = changelog_doc.get("events", [])

    live_raw = fetch_live_badges()
    user_counts = fetch_user_counts()
    schedules = fetch_event_schedules()
    live_sorted = sorted(live_raw, key=lambda b: (b["setID"].lower(), str(b["version"])))

    next_badges: list[dict[str, Any]] = []
    live_keys: set[str] = set()
    new_changes: list[dict[str, Any]] = []

    compare_fields = ("title", "description", "image4x", "clickURL")

    for raw in live_sorted:
        key = badge_key(raw)
        live_keys.add(key)
        prev = prev_map.get(key)
        norm = normalize_badge(
            raw,
            prev,
            user_counts.get(key),
            schedules.get(raw["setID"]),
            now_iso,
            now_dt,
            is_seed,
        )

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
    active_now_count = 0
    upcoming_count = 0
    for b in next_badges:
        if b.get("endAt"):
            try:
                end_dt = datetime.fromisoformat(b["endAt"].replace("Z", "+00:00"))
                start_dt = (
                    datetime.fromisoformat(b["startAt"].replace("Z", "+00:00"))
                    if b.get("startAt")
                    else now_dt
                )
                if end_dt > now_dt:
                    if start_dt > now_dt:
                        upcoming_count += 1
                    else:
                        active_now_count += 1
            except ValueError:
                pass

    if badges_changed or is_seed:
        output = {
            "syncedAt": now_iso,
            "totalBadges": len(next_badges),
            "uniqueSets": unique_sets,
            "trackedOwners": sum(1 for b in next_badges if b.get("userCount") is not None),
            "activeNow": active_now_count,
            "upcoming": upcoming_count,
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
        f"Synced {len(next_badges)} badges ({unique_sets} sets). "
        f"Active now: {active_now_count}, Upcoming: {upcoming_count}. "
        f"Changes recorded: {len(new_changes)}."
    )


if __name__ == "__main__":
    main()
    if DEBUG_DUMP:  # TEMP DEBUG
        (DATA_DIR / "_debug_sdb.json").write_text(json.dumps(DEBUG_DUMP, indent=1, ensure_ascii=False), encoding="utf-8")
