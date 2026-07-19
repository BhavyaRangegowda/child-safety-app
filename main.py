import os
import io
import time
import base64
import binascii
import re
import secrets
import smtplib
import socket
import asyncio
import logging
import tempfile
import math
from pathlib import Path
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Security, Depends, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware 
from fastapi.security.api_key import APIKeyHeader
from fastapi.responses import FileResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator
from PIL import Image, ImageOps, UnidentifiedImageError
from jinja2 import Template
from cryptography.fernet import Fernet
from email.message import EmailMessage
from email.utils import formataddr
from dotenv import load_dotenv
from starlette.background import BackgroundTask
from weasyprint import HTML
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("child_safety_app")

DEFAULT_SMTP_CONNECT_TIMEOUT_SECONDS = 15
DEFAULT_SMTP_OPERATION_TIMEOUT_SECONDS = 30
DEFAULT_PDF_GENERATION_TIMEOUT_SECONDS = 45
MAX_TIMEOUT_SECONDS = 300
PDF_EXECUTOR = ThreadPoolExecutor(max_workers=4)


@dataclass(frozen=True)
class AppSettings:
    securepass_token: str
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_from_name: str = "SecurePass Child Safety"
    alert_recipient_email: str | None = None
    email_enabled: bool = True
    smtp_connect_timeout_seconds: int = DEFAULT_SMTP_CONNECT_TIMEOUT_SECONDS
    smtp_operation_timeout_seconds: int = DEFAULT_SMTP_OPERATION_TIMEOUT_SECONDS
    pdf_generation_timeout_seconds: int = DEFAULT_PDF_GENERATION_TIMEOUT_SECONDS


settings: AppSettings | None = None


def _read_env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None:
        return default
    value = value.strip()
    return value or None


def _read_bool_env(name: str, default: bool) -> bool:
    raw_value = _read_env(name)
    if raw_value is None:
        return default
    normalized = raw_value.lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


def _parse_timeout(name: str, default: int) -> int:
    raw_value = _read_env(name, str(default))
    try:
        parsed_value = int(raw_value or str(default))
    except (TypeError, ValueError):
        return default

    if parsed_value <= 0 or parsed_value > MAX_TIMEOUT_SECONDS:
        return default
    return parsed_value


def _load_settings() -> AppSettings:
    securepass_token = _read_env("SECUREPASS_TOKEN") or _read_env("MOBILE_APP_SECRET")
    if not securepass_token:
        raise RuntimeError("Missing required environment variable: SECUREPASS_TOKEN")

    smtp_host = _read_env("SMTP_HOST")
    smtp_port_raw = _read_env("SMTP_PORT", "587")
    try:
        smtp_port = int(smtp_port_raw or "587")
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Invalid environment variable: SMTP_PORT") from exc

    smtp_username = _read_env("SMTP_USERNAME")
    smtp_password = _read_env("SMTP_PASSWORD")
    smtp_from_email = _read_env("SMTP_FROM_EMAIL")
    smtp_from_name = _read_env("SMTP_FROM_NAME", "SecurePass Child Safety") or "SecurePass Child Safety"
    alert_recipient_email = _read_env("ALERT_RECIPIENT_EMAIL")
    email_enabled = _read_bool_env("EMAIL_ENABLED", True)
    smtp_connect_timeout_seconds = _parse_timeout("SMTP_CONNECT_TIMEOUT_SECONDS", DEFAULT_SMTP_CONNECT_TIMEOUT_SECONDS)
    smtp_operation_timeout_seconds = _parse_timeout("SMTP_OPERATION_TIMEOUT_SECONDS", DEFAULT_SMTP_OPERATION_TIMEOUT_SECONDS)
    pdf_generation_timeout_seconds = _parse_timeout("PDF_GENERATION_TIMEOUT_SECONDS", DEFAULT_PDF_GENERATION_TIMEOUT_SECONDS)

    if email_enabled:
        missing = []
        if not smtp_host:
            missing.append("SMTP_HOST")
        if not smtp_username:
            missing.append("SMTP_USERNAME")
        if not smtp_password:
            missing.append("SMTP_PASSWORD")
        if not smtp_from_email:
            missing.append("SMTP_FROM_EMAIL")
        if missing:
            raise RuntimeError(f"Missing required environment variable: {missing[0]}")

    return AppSettings(
        securepass_token=securepass_token,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_username=smtp_username,
        smtp_password=smtp_password,
        smtp_from_email=smtp_from_email,
        smtp_from_name=smtp_from_name,
        alert_recipient_email=alert_recipient_email,
        email_enabled=email_enabled,
        smtp_connect_timeout_seconds=smtp_connect_timeout_seconds,
        smtp_operation_timeout_seconds=smtp_operation_timeout_seconds,
        pdf_generation_timeout_seconds=pdf_generation_timeout_seconds,
    )


def _ensure_settings() -> AppSettings:
    global settings
    if settings is None:
        settings = _load_settings()
    return settings


async def file_cleanup_janitor():
    while True:
        try:
            target_dir = "temp_assets"
            if os.path.exists(target_dir):
                now = time.time()
                cutoff = now - 86400 
                for filename in os.listdir(target_dir):
                    file_path = os.path.join(target_dir, filename)
                    if os.path.isfile(file_path):
                        if os.path.getmtime(file_path) < cutoff:
                            file_size = os.path.getsize(file_path)
                            with open(file_path, "wb") as f:
                                f.write(os.urandom(file_size))
                            os.remove(file_path)
        except Exception as e:
            logger.warning("Temporary-file janitor encountered an error.")
        await asyncio.sleep(3600)

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        _ensure_settings()
    except RuntimeError as exc:
        logger.error("Configuration error: %s", exc)
        raise

    logger.info("Configuration loaded.")
    if settings and settings.email_enabled:
        logger.info("Email delivery enabled.")
    else:
        logger.info("Email delivery disabled by configuration.")

    janitor_task = asyncio.create_task(file_cleanup_janitor())
    yield
    janitor_task.cancel()

app = FastAPI(title="SecurePass Enterprise Engine", lifespan=lifespan, redirect_slashes=False)

# In-memory idempotency cache for a single backend instance.
# When this application scales to multiple instances, this should be replaced with shared storage.
_idempotency_lock = asyncio.Lock()
_idempotency_cache = {}
_IDEMPOTENCY_TTL_SECONDS = 15 * 60
_IDEMPOTENCY_MAX_ENTRIES = 500

async def _cleanup_idempotency_cache() -> None:
    now = time.time()
    async with _idempotency_lock:
        expired_keys = [key for key, entry in _idempotency_cache.items() if now - entry["created_at"] > _IDEMPOTENCY_TTL_SECONDS]
        for key in expired_keys:
            for temp_path in _idempotency_cache[key].get("temp_paths", []):
                try:
                    secure_delete_file(temp_path)
                except Exception:
                    logger.warning("Temporary-file cleanup failed for an expired request cache entry.")
            del _idempotency_cache[key]

        if len(_idempotency_cache) > _IDEMPOTENCY_MAX_ENTRIES:
            oldest_keys = sorted(_idempotency_cache, key=lambda key: _idempotency_cache[key]["created_at"])[: len(_idempotency_cache) - _IDEMPOTENCY_MAX_ENTRIES]
            for key in oldest_keys:
                for temp_path in _idempotency_cache[key].get("temp_paths", []):
                    try:
                        secure_delete_file(temp_path)
                    except Exception:
                        logger.warning("Temporary-file cleanup failed for a trimmed request cache entry.")
                del _idempotency_cache[key]

async def _get_idempotency_entry(request_id: str):
    if not request_id:
        return None
    await _cleanup_idempotency_cache()
    async with _idempotency_lock:
        return _idempotency_cache.get(request_id)

async def _store_idempotency_entry(request_id: str, response_payload: dict, status_code: int, headers: dict, temp_paths: list | None = None) -> None:
    if not request_id:
        return
    await _cleanup_idempotency_cache()
    async with _idempotency_lock:
        _idempotency_cache[request_id] = {
            "created_at": time.time(),
            "response_payload": response_payload,
            "status_code": status_code,
            "headers": headers,
            "temp_paths": temp_paths or [],
        }

async def _set_processing_idempotency_entry(request_id: str) -> bool:
    if not request_id:
        return False
    await _cleanup_idempotency_cache()
    async with _idempotency_lock:
        if request_id in _idempotency_cache:
            return False
        _idempotency_cache[request_id] = {
            "created_at": time.time(),
            "status": "processing",
            "headers": {},
            "response_payload": None,
        }
        return True

async def _remove_processing_entry(request_id: str) -> None:
    if not request_id:
        return
    async with _idempotency_lock:
        if request_id in _idempotency_cache and _idempotency_cache[request_id].get("status") == "processing":
            del _idempotency_cache[request_id]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Email-Status"],
)

@app.get("/")
async def root():
    return {"message": "SecurePass backend is running"}

@app.get("/health")
async def health():
    return {"status": "ok"}


KEY_FILE = "secret.key"
if not os.path.exists(KEY_FILE):
    with open(KEY_FILE, "wb") as kf:
        kf.write(Fernet.generate_key())

with open(KEY_FILE, "rb") as kf:
    cipher = Fernet(kf.read())

def encrypt_file(file_path):
    if os.path.exists(file_path):
        with open(file_path, "rb") as f:
            data = f.read()
        with open(file_path, "wb") as f:
            f.write(cipher.encrypt(data))

def secure_delete_file(file_path: str | os.PathLike):
    """Best-effort cleanup for sensitive temporary image/PDF files."""
    try:
        path = Path(file_path)
        if path.exists() and path.is_file():
            file_size = path.stat().st_size
            if file_size > 0:
                with open(path, "wb") as f:
                    f.write(os.urandom(file_size))
            path.unlink()
    except Exception:
        logger.warning("Temporary-file cleanup failed for a request.")


def _cleanup_temp_paths(temp_paths: list[Path] | None) -> None:
    if not temp_paths:
        return
    for temp_path in list(temp_paths):
        try:
            secure_delete_file(temp_path)
        except Exception:
            logger.warning("Temporary-file cleanup failed for a request.")

API_KEY_NAME = "X-SecurePass-Token"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)
MAX_REQUEST_SIZE_MB = 30


def _get_max_request_size_mb() -> int:
    raw_value = os.getenv("MAX_REQUEST_SIZE_MB", "30")
    try:
        parsed_value = int(raw_value)
        if parsed_value > 0:
            return parsed_value
    except (TypeError, ValueError):
        pass
    return MAX_REQUEST_SIZE_MB

MAX_REQUEST_SIZE_MB = _get_max_request_size_mb()

async def verify_mobile_app(request: Request, api_key: str = Depends(api_key_header)):
    if request.method == "OPTIONS":
        return api_key

    config = _ensure_settings()
    provided_token = (api_key or "").strip()
    expected_token = config.securepass_token

    if not provided_token or not secrets.compare_digest(provided_token, expected_token):
        raise HTTPException(status_code=403, detail="Unauthorized request.")
    return api_key

# --- RESILIENT PANIC-PROOF TARGET DATA VALIDATION SCHEMA ---
class MissingChildPayload(BaseModel):
    child_name: str = Field(..., min_length=1, max_length=150)
    age_gender: str = Field(..., max_length=250)  
    parent_name: str = Field(..., min_length=1, max_length=150)
    phone: str = Field(..., min_length=1, max_length=150)
    alt_phone: str = Field("None designated", max_length=150)
    parent_email: str = Field("None provided", max_length=150)
    full_address: str = Field(..., min_length=1, max_length=255)  
    date_last_seen: str = Field("Not provided", max_length=20)
    time_last_seen: str = Field("Not provided", max_length=20)
    shoes: str = Field("Not provided", max_length=150)
    skin_tone: str = Field("Not provided", max_length=150)
    eye_color: str = Field("Not provided", max_length=150)
    birth_marks: str = Field("None noted", max_length=500)
    clothing_desc: str = Field("Not provided", max_length=500)  
    electronics: str = Field("None reported", max_length=500)
    pets_toys: str = Field("None reported", max_length=500)
    reporting_agency: str = Field("Local Law Enforcement", max_length=200)
    photo_context: str = Field("Not provided", max_length=100)
    compressed_photo: str
    lang: str = Field('en', max_length=2)

    # Note: reporting_agency is now included in the list below
    @field_validator('child_name', 'parent_name', 'phone', 'alt_phone', 'parent_email', 
                     'full_address', 'date_last_seen', 'time_last_seen', 'shoes', 'skin_tone', 'eye_color', 'birth_marks', 
                     'electronics', 'pets_toys', 'reporting_agency', 'photo_context')
    @classmethod
    def sanitize_and_clean_human_inputs(cls, v: str) -> str:
        clean = re.sub(r'[<>&"\']', '', v)
        clean = clean.strip()
        if not clean:
            return "Not provided"
        return clean

PDF_TEMPLATE = """
<html>
<head>
<meta charset="UTF-8">
<style>
    body { font-family: sans-serif; padding: 25px; background: #fff; color: #222; }
   .alert-box {
    border: 4px dashed #d9534f;
    padding: 20px;
    min-height: 850px;
    position: relative;
    box-sizing: border-box; }
    .banner { background: #d9534f; color: white; padding: 12px; margin: 15px 0; font-weight: bold; text-align: center; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; }
    p { font-size: 15px; margin: 6px 0; line-height: 1.3; }
    h1 { color: #d9534f; font-size: 34px; text-align: center; margin: 0 0 5px 0; font-weight: bold; }
    h4 { color: #0275d8; margin: 15px 0 8px 0; border-bottom: 2px solid #eee; padding-bottom: 3px; font-size: 16px; text-transform: uppercase; }
    .highlight-container { margin-top: 15px; border-left: 4px solid #5cb85c; padding-left: 15px; background: #f9f9f9; padding-top: 2px; padding-bottom: 2px; }
    @page {
        size: Letter;
        margin: 12mm;
    }

    body {
        margin: 0;
    }
    </style>
</head>
<body>
    <div class="alert-box">
        <h1>MISSING CHILD ALERT</h1>
        <div class="banner">
            LAST SEEN LOCATION: {{ venue }}<br>
            Date Last Seen: {{ date_last_seen }}<br>
            Time Last Seen: {{ time_last_seen }}
        </div>
        <p style="margin: 0 0 10px 0; font-size: 12px; color: #666; text-align: center;">Date and time are reported in the local time of the last-seen location.</p>
        <table>
            <tr>
                <td style="width: 42%;"><img src="{{ image_path }}" style="width: 100%; max-height: 420px; object-fit: contain; border: 3px solid #d9534f;"><p><strong>Photo Information:</strong> {{ photo_context }}</p></td>
                <td style="width: 58%; padding-left: 20px;">
                    <h4>Vital Statistics</h4>
                    <p><strong>Full Name:</strong> {{ child_name }}</p>
                    <p><strong>Age / Gender:</strong> {{ age_gender }}</p>
                    <p><strong>Skin Tone:</strong> {{ skin_tone }}</p>
                    <p><strong>Eye Color:</strong> {{ eye_color }}</p>
                    <p><strong>Footwear:</strong> {{ shoes }}</p>
                    <p><strong>Marks / Scars / Features:</strong> {{ birth_marks }}</p>
                    
                   <h4>Emergency Contact Data</h4>
                    <p><strong>Parent / Guardian:</strong> {{ parent_name }}</p>
                    <p><strong>Primary Phone:</strong> {{ phone }}</p>
                    <p><strong>Alternate Phone:</strong> {{ alt_phone }}</p>
                    <p><strong>Email Address:</strong> {{ parent_email }}</p>
                    <p style="font-size: 12px; color: #666; margin-top: 6px;">International contact: Country code included when provided.</p>
                    <div style="margin-top: 10px; padding: 8px; background: #fff3cd; border: 1px solid #ffeeba;">
                        <p style="margin: 0;"><strong>Reporting Agency</strong><br> {{ reporting_agency }}</p>
                    </div>
                </td>
            </tr>
        </table>

        <div class="highlight-container">
            <h4>Clothing When Last Seen</h4>
            <p>{{ clothing_desc }}</p>
        </div>

        <div style="margin-top: 12px; display: table; width: 100%;">
            <div style="display: table-row;">
                <div style="display: table-cell; width: 50%; padding-right: 10px;">
                    <div style="border: 1px dashed #0275d8; padding: 10px; background: #f4f8fa; min-height: 75px;">
                        <strong style="color: #0275d8; font-size: 13px; text-transform: uppercase;">Accessories & Electronics:</strong>
                        <p style="margin: 4px 0 0 0; font-size: 13px; line-height: 1.4;">{{ electronics }}</p>
                    </div>
                </div>
                <div style="display: table-cell; width: 50%; padding-left: 10px;">
                    <div style="border: 1px dashed #f0ad4e; padding: 10px; background: #fdf8e2; min-height: 75px;">
                        <strong style="color: #f0ad4e; font-size: 13px; text-transform: uppercase;">Accompanying Pets / Toys:</strong>
                        <p style="margin: 4px 0 0 0; font-size: 13px; line-height: 1.4;">{{ pets_toys }}</p>
                    </div>
                </div>
            </div>
        </div>

        <div style="
            margin-top: 22px;
            border-top: 3px solid #d9534f;
            padding: 12px 12px 0 12px;
            text-align: center;
            page-break-inside: avoid;
        ">
            <p style="
                font-size: 13px;
                font-weight: bold;
                color: #d9534f;
                text-transform: uppercase;
                margin: 0 0 8px 0;
                line-height: 1.35;
                letter-spacing: 0.3px;
            ">
                IF YOU HAVE INFORMATION CONCERNING THIS CHILD, IMMEDIATELY CALL LOCAL EMERGENCY SERVICES OR THE REPORTING AGENCY NOTED ABOVE.
            </p>

            <p style="
                font-size: 10px;
                color: #555555;
                line-height: 1.45;
                font-style: italic;
                margin: 0;
            ">
                Do not take independent action. All sightings, tips, and active coordinate updates must be reported
                directly to regional emergency response authorities or the
                <strong>reporting agency noted above</strong>.
            </p>
        </div>
    </div>
</body>
</html>
"""



def is_valid_parent_email(value: str) -> bool:
    if not value:
        return False
    value = value.strip()
    if value.lower() in {"none provided", "not provided", "none", "na", "n/a"}:
        return False
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", value))


def _generate_pdf_with_timeout(html_content: str, pdf_path: Path, timeout_seconds: int) -> None:
    def _write_pdf() -> None:
        HTML(string=html_content, base_url=os.getcwd()).write_pdf(str(pdf_path))

    future = PDF_EXECUTOR.submit(_write_pdf)
    try:
        future.result(timeout=timeout_seconds)
    except FuturesTimeoutError as exc:
        logger.warning("PDF generation exceeded the configured timeout.")
        if pdf_path.exists():
            try:
                pdf_path.unlink()
            except OSError:
                pass
        raise TimeoutError("PDF generation timed out") from exc


def send_pdf_email(to_email: str, pdf_path: str, child_name: str) -> bool:
    """
    Sends the generated PDF to the parent email when SMTP environment variables are configured.

    Development-only behavior can disable email delivery by setting EMAIL_ENABLED=false.
    """
    config = _ensure_settings()
    logger.info("Email delivery started for a request.")

    if not config.email_enabled:
        logger.info("Email delivery disabled by configuration.")
        return False

    if not all([config.smtp_host, config.smtp_username, config.smtp_password, config.smtp_from_email]):
        raise RuntimeError("SMTP is not configured. Set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM_EMAIL.")

    recipient_email = config.alert_recipient_email or to_email
    msg = EmailMessage()
    msg["Subject"] = f"Child Safety Alert PDF - {child_name}"
    msg["From"] = formataddr((config.smtp_from_name, config.smtp_from_email))
    msg["To"] = recipient_email
    msg.set_content(
        f"Your Child: {child_name} Emergency Broadcast Pass PDF is attached.\n\n"
        "If this is an emergency, contact local emergency services immediately.\n\n"
        "This PDF is only a personal safety aid and is not a substitute for emergency services."
    )

    with open(pdf_path, "rb") as f:
        pdf_bytes = f.read()

    msg.add_attachment(
        pdf_bytes,
        maintype="application",
        subtype="pdf",
        filename="Emergency_Broadcast_Alert.pdf"
    )

    for attempt in range(2):
        try:
            previous_timeout = socket.getdefaulttimeout()
            socket.setdefaulttimeout(config.smtp_operation_timeout_seconds)
            try:
                with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=config.smtp_connect_timeout_seconds) as server:
                    server.starttls()
                    server.login(config.smtp_username, config.smtp_password)
                    server.send_message(msg)
                    logger.info("Email delivery completed for a request.")
                    return True
            finally:
                socket.setdefaulttimeout(previous_timeout)
        except smtplib.SMTPAuthenticationError as exc:
            logger.warning("Email delivery failed due to an SMTP authentication error.")
            raise RuntimeError("Email delivery failed due to an SMTP authentication error.") from exc
        except smtplib.SMTPRecipientsRefused as exc:
            logger.warning("Email delivery failed due to a recipient rejection.")
            raise RuntimeError("Email delivery failed for a request.") from exc
        except (socket.timeout, TimeoutError, ConnectionResetError, ConnectionRefusedError, OSError) as exc:
            if attempt == 0:
                logger.warning("SMTP connection timed out. Retrying email delivery.")
                time.sleep(1)
                continue
            logger.warning("Email delivery failed due to a transient SMTP error.")
            raise RuntimeError("Email delivery failed for a request.") from exc

@app.post("/api/v1/generate-pass", dependencies=[Security(verify_mobile_app)])
async def generate_pass(payload: MissingChildPayload, background_tasks: BackgroundTasks, request: Request):
    request_id = request.headers.get("X-Request-ID")
    logger.info("Generate-pass request received request_id=%s", request_id or "none")

    if request_id:
        existing_entry = await _get_idempotency_entry(request_id)
        if existing_entry and existing_entry.get("status") == "processing":
            raise HTTPException(status_code=409, detail="This alert request is already being processed.")
        if existing_entry and existing_entry.get("pdf_path"):
            temp_paths = existing_entry.get("temp_paths", [])
            return FileResponse(
                existing_entry["pdf_path"],
                media_type="application/pdf",
                filename="Emergency_Broadcast_Alert.pdf",
                headers={
                    "X-Email-Status": existing_entry.get("email_status", "not_requested"),
                    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0"
                },
                background=BackgroundTask(_cleanup_temp_paths, temp_paths)
            )

    config = _ensure_settings()
    temp_paths: list[Path] = []
    processing_entry_created = False
    completed_successfully = False

    try:
        encoded_photo = payload.compressed_photo or ""
        if "," in encoded_photo:
            encoded_photo = encoded_photo.split(",")[1]
        if not encoded_photo:
            raise HTTPException(status_code=400, detail="Corrupt image signature dataset passed.")

        try:
            img_data = base64.b64decode(encoded_photo, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(status_code=400, detail="Corrupt image signature dataset passed.") from exc

        max_request_size_bytes = MAX_REQUEST_SIZE_MB * 1024 * 1024
        if len(img_data) > max_request_size_bytes:
            raise HTTPException(status_code=413, detail="The photo could not be prepared for submission. Please take a new photo or choose another photo.")

        try:
            raw_img = Image.open(io.BytesIO(img_data))
            raw_img.load()
            raw_img = ImageOps.exif_transpose(raw_img)
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Corrupt image signature dataset passed.") from exc

        if raw_img.mode in {"RGBA", "LA", "P", "PA"}:
            raw_img = raw_img.convert("RGB")
        else:
            raw_img = raw_img.convert("RGB")

        max_long_edge = 2000
        width, height = raw_img.size
        if max(width, height) > max_long_edge:
            scale = max_long_edge / max(width, height)
            new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
            resampling = getattr(Image, "Resampling", Image).LANCZOS
            raw_img = raw_img.resize(new_size, resampling)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Invalid image payload encountered request_id=%s", request_id or "none")
        raise HTTPException(status_code=400, detail="Corrupt image signature dataset passed.") from exc

    if request_id:
        if not await _set_processing_idempotency_entry(request_id):
            raise HTTPException(status_code=409, detail="This alert request is already being processed.")
        processing_entry_created = True

    try:
        temp_dir = Path("temp_assets")
        temp_dir.mkdir(exist_ok=True)

        image_fd, image_temp_path = tempfile.mkstemp(prefix="img-", suffix=".png", dir=str(temp_dir))
        os.close(image_fd)
        photo_path = Path(image_temp_path)
        temp_paths.append(photo_path)

        raw_img.save(photo_path, format="JPEG", quality=85)

        html_content = Template(PDF_TEMPLATE).render(
            child_name=payload.child_name.title(), age_gender=payload.age_gender, 
            parent_name=payload.parent_name, reporting_agency=payload.reporting_agency, phone=payload.phone, alt_phone=payload.alt_phone, parent_email=payload.parent_email,
            venue=payload.full_address, shoes=payload.shoes, skin_tone=payload.skin_tone, eye_color=payload.eye_color,
            birth_marks=payload.birth_marks, clothing_desc=payload.clothing_desc,
            electronics=payload.electronics, pets_toys=payload.pets_toys,
            photo_context=payload.photo_context,
            date_last_seen=payload.date_last_seen, time_last_seen=payload.time_last_seen,
            image_path="file:///" + photo_path.as_posix().replace("\\", "/")
        )

        pdf_fd, pdf_temp_path = tempfile.mkstemp(prefix="pdf-", suffix=".pdf", dir=str(temp_dir))
        os.close(pdf_fd)
        pdf_path = Path(pdf_temp_path)
        temp_paths.append(pdf_path)

        try:
            _generate_pdf_with_timeout(
                html_content,
                pdf_path,
                config.pdf_generation_timeout_seconds,
            )
        except TimeoutError as exc:
            logger.warning("PDF generation exceeded the configured timeout.")
            raise HTTPException(status_code=504, detail="The alert document could not be generated in time. Please try again.") from exc

        email_status = "not_requested"
        if is_valid_parent_email(payload.parent_email):
            try:
                email_sent = await run_in_threadpool(send_pdf_email, payload.parent_email, str(pdf_path), payload.child_name.title())
                email_status = "sent" if email_sent else "not_requested"
            except RuntimeError:
                logger.warning("Email delivery failed for a request.")
                email_status = "failed"
            except Exception:
                logger.warning("Email delivery failed for a request.")
                email_status = "failed"

        if request_id:
            await _store_idempotency_entry(request_id, {"pdf_path": str(pdf_path), "email_status": email_status, "temp_paths": temp_paths}, 200, {"X-Email-Status": email_status}, temp_paths=temp_paths)
            await _remove_processing_entry(request_id)

        completed_successfully = True
        return FileResponse(
            str(pdf_path),
            media_type="application/pdf",
            filename="Emergency_Broadcast_Alert.pdf",
            headers={
                "X-Email-Status": email_status,
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0"
            },
            background=BackgroundTask(_cleanup_temp_paths, temp_paths)
        )
    except asyncio.CancelledError:
        logger.warning("Request cancelled during processing request_id=%s", request_id or "none")
        raise
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Generate-pass processing failed request_id=%s", request_id or "none")
        raise HTTPException(status_code=500, detail="Unable to generate the alert at this time. Please try again.") from exc
    finally:
        if request_id and processing_entry_created and not completed_successfully:
            await _remove_processing_entry(request_id)
        _cleanup_temp_paths(temp_paths)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9000, reload=True)