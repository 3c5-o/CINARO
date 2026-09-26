import asyncio
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from telethon import Button, TelegramClient, events, utils

API_ID_RAW = os.environ.get("TELEGRAM_API_ID", "").strip()
API_HASH = os.environ.get("TELEGRAM_API_HASH", "").strip()
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
ADMIN_ID_RAW = os.environ.get("TELEGRAM_ADMIN_ID", "8407394858").strip()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
ALLOWED_ORIGINS_RAW = os.environ.get("ALLOWED_ORIGINS", "https://3c5-o.github.io")

MAX_MEDIA_BYTES = 1_950_000_000
MAX_CONCURRENT_STREAMS = max(1, min(16, int(os.environ.get("MAX_CONCURRENT_STREAMS", "6"))))
CHUNK_SIZE = max(128, min(1024, int(os.environ.get("STREAM_CHUNK_KB", "512")))) * 1024
MAX_RANGE_WINDOW = max(4, min(64, int(os.environ.get("MAX_RANGE_WINDOW_MB", "32")))) * 1024 * 1024
STREAM_CHUNK_TIMEOUT = max(10, min(90, int(os.environ.get("STREAM_CHUNK_TIMEOUT_SECONDS", "35"))))
STREAM_QUEUE_TIMEOUT = max(1.0, min(60.0, float(os.environ.get("STREAM_QUEUE_TIMEOUT_SECONDS", "12"))))
STREAM_READ_RETRIES = max(1, min(6, int(os.environ.get("STREAM_READ_RETRIES", "3"))))
MEDIA_CACHE_TTL = max(5.0, min(300.0, float(os.environ.get("MEDIA_CACHE_TTL_SECONDS", "60"))))
MEDIA_CACHE_MAX = max(32, min(1024, int(os.environ.get("MEDIA_CACHE_MAX", "256"))))

try:
    API_ID = int(API_ID_RAW) if API_ID_RAW else 0
except ValueError:
    API_ID = 0

try:
    ADMIN_ID = int(ADMIN_ID_RAW)
except ValueError:
    ADMIN_ID = 8407394858

ALLOWED_ORIGINS = [value.strip() for value in ALLOWED_ORIGINS_RAW.split(",") if value.strip()]
if not ALLOWED_ORIGINS:
    ALLOWED_ORIGINS = ["https://3c5-o.github.io"]

telegram_client: TelegramClient | None = None
http_client: httpx.AsyncClient | None = None
channel_cache: dict[int, Any] = {}
media_cache: dict[str, dict[str, Any]] = {}
stream_slots = asyncio.Semaphore(MAX_CONCURRENT_STREAMS)
active_streams = 0
total_stream_requests = 0
range_requests = 0
stream_failures = 0
stream_retries = 0
stream_rejections = 0
bytes_served = 0

STORAGE_ID_RE = re.compile(r"^CIN-[MS]-[A-Z0-9]{10}$")
VIDEO_EXTENSIONS = {".mp4"}


def telegram_configured() -> bool:
    return bool(API_ID and API_HASH and BOT_TOKEN)


def database_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def bot_ready() -> bool:
    return bool(telegram_client and telegram_client.is_connected() and database_configured())


def now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def storage_id(kind: str) -> str:
    prefix = "M" if kind == "movie" else "S"
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    token = "".join(secrets.choice(alphabet) for _ in range(10))
    return f"CIN-{prefix}-{token}"


def batch_code(kind: str) -> str:
    prefix = "MOV" if kind == "movie" else "SER"
    return f"CB-{prefix}-{int(time.time())}-{secrets.token_hex(2).upper()}"


def human_size(size: int) -> str:
    if size >= 1_000_000_000:
        return f"{size / 1_000_000_000:.2f} GB"
    if size >= 1_000_000:
        return f"{size / 1_000_000:.1f} MB"
    return f"{size / 1_000:.0f} KB"


def sender_id(event: Any) -> int:
    return int(getattr(event, "sender_id", 0) or 0)


def role_label(role: str) -> str:
    return {
        "owner": "المالك",
        "admin": "أدمن ثانوي",
        "supervisor": "مشرف",
    }.get(role, "مشرف")


def can_upload(member: dict[str, Any], kind: str) -> bool:
    role = str(member.get("role") or "")
    if role in {"owner", "admin"}:
        return True
    if role != "supervisor":
        return False
    return bool(member.get("can_movies")) if kind == "movie" else bool(member.get("can_series"))


def can_manage_channels(member: dict[str, Any]) -> bool:
    return str(member.get("role") or "") in {"owner", "admin"}


def can_manage_team(member: dict[str, Any]) -> bool:
    return str(member.get("role") or "") in {"owner", "admin"}


def main_menu(member: dict[str, Any]) -> list[list[Button]]:
    rows: list[list[Button]] = []
    upload_row: list[Button] = []
    bulk_row: list[Button] = []
    if can_upload(member, "movie"):
        upload_row.append(Button.inline("رفع فيلم", b"movie_single"))
        bulk_row.append(Button.inline("رفع جماعي أفلام", b"bulk_movies"))
    if can_upload(member, "series"):
        upload_row.append(Button.inline("رفع حلقة", b"series_single"))
        bulk_row.append(Button.inline("رفع جماعي حلقات", b"bulk_series"))
    if upload_row:
        rows.append(upload_row)
    if bulk_row:
        rows.append(bulk_row)

    utility_row = [Button.inline("آخر الملفات", b"recent"), Button.inline("حالة النظام", b"status")]
    rows.append(utility_row)

    manage_row: list[Button] = []
    if can_manage_channels(member):
        manage_row.append(Button.inline("إعداد القنوات", b"channels"))
    if can_manage_team(member):
        manage_row.append(Button.inline("إدارة الفريق", b"team"))
    if manage_row:
        rows.append(manage_row)

    rows.append([Button.inline("إلغاء العملية", b"cancel")])
    return rows


def channels_menu() -> list[list[Button]]:
    return [
        [Button.inline("تعيين قناة الأفلام", b"set_channel_movies")],
        [Button.inline("تعيين قناة المسلسلات", b"set_channel_series")],
        [Button.inline("اختبار القنوات", b"test_channels")],
        [Button.inline("رجوع", b"menu")],
    ]


def team_menu(member: dict[str, Any]) -> list[list[Button]]:
    rows: list[list[Button]] = []
    if str(member.get("role")) == "owner":
        rows.append([Button.inline("إضافة أدمن ثانوي", b"team_add_admin")])
    rows.extend([
        [Button.inline("مشرف أفلام + مسلسلات", b"team_add_supervisor_all")],
        [Button.inline("مشرف أفلام فقط", b"team_add_supervisor_movies"), Button.inline("مشرف مسلسلات فقط", b"team_add_supervisor_series")],
        [Button.inline("عرض الفريق", b"team_list"), Button.inline("حذف عضو", b"team_remove")],
        [Button.inline("رجوع", b"menu")],
    ])
    return rows


def db_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


async def db_request(
    method: str,
    table: str,
    *,
    params: dict[str, str] | None = None,
    json: Any = None,
    prefer: str | None = None,
) -> Any:
    if not database_configured() or http_client is None:
        raise RuntimeError("Database configuration is incomplete")
    headers = db_headers()
    if prefer:
        headers["Prefer"] = prefer
    response = await http_client.request(
        method,
        f"{SUPABASE_URL}/rest/v1/{table}",
        params=params,
        json=json,
        headers=headers,
        timeout=30.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Database HTTP {response.status_code}: {response.text[:500]}")
    if not response.content:
        return None
    try:
        return response.json()
    except Exception:
        return None


async def get_session() -> dict[str, Any] | None:
    rows = await db_request(
        "GET",
        "telegram_bot_sessions",
        params={
            "telegram_user_id": f"eq.{ADMIN_ID}",
            "select": "flow,step,draft,updated_at",
            "limit": "1",
        },
    )
    return rows[0] if rows else None


async def set_session(flow: str, step: str, draft: dict[str, Any] | None = None) -> None:
    await db_request(
        "POST",
        "telegram_bot_sessions",
        params={"on_conflict": "telegram_user_id"},
        json={
            "telegram_user_id": ADMIN_ID,
            "flow": flow,
            "step": step,
            "draft": draft or {},
            "updated_at": now_iso(),
        },
        prefer="resolution=merge-duplicates",
    )


async def clear_session() -> None:
    await db_request(
        "DELETE",
        "telegram_bot_sessions",
        params={"telegram_user_id": f"eq.{ADMIN_ID}"},
    )


async def get_channel_row(key: str) -> dict[str, Any] | None:
    rows = await db_request(
        "GET",
        "telegram_channels",
        params={
            "channel_key": f"eq.{key}",
            "active": "eq.true",
            "select": "channel_key,telegram_channel_id,title,username,verified_at,updated_at",
            "limit": "1",
        },
    )
    return rows[0] if rows else None


async def upsert_channel(key: str, entity: Any) -> dict[str, Any]:
    marked_id = int(utils.get_peer_id(entity))
    title = str(getattr(entity, "title", "") or "")[:180]
    username = str(getattr(entity, "username", "") or "")[:100]
    rows = await db_request(
        "POST",
        "telegram_channels",
        params={"on_conflict": "channel_key"},
        json={
            "channel_key": key,
            "telegram_channel_id": marked_id,
            "title": title,
            "username": username,
            "active": True,
            "configured_by": ADMIN_ID,
            "verified_at": now_iso(),
            "updated_at": now_iso(),
        },
        prefer="resolution=merge-duplicates,return=representation",
    )
    channel_cache[marked_id] = entity
    return rows[0] if rows else {
        "channel_key": key,
        "telegram_channel_id": marked_id,
        "title": title,
        "username": username,
    }


async def refresh_channel_cache() -> None:
    if not telegram_client:
        return
    try:
        dialogs = await telegram_client.get_dialogs(limit=None)
        for dialog in dialogs:
            try:
                marked_id = int(utils.get_peer_id(dialog.entity))
            except Exception:
                continue
            channel_cache[marked_id] = dialog.entity
    except Exception:
        pass


async def get_channel_entity(channel_id: int) -> Any:
    if not telegram_client:
        raise RuntimeError("Telegram client is not ready")
    if channel_id in channel_cache:
        return channel_cache[channel_id]
    await refresh_channel_cache()
    if channel_id in channel_cache:
        return channel_cache[channel_id]
    entity = await telegram_client.get_entity(channel_id)
    channel_cache[channel_id] = entity
    return entity


async def resolve_channel_reference(reference: str) -> Any:
    if not telegram_client:
        raise RuntimeError("Telegram client is not ready")
    value = reference.strip()
    if not value:
        raise ValueError("أرسل معرف القناة أو @username.")
    await refresh_channel_cache()
    if re.fullmatch(r"-?\d{5,20}", value):
        target = int(value)
        if target in channel_cache:
            return channel_cache[target]
        return await telegram_client.get_entity(target)
    if value.startswith("@"):
        return await telegram_client.get_entity(value)
    raise ValueError("صيغة القناة غير صحيحة. استخدم -100... أو @username.")


async def verify_channel_access(entity: Any) -> None:
    if not telegram_client:
        raise RuntimeError("Telegram client is not ready")
    sent = await telegram_client.send_message(entity, "CINARO storage channel verification")
    try:
        await sent.delete()
    except Exception:
        pass


async def create_batch(kind: str, season: int | None = None, start_episode: int | None = None) -> dict[str, Any]:
    code = batch_code(kind)
    rows = await db_request(
        "POST",
        "telegram_upload_batches",
        json={
            "batch_code": code,
            "media_kind": kind,
            "status": "open",
            "season": season,
            "start_episode": start_episode,
            "next_episode": start_episode,
            "total_files": 0,
            "created_by": ADMIN_ID,
            "updated_at": now_iso(),
        },
        prefer="return=representation",
    )
    if not rows:
        raise RuntimeError("تعذر إنشاء دفعة الرفع")
    return rows[0]


async def close_batch(batch_id: str, status: str = "completed") -> None:
    payload: dict[str, Any] = {"status": status, "updated_at": now_iso()}
    if status != "open":
        payload["completed_at"] = now_iso()
    await db_request(
        "PATCH",
        "telegram_upload_batches",
        params={"id": f"eq.{batch_id}"},
        json=payload,
    )


async def increment_batch(batch_id: str, total_files: int, next_episode: int | None = None) -> None:
    payload: dict[str, Any] = {"total_files": total_files, "updated_at": now_iso()}
    if next_episode is not None:
        payload["next_episode"] = next_episode
    await db_request(
        "PATCH",
        "telegram_upload_batches",
        params={"id": f"eq.{batch_id}"},
        json=payload,
    )


def extract_video(message: Any) -> dict[str, Any]:
    file = getattr(message, "file", None)
    if not file or not getattr(message, "media", None):
        raise ValueError("أرسل ملف MP4 كفيديو أو مستند.")
    size = int(getattr(file, "size", 0) or 0)
    name = str(getattr(file, "name", "") or f"cinaro-{getattr(message, 'id', 0)}.mp4")
    mime = str(getattr(file, "mime_type", "") or "application/octet-stream").lower()
    ext = os.path.splitext(name.lower())[1]
    if not (mime == "video/mp4" or ext in VIDEO_EXTENSIONS):
        raise ValueError("حالياً التخزين مخصص لملفات MP4 حتى يضمن CINARO التشغيل المباشر.")
    if size <= 0:
        raise ValueError("تعذر قراءة حجم الملف.")
    if size > MAX_MEDIA_BYTES:
        raise ValueError("حجم الملف أكبر من الحد الحالي 1.95 GB.")
    return {
        "size": size,
        "name": name[:300],
        "mime": "video/mp4",
        "media": message.media,
        "telegram_file_id": str(getattr(file, "id", "") or ""),
    }


async def insert_media_row(payload: dict[str, Any]) -> dict[str, Any]:
    rows = await db_request(
        "POST",
        "telegram_media",
        json=payload,
        prefer="return=representation",
    )
    if not rows:
        raise RuntimeError("تعذر تسجيل ملف Telegram")
    return rows[0]


async def store_message(
    event: Any,
    *,
    kind: str,
    season: int | None = None,
    episode: int | None = None,
    batch_id: str | None = None,
    batch_index: int | None = None,
) -> dict[str, Any]:
    if not telegram_client:
        raise RuntimeError("Telegram client is not ready")
    file = extract_video(event.message)
    channel_key = "movies" if kind == "movie" else "series"
    channel = await get_channel_row(channel_key)
    if not channel:
        raise ValueError(f"قناة {'الأفلام' if kind == 'movie' else 'المسلسلات'} غير مضبوطة بعد.")
    entity = await get_channel_entity(int(channel["telegram_channel_id"]))
    sid = storage_id(kind)
    caption_lines = ["CINARO Storage", f"ID: {sid}", f"Type: {kind}"]
    if season is not None:
        caption_lines.append(f"Season: {season}")
    if episode is not None:
        caption_lines.append(f"Episode: {episode}")
    caption_lines.append(f"Size: {human_size(file['size'])}")
    copied = await telegram_client.send_file(
        entity,
        file=file["media"],
        caption="\n".join(caption_lines),
        force_document=True,
    )
    row_payload = {
        "storage_id": sid,
        "media_kind": kind,
        "channel_id": int(channel["telegram_channel_id"]),
        "message_id": int(copied.id),
        "telegram_file_id": file["telegram_file_id"],
        "telegram_unique_id": "",
        "file_name": file["name"],
        "mime_type": file["mime"],
        "file_size": file["size"],
        "batch_id": batch_id,
        "batch_index": batch_index,
        "season": season,
        "episode": episode,
        "source_chat_id": int(event.chat_id or 0),
        "source_message_id": int(event.message.id),
        "created_by": ADMIN_ID,
        "status": "active",
        "updated_at": now_iso(),
    }
    try:
        return await insert_media_row(row_payload)
    except Exception:
        try:
            await copied.delete()
        except Exception:
            pass
        raise


async def recent_media(limit: int = 12) -> list[dict[str, Any]]:
    rows = await db_request(
        "GET",
        "telegram_media",
        params={
            "status": "eq.active",
            "select": "storage_id,media_kind,file_name,file_size,season,episode,created_at",
            "order": "created_at.desc",
            "limit": str(max(1, min(limit, 30))),
        },
    )
    return rows or []


async def media_row(sid: str, force: bool = False) -> dict[str, Any]:
    sid = sid.strip().upper()
    if not STORAGE_ID_RE.fullmatch(sid):
        raise HTTPException(status_code=404, detail="Media not found")
    now = time.monotonic()
    cached = media_cache.get(sid)
    if not force and cached and now - cached["at"] < MEDIA_CACHE_TTL:
        return cached["row"]
    rows = await db_request(
        "GET",
        "telegram_media",
        params={
            "storage_id": f"eq.{sid}",
            "status": "eq.active",
            "select": "storage_id,media_kind,channel_id,message_id,file_name,mime_type,file_size,season,episode",
            "limit": "1",
        },
    )
    if not rows:
        media_cache.pop(sid, None)
        raise HTTPException(status_code=404, detail="Media not found")
    row = rows[0]
    if len(media_cache) >= MEDIA_CACHE_MAX:
        oldest = min(media_cache, key=lambda key: media_cache[key]["at"])
        media_cache.pop(oldest, None)
    media_cache[sid] = {"at": now, "row": row}
    return row


async def telegram_message(row: dict[str, Any]) -> tuple[Any, int, str, str]:
    if not telegram_client:
        raise HTTPException(status_code=503, detail="Telegram gateway is not ready")
    entity = await get_channel_entity(int(row["channel_id"]))
    try:
        message = await telegram_client.get_messages(entity, ids=int(row["message_id"]))
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Telegram media lookup failed") from exc
    if not message or not message.media or not message.file:
        raise HTTPException(status_code=404, detail="Media not found")
    total = int(message.file.size or row.get("file_size") or 0)
    if total <= 0 or total > MAX_MEDIA_BYTES:
        raise HTTPException(status_code=413, detail="Media size is outside CINARO limits")
    mime = str(message.file.mime_type or row.get("mime_type") or "video/mp4")
    name = str(message.file.name or row.get("file_name") or f"{row['storage_id']}.mp4").replace('"', "").replace("\n", " ")
    return message, total, mime, name


def parse_range(value: str | None, total: int) -> tuple[int, int, bool]:
    if not value:
        start = 0
        end = min(total - 1, MAX_RANGE_WINDOW - 1)
        return start, end, end < total - 1
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value.strip())
    if not match:
        raise HTTPException(status_code=416, detail="Invalid Range header")
    first, last = match.groups()
    if first == "":
        suffix = int(last or "0")
        if suffix <= 0:
            raise HTTPException(status_code=416, detail="Invalid Range header")
        suffix = min(suffix, MAX_RANGE_WINDOW)
        start = max(total - suffix, 0)
        end = total - 1
    else:
        start = int(first)
        requested_end = int(last) if last else total - 1
        end = min(requested_end, total - 1, start + MAX_RANGE_WINDOW - 1)
    if start < 0 or start >= total or end < start:
        raise HTTPException(status_code=416, detail="Range not satisfiable")
    return start, end, True


async def show_main(chat_id: int, text: str = "CINARO Storage\nاختر العملية المطلوبة.") -> None:
    if telegram_client:
        await telegram_client.send_message(chat_id, text, buttons=main_menu())


async def show_channels(chat_id: int) -> None:
    movies, series = await asyncio.gather(get_channel_row("movies"), get_channel_row("series"))

    def label(row: dict[str, Any] | None) -> str:
        if not row:
            return "غير محددة"
        return str(row.get("title") or row.get("username") or row.get("telegram_channel_id"))

    await telegram_client.send_message(
        chat_id,
        "إعداد قنوات التخزين\n\n"
        f"الأفلام: {label(movies)}\n"
        f"المسلسلات: {label(series)}\n\n"
        "أضف البوت كمدير بصلاحية النشر، ثم عيّن القناة من الأزرار.",
        buttons=channels_menu(),
    )


async def finish_current_batch(chat_id: int) -> None:
    session = await get_session()
    if not session or session.get("flow") not in {"bulk_movies", "bulk_series"}:
        await telegram_client.send_message(chat_id, "لا توجد دفعة رفع مفتوحة.", buttons=main_menu())
        return
    draft = session.get("draft") or {}
    batch_id = str(draft.get("batch_id") or "")
    if batch_id:
        await close_batch(batch_id, "completed")
    count = int(draft.get("count") or 0)
    items = draft.get("items") if isinstance(draft.get("items"), list) else []
    await clear_session()
    summary = "\n".join(str(item) for item in items[-30:])
    text = f"اكتملت الدفعة.\nعدد الملفات: {count}"
    if summary:
        text += f"\n\n{summary}"
    await telegram_client.send_message(chat_id, text[:3900], buttons=main_menu())


async def handle_admin_message(event: Any) -> None:
    if not is_private_admin(event):
        if getattr(event, "is_private", False) and telegram_client:
            await event.respond("هذا البوت مخصص لإدارة CINARO فقط.")
        return
    if not database_configured():
        await event.respond("قاعدة بيانات البوابة غير مهيأة بعد.")
        return

    text = str(getattr(event.message, "message", "") or "").strip()
    command = text.split()[0].lower() if text.startswith("/") else ""
    if command in {"/start", "/menu"}:
        await clear_session()
        await show_main(event.chat_id)
        return
    if command in {"/cancel", "/الغاء"}:
        session = await get_session()
        if session and (session.get("draft") or {}).get("batch_id"):
            try:
                await close_batch(str(session["draft"]["batch_id"]), "cancelled")
            except Exception:
                pass
        await clear_session()
        await show_main(event.chat_id, "تم إلغاء العملية الحالية.")
        return
    if command == "/done":
        await finish_current_batch(event.chat_id)
        return
    if command == "/status":
        movies, series = await asyncio.gather(get_channel_row("movies"), get_channel_row("series"))
        await event.respond(
            "حالة CINARO Storage\n"
            f"Telegram: {'متصل' if telegram_client and telegram_client.is_connected() else 'غير متصل'}\n"
            f"قناة الأفلام: {'جاهزة' if movies else 'غير محددة'}\n"
            f"قناة المسلسلات: {'جاهزة' if series else 'غير محددة'}\n"
            "الحد: 1.95 GB"
        )
        return

    session = await get_session()
    if not session:
        if getattr(event.message, "media", None):
            await event.respond("اختر نوع الرفع أولاً من القائمة.", buttons=main_menu())
        else:
            await show_main(event.chat_id)
        return

    flow = str(session.get("flow") or "")
    step = str(session.get("step") or "")
    draft = session.get("draft") if isinstance(session.get("draft"), dict) else {}

    if flow == "set_channel" and step == "reference":
        try:
            entity = await resolve_channel_reference(text)
            await verify_channel_access(entity)
            row = await upsert_channel(str(draft.get("channel_key")), entity)
            await clear_session()
            label = row.get("title") or row.get("username") or row.get("telegram_channel_id")
            await event.respond(f"تم ربط القناة بنجاح: {label}", buttons=main_menu())
        except Exception as exc:
            await event.respond(f"تعذر ربط القناة: {str(exc)[:500]}")
        return

    if flow == "series_single" and step == "season":
        if not text.isdigit() or int(text) < 1 or int(text) > 999:
            await event.respond("أرسل رقم موسم صحيح.")
            return
        draft["season"] = int(text)
        await set_session(flow, "episode", draft)
        await event.respond("أرسل رقم الحلقة.")
        return

    if flow == "series_single" and step == "episode":
        if not text.isdigit() or int(text) < 1 or int(text) > 99999:
            await event.respond("أرسل رقم حلقة صحيح.")
            return
        draft["episode"] = int(text)
        await set_session(flow, "file", draft)
        await event.respond("أرسل ملف الحلقة بصيغة MP4. الحد 1.95 GB.")
        return

    if flow == "bulk_series" and step == "season":
        if not text.isdigit() or int(text) < 1 or int(text) > 999:
            await event.respond("أرسل رقم موسم صحيح.")
            return
        draft["season"] = int(text)
        await set_session(flow, "start_episode", draft)
        await event.respond("أرسل رقم أول حلقة في الدفعة.")
        return

    if flow == "bulk_series" and step == "start_episode":
        if not text.isdigit() or int(text) < 1 or int(text) > 99999:
            await event.respond("أرسل رقم حلقة صحيح.")
            return
        start = int(text)
        batch = await create_batch("series", int(draft["season"]), start)
        draft.update({
            "batch_id": batch["id"],
            "batch_code": batch["batch_code"],
            "next_episode": start,
            "count": 0,
            "items": [],
        })
        await set_session(flow, "files", draft)
        await event.respond(
            f"دفعة الحلقات جاهزة. الموسم {draft['season']}، البداية من الحلقة {start}.\n"
            "أرسل ملفات MP4 بالترتيب. عند الانتهاء أرسل /done."
        )
        return

    if not getattr(event.message, "media", None):
        await event.respond("أرسل الملف المطلوب أو استخدم /cancel للإلغاء.")
        return

    try:
        if flow == "movie_single" and step == "file":
            row = await store_message(event, kind="movie")
            await clear_session()
            await event.respond(
                f"تم تخزين الفيلم.\nID: {row['storage_id']}\nالحجم: {human_size(int(row['file_size']))}",
                buttons=main_menu(),
            )
            return

        if flow == "series_single" and step == "file":
            row = await store_message(
                event,
                kind="series",
                season=int(draft.get("season") or 1),
                episode=int(draft.get("episode") or 1),
            )
            await clear_session()
            await event.respond(
                f"تم تخزين الحلقة.\nS{int(draft['season']):02d}E{int(draft['episode']):02d}\n"
                f"ID: {row['storage_id']}\nالحجم: {human_size(int(row['file_size']))}",
                buttons=main_menu(),
            )
            return

        if flow == "bulk_movies" and step == "files":
            count = int(draft.get("count") or 0) + 1
            row = await store_message(
                event,
                kind="movie",
                batch_id=str(draft.get("batch_id") or ""),
                batch_index=count,
            )
            items = draft.get("items") if isinstance(draft.get("items"), list) else []
            items.append(f"{count}. {row['storage_id']}")
            draft.update({"count": count, "items": items[-100:]})
            await increment_batch(str(draft["batch_id"]), count)
            await set_session(flow, "files", draft)
            await event.respond(f"{count}. تم الرفع\nID: {row['storage_id']}\nأرسل الملف التالي أو /done")
            return

        if flow == "bulk_series" and step == "files":
            count = int(draft.get("count") or 0) + 1
            episode = int(draft.get("next_episode") or 1)
            season = int(draft.get("season") or 1)
            row = await store_message(
                event,
                kind="series",
                season=season,
                episode=episode,
                batch_id=str(draft.get("batch_id") or ""),
                batch_index=count,
            )
            items = draft.get("items") if isinstance(draft.get("items"), list) else []
            items.append(f"S{season:02d}E{episode:02d} → {row['storage_id']}")
            draft.update({"count": count, "next_episode": episode + 1, "items": items[-100:]})
            await increment_batch(str(draft["batch_id"]), count, episode + 1)
            await set_session(flow, "files", draft)
            await event.respond(
                f"S{season:02d}E{episode:02d} تم الرفع\nID: {row['storage_id']}\n"
                "أرسل الحلقة التالية أو /done"
            )
            return
    except Exception as exc:
        await event.respond(f"تعذر تخزين الملف: {str(exc)[:600]}")


async def handle_callback(event: Any) -> None:
    if int(getattr(event, "sender_id", 0) or 0) != ADMIN_ID:
        await event.answer("غير مصرح", alert=True)
        return
    data = bytes(getattr(event, "data", b"") or b"").decode("utf-8", "ignore")
    await event.answer()
    chat_id = int(event.chat_id)

    if data == "menu":
        await clear_session()
        await show_main(chat_id)
    elif data == "cancel":
        session = await get_session()
        if session and (session.get("draft") or {}).get("batch_id"):
            try:
                await close_batch(str(session["draft"]["batch_id"]), "cancelled")
            except Exception:
                pass
        await clear_session()
        await show_main(chat_id, "تم إلغاء العملية الحالية.")
    elif data == "movie_single":
        await set_session("movie_single", "file", {})
        await telegram_client.send_message(chat_id, "أرسل ملف الفيلم بصيغة MP4. الحد 1.95 GB.")
    elif data == "series_single":
        await set_session("series_single", "season", {})
        await telegram_client.send_message(chat_id, "أرسل رقم الموسم.")
    elif data == "bulk_movies":
        batch = await create_batch("movie")
        await set_session("bulk_movies", "files", {
            "batch_id": batch["id"],
            "batch_code": batch["batch_code"],
            "count": 0,
            "items": [],
        })
        await telegram_client.send_message(
            chat_id,
            "بدأت دفعة أفلام. أرسل ملفات MP4 واحداً بعد الآخر. عند الانتهاء أرسل /done.",
        )
    elif data == "bulk_series":
        await set_session("bulk_series", "season", {})
        await telegram_client.send_message(chat_id, "أرسل رقم الموسم لهذه الدفعة.")
    elif data == "channels":
        await show_channels(chat_id)
    elif data == "set_channel_movies":
        await set_session("set_channel", "reference", {"channel_key": "movies"})
        await telegram_client.send_message(
            chat_id,
            "أرسل ID قناة الأفلام مثل -100... أو @username. يجب أن يكون البوت مديراً فيها بصلاحية النشر.",
        )
    elif data == "set_channel_series":
        await set_session("set_channel", "reference", {"channel_key": "series"})
        await telegram_client.send_message(
            chat_id,
            "أرسل ID قناة المسلسلات مثل -100... أو @username. يجب أن يكون البوت مديراً فيها بصلاحية النشر.",
        )
    elif data == "test_channels":
        results = []
        for key, label in (("movies", "الأفلام"), ("series", "المسلسلات")):
            try:
                row = await get_channel_row(key)
                if not row:
                    results.append(f"{label}: غير محددة")
                    continue
                entity = await get_channel_entity(int(row["telegram_channel_id"]))
                await verify_channel_access(entity)
                results.append(f"{label}: تعمل")
            except Exception as exc:
                results.append(f"{label}: فشل ({str(exc)[:120]})")
        await telegram_client.send_message(chat_id, "فحص القنوات\n" + "\n".join(results), buttons=channels_menu())
    elif data == "recent":
        rows = await recent_media(12)
        if not rows:
            await telegram_client.send_message(chat_id, "لا توجد ملفات مخزنة بعد.", buttons=main_menu())
            return
        lines = []
        for row in rows:
            extra = ""
            if row.get("media_kind") == "series" and row.get("season") and row.get("episode"):
                extra = f" S{int(row['season']):02d}E{int(row['episode']):02d}"
            lines.append(f"{row['storage_id']}{extra} · {human_size(int(row.get('file_size') or 0))}")
        await telegram_client.send_message(chat_id, "آخر الملفات\n\n" + "\n".join(lines), buttons=main_menu())
    elif data == "status":
        movies, series = await asyncio.gather(get_channel_row("movies"), get_channel_row("series"))
        await telegram_client.send_message(
            chat_id,
            "حالة CINARO Storage\n"
            f"Telegram: {'متصل' if telegram_client and telegram_client.is_connected() else 'غير متصل'}\n"
            f"Database: {'متصل' if database_configured() else 'غير مهيأ'}\n"
            f"قناة الأفلام: {'جاهزة' if movies else 'غير محددة'}\n"
            f"قناة المسلسلات: {'جاهزة' if series else 'غير محددة'}\n"
            "الحد: 1.95 GB",
            buttons=main_menu(),
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global telegram_client, http_client
    http_client = httpx.AsyncClient(follow_redirects=False)
    if telegram_configured():
        try:
            telegram_client = TelegramClient(None, API_ID, API_HASH)
            telegram_client.add_event_handler(handle_admin_message, events.NewMessage(incoming=True))
            telegram_client.add_event_handler(handle_callback, events.CallbackQuery())
            await telegram_client.start(bot_token=BOT_TOKEN)
            await refresh_channel_cache()
        except Exception as exc:
            print(f"Telegram startup failed: {exc}", flush=True)
            try:
                if telegram_client:
                    await telegram_client.disconnect()
            except Exception:
                pass
            telegram_client = None
    yield
    if telegram_client:
        try:
            await telegram_client.disconnect()
        except Exception:
            pass
    if http_client:
        await http_client.aclose()


app = FastAPI(title="CINARO Telegram Storage Gateway", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "HEAD", "OPTIONS"],
    allow_headers=["Range", "Content-Type", "Accept"],
    expose_headers=["Content-Length", "Content-Range", "Accept-Ranges", "Content-Type", "X-CINARO-Storage"],
)


@app.get("/")
async def root() -> dict[str, Any]:
    return {"name": "CINARO Gateway", "ok": True, "storage": "private-media", "version": "1.0.0"}


@app.get("/health")
async def health() -> dict[str, Any]:
    movies = series = False
    if database_configured():
        try:
            movies_row, series_row = await asyncio.gather(get_channel_row("movies"), get_channel_row("series"))
            movies = bool(movies_row)
            series = bool(series_row)
        except Exception:
            pass
    return {
        "ok": True,
        "ready": bot_ready() and movies and series,
        "telegramConfigured": telegram_configured(),
        "telegramConnected": bool(telegram_client and telegram_client.is_connected()),
        "databaseConfigured": database_configured(),
        "moviesChannelConfigured": movies,
        "seriesChannelConfigured": series,
        "maxMediaBytes": MAX_MEDIA_BYTES,
        "maxMediaGB": 1.95,
        "rangeStreaming": True,
        "activeStreams": active_streams,
        "maxConcurrentStreams": MAX_CONCURRENT_STREAMS,
        "totalStreamRequests": total_stream_requests,
        "rangeRequests": range_requests,
        "streamFailures": stream_failures,
        "streamRetries": stream_retries,
        "streamRejections": stream_rejections,
        "bytesServed": bytes_served,
    }


@app.get("/meta/{sid}")
async def meta(sid: str) -> dict[str, Any]:
    if not bot_ready():
        raise HTTPException(status_code=503, detail="Gateway is not ready")
    row = await media_row(sid)
    return {
        "ok": True,
        "storageId": row["storage_id"],
        "kind": row["media_kind"],
        "fileName": row.get("file_name") or "",
        "mimeType": row.get("mime_type") or "video/mp4",
        "fileSize": int(row.get("file_size") or 0),
        "season": row.get("season"),
        "episode": row.get("episode"),
    }


@app.api_route("/stream/{sid}", methods=["GET", "HEAD"])
async def stream(sid: str, request: Request):
    global active_streams, total_stream_requests, range_requests
    global stream_failures, stream_retries, stream_rejections, bytes_served

    if not bot_ready():
        raise HTTPException(status_code=503, detail="Gateway is not ready")
    row = await media_row(sid)
    message, total, mime, name = await telegram_message(row)
    range_header = request.headers.get("range")
    total_stream_requests += 1
    if range_header:
        range_requests += 1

    if request.method == "HEAD" and not range_header:
        start, end, partial = 0, total - 1, False
    else:
        start, end, partial = parse_range(range_header, total)
    length = end - start + 1
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Content-Disposition": f'inline; filename="{name}"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
        "X-CINARO-Storage": row["storage_id"],
    }
    if partial:
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
    status = 206 if partial else 200
    if request.method == "HEAD":
        return Response(status_code=status, headers=headers, media_type=mime)

    try:
        await asyncio.wait_for(stream_slots.acquire(), timeout=STREAM_QUEUE_TIMEOUT)
    except asyncio.TimeoutError as exc:
        stream_rejections += 1
        raise HTTPException(
            status_code=503,
            detail="Streaming capacity is busy; retry shortly",
            headers={"Retry-After": "3"},
        ) from exc

    active_streams += 1

    async def body():
        global active_streams, stream_failures, stream_retries, bytes_served
        remaining = length
        position = start
        failures = 0
        current_message = message
        try:
            while remaining > 0:
                if await request.is_disconnected():
                    break
                try:
                    iterator = telegram_client.iter_download(
                        current_message.media,
                        offset=position,
                        request_size=CHUNK_SIZE,
                        chunk_size=CHUNK_SIZE,
                    ).__aiter__()
                    while remaining > 0:
                        if await request.is_disconnected():
                            return
                        try:
                            chunk = await asyncio.wait_for(iterator.__anext__(), timeout=STREAM_CHUNK_TIMEOUT)
                        except StopAsyncIteration:
                            if remaining > 0:
                                raise RuntimeError("Telegram stream ended before requested range completed")
                            break
                        if not chunk:
                            raise RuntimeError("Telegram returned an empty media chunk")
                        if len(chunk) > remaining:
                            chunk = chunk[:remaining]
                        position += len(chunk)
                        remaining -= len(chunk)
                        bytes_served += len(chunk)
                        failures = 0
                        yield chunk
                    break
                except asyncio.CancelledError:
                    raise
                except Exception:
                    failures += 1
                    if failures > STREAM_READ_RETRIES:
                        stream_failures += 1
                        raise
                    stream_retries += 1
                    try:
                        refreshed_row = await media_row(row["storage_id"], force=True)
                        current_message, refreshed_total, _, _ = await telegram_message(refreshed_row)
                        if refreshed_total != total:
                            raise RuntimeError("Telegram media size changed during stream")
                    except Exception:
                        if failures > STREAM_READ_RETRIES:
                            raise
                    await asyncio.sleep(min(2.5, 0.4 * (2 ** (failures - 1))))
        finally:
            active_streams = max(0, active_streams - 1)
            stream_slots.release()

    return StreamingResponse(body(), status_code=status, headers=headers, media_type=mime)
