import os
import io
import time
import base64
import re
import secrets
import smtplib
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Security, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware 
from fastapi.security.api_key import APIKeyHeader
from fastapi.responses import FileResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator
from PIL import Image, ImageOps
from jinja2 import Template
from cryptography.fernet import Fernet
from email.message import EmailMessage
from email.utils import formataddr
from dotenv import load_dotenv
from weasyprint import HTML
load_dotenv()


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
            print(f"Janitor logging exception: {e}")
        await asyncio.sleep(3600)

@asynccontextmanager
async def lifespan(app: FastAPI):
    janitor_task = asyncio.create_task(file_cleanup_janitor())
    yield
    janitor_task.cancel()

app = FastAPI(title="SecurePass Enterprise Engine", lifespan=lifespan, redirect_slashes=False)
from fastapi.middleware.cors import CORSMiddleware

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

def secure_delete_file(file_path: str):
    """Best-effort cleanup for sensitive temporary image/PDF files."""
    try:
        if os.path.exists(file_path) and os.path.isfile(file_path):
            file_size = os.path.getsize(file_path)
            if file_size > 0:
                with open(file_path, "wb") as f:
                    f.write(os.urandom(file_size))
            os.remove(file_path)
            print(f"Temporary file deleted: {file_path}")
    except Exception as e:
        print(f"Secure delete failed for {file_path}: {e}")

API_KEY_NAME = "X-SecurePass-Token"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)
MOBILE_APP_SECRET = "SP_ENTERPRISE_NATIVE_SECRET_TOKEN_XYZ123"

async def verify_mobile_app(api_key: str = Depends(api_key_header)):
    if not api_key or api_key != MOBILE_APP_SECRET:
        raise HTTPException(status_code=403, detail="Access Denied: Unauthenticated Application Request.")
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
                     'full_address', 'shoes', 'skin_tone', 'eye_color', 'birth_marks', 
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
    .alert-box { border: 4px dashed #d9534f; padding: 20px; min-height: 850px; position: relative; }
    .banner { background: #d9534f; color: white; padding: 12px; margin: 15px 0; font-weight: bold; text-align: center; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; }
    p { font-size: 15px; margin: 6px 0; line-height: 1.3; }
    h1 { color: #d9534f; font-size: 34px; text-align: center; margin: 0 0 5px 0; font-weight: bold; }
    h4 { color: #0275d8; margin: 15px 0 8px 0; border-bottom: 2px solid #eee; padding-bottom: 3px; font-size: 16px; text-transform: uppercase; }
    .highlight-container { margin-top: 15px; border-left: 4px solid #5cb85c; padding-left: 15px; background: #f9f9f9; padding-top: 2px; padding-bottom: 2px; }
</style>
</head>
<body>
    <div class="alert-box">
        <h1>MISSING CHILD ALERT</h1>
        <div class="banner">
            LAST SEEN LOCATION: {{ venue }}<br>
            TIMESTAMP: {{ timestamp }}
        </div>
        <table>
            <tr>
                <td style="width: 42%;"><img src="{{ image_path }}" style="width: 100%; max-height: 420px; object-fit: contain; border: 3px solid #d9534f;"><p><strong>Photo Context:</strong> {{ photo_context }}</p></td>
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
                    <div style="margin-top: 10px; padding: 8px; background: #fff3cd; border: 1px solid #ffeeba;">
                        <p style="margin: 0;"><strong>Reporting Agency</strong><br> {{ reporting_agency }}</p>
                    </div>
                </td>
            </tr>
        </table>

        <div class="highlight-container">
            <h4>Current Attire Profile</h4>
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

        <div style="position: absolute; bottom: 15px; left: 20px; right: 20px; border-top: 3px solid #d9534f; padding-top: 12px; text-align: center;">
            <p style="font-size: 14px; font-weight: bold; color: #d9534f; text-transform: uppercase; margin: 0 0 4px 0; letter-spacing: 0.5px;">
                IF YOU HAVE INFORMATION CONCERNING THIS CHILD, IMMEDIATELY CALL LOCAL EMERGENCY SERVICES OR THE REPORTING AGENCY NOTED ABOVE.
            </p>
            <p style="font-size: 11px; color: #555555; line-height: 1.4; font-style: italic; margin: 0;">
                Do not take independent action. All sightings, tips, and active coordinate updates must be reported 
                directly to regional emergency response authorities or the <strong>reporting agency noted above</strong>.
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


def send_pdf_email(to_email: str, pdf_path: str, child_name: str) -> None:
    """
    Sends the generated PDF to the parent email when SMTP environment variables are configured.

    Required environment variables for real email sending:
      SMTP_HOST=smtp.sendgrid.net or smtp.gmail.com
      SMTP_PORT=587
      SMTP_USERNAME=your smtp username
      SMTP_PASSWORD=your smtp password or app password
      SMTP_FROM_EMAIL=verified sender email
      SMTP_FROM_NAME=SecurePass Child Safety

    For SendGrid SMTP:
      SMTP_USERNAME=apikey
      SMTP_PASSWORD=<your SendGrid API key>
    """
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_username = os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD")
    from_email = os.getenv("SMTP_FROM_EMAIL")
    from_name = os.getenv("SMTP_FROM_NAME", "SecurePass Child Safety")
    print("=" * 50)
    print(f"SMTP Host: {smtp_host}")
    print(f"SMTP Username: {smtp_username}")
    print(f"From Email: {from_email}")
    print(f"Sending To: {to_email}")
    print("=" * 50)

    if not all([smtp_host, smtp_username, smtp_password, from_email]):
        raise RuntimeError("SMTP is not configured. Set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM_EMAIL.")

    msg = EmailMessage()
    msg["Subject"] = f"Child Safety Alert PDF - {child_name}"
    msg["From"] = formataddr((from_name, from_email))
    msg["To"] = to_email
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

    with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(msg)
        print(f"EMAIL SENT SUCCESSFULLY TO: {to_email}")

@app.post("/api/v1/generate-pass", dependencies=[Security(verify_mobile_app)])
async def generate_pass(payload: MissingChildPayload, background_tasks: BackgroundTasks):
    print("=" * 50)
    print("REQUEST RECEIVED: /api/v1/generate-pass")
    print("Sensitive child/parent details intentionally not logged.")
    print("=" * 50)
    try:
        encoded_photo = payload.compressed_photo
        if "," in encoded_photo:
            encoded_photo = encoded_photo.split(",")[1]
        img_data = base64.b64decode(encoded_photo)

        # Limit upload size to reduce abuse and avoid large temporary sensitive files.
        if len(img_data) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Uploaded image is too large. Please use a smaller image.")

        raw_img = Image.open(io.BytesIO(img_data))
        raw_img.verify()
        raw_img = Image.open(io.BytesIO(img_data)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Corrupt image signature dataset passed.")

    os.makedirs("temp_assets", exist_ok=True)
    random_token = secrets.token_hex(16)
    path = os.path.abspath(f"temp_assets/{random_token}.png")
    
    raw_img = ImageOps.exif_transpose(raw_img)
    raw_img.save(path)
    
    local_time_string = time.strftime('%I:%M %p Local')
    utc_time_string = time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())
    combined_timestamp = f"{local_time_string} ({utc_time_string})"

    html_content = Template(PDF_TEMPLATE).render(
        child_name=payload.child_name.title(), age_gender=payload.age_gender, 
        parent_name=payload.parent_name, reporting_agency=payload.reporting_agency, phone=payload.phone, alt_phone=payload.alt_phone, parent_email=payload.parent_email,
        venue=payload.full_address, shoes=payload.shoes, skin_tone=payload.skin_tone, eye_color=payload.eye_color,
        birth_marks=payload.birth_marks, clothing_desc=payload.clothing_desc,
        electronics=payload.electronics, pets_toys=payload.pets_toys,
        photo_context=payload.photo_context,
        timestamp=combined_timestamp, image_path="file:///" + path.replace("\\", "/")
    )
    
    pdf_path = path.replace(".png", ".pdf")

    await run_in_threadpool(
        HTML(string=html_content, base_url=os.getcwd()).write_pdf,
        pdf_path
    )
    
    email_status = "not_requested"
    if is_valid_parent_email(payload.parent_email):
        try:
            await run_in_threadpool(send_pdf_email, payload.parent_email, pdf_path, payload.child_name.title())
            email_status = "sent"
        except Exception as email_error:
            print(f"Email sending failed: {email_error}")
            email_status = "failed"

    # Delete temporary sensitive files after the response has been sent.
    # This is safer than keeping encrypted copies because the app does not need to retain child data.
    background_tasks.add_task(secure_delete_file, path)
    background_tasks.add_task(secure_delete_file, pdf_path)

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename="Emergency_Broadcast_Alert.pdf",
        headers={
            "X-Email-Status": email_status,
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0"
        },
        background=background_tasks
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9000, reload=True)