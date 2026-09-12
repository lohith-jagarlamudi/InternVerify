from pathlib import Path
import re
from uuid import uuid4

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader

app = FastAPI(title="InternVerify API", version="0.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parents[2]
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def extract_pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join((page.extract_text() or "") for page in reader.pages).strip()


def clean_value(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip(" :.-\t\n")
    return value.rstrip(".,;")


def first_match(patterns: list[str], text: str) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            value = clean_value(match.group(1))
            if value:
                return value
    return None


def extract_certificate_fields(text: str) -> dict[str, str | None]:
    normalized = re.sub(r"[ \t]+", " ", text)
    return {
        "student_name": first_match([
            r"(?:student|intern|trainee)\s*(?:name)?\s*[:\-]\s*([^\n]+)",
            r"(?:certify|certifies)\s+that\s+([A-Z][A-Za-z .'-]{2,80}?)(?:\s+(?:has|had|successfully|completed|participated)\b)",
            r"(?:awarded|presented|issued)\s+to\s*[:\-]?\s*([^\n]+)",
        ], normalized),
        "company_name": first_match([
            r"(?:company|organization|organisation|employer|host company)\s*(?:name)?\s*[:\-]\s*([^\n]+)",
            r"(?:internship|training|program)\s+(?:at|with)\s+([A-Z][A-Za-z0-9 &'.,-]{2,100})",
            r"(?:issued|provided|offered)\s+by\s*[:\-]?\s*([^\n]+)",
        ], normalized),
        "internship_role": first_match([
            r"(?:role|designation|position|domain|area|department)\s*[:\-]\s*([^\n]+)",
            r"(?:worked|served|interned)\s+as\s+([^\n]+)",
        ], normalized),
        "start_date": first_match([
            r"(?:start|from|commencement|beginning)\s*date?\s*[:\-]\s*([^\n]+)",
            r"(?:from)\s+([0-3]?\d[/-][01]?\d[/-](?:20)?\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})",
        ], normalized),
        "end_date": first_match([
            r"(?:end|to|completion|conclusion)\s*date?\s*[:\-]\s*([^\n]+)",
            r"(?:to|until)\s+([0-3]?\d[/-][01]?\d[/-](?:20)?\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})",
        ], normalized),
        "certificate_number": first_match([
            r"(?:certificate|certification)\s*(?:no|number|id)\s*[:#\-]\s*([A-Za-z0-9./_-]+)",
            r"(?:credential|verification)\s*(?:no|number|id)\s*[:#\-]\s*([A-Za-z0-9./_-]+)",
        ], normalized),
        "verification_url": first_match([
            r"(https?://[^\s)<>]+)",
        ], normalized),
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "internverify-api"}


@app.post("/api/certificates/upload")
async def upload_certificate(file: UploadFile = File(...)) -> dict:
    original_name = file.filename or "unknown"
    certificate_id = str(uuid4())
    safe_name = Path(original_name).name
    stored_name = f"{certificate_id}_{safe_name}"
    destination = UPLOAD_DIR / stored_name

    contents = await file.read()
    destination.write_bytes(contents)

    extracted_text = ""
    extraction_status = "text_extraction_pending"
    extraction_note = "Text extraction is currently supported for text-based PDF files."
    extracted_fields: dict[str, str | None] = {}

    if (file.content_type or "").lower() == "application/pdf":
        try:
            extracted_text = extract_pdf_text(destination)
            extraction_status = "text_extraction_completed"
            extraction_note = "PDF text extracted successfully." if extracted_text else "PDF contains no selectable text; OCR may be needed."
            extracted_fields = extract_certificate_fields(extracted_text) if extracted_text else {}
        except Exception as exc:
            extraction_status = "text_extraction_failed"
            extraction_note = f"Could not extract PDF text: {type(exc).__name__}"
    elif (file.content_type or "").startswith("image/"):
        extraction_note = "Image OCR will be added in a later milestone."

    important_fields = ["student_name", "company_name", "start_date", "end_date"]
    missing_fields = [name for name in important_fields if not extracted_fields.get(name)]
    review_status = "needs_review" if missing_fields else "ready_for_verification"

    return {
        "certificate_id": certificate_id,
        "filename": original_name,
        "stored_filename": stored_name,
        "content_type": file.content_type or "application/octet-stream",
        "size_bytes": len(contents),
        "status": review_status,
        "next_step": extraction_status,
        "extraction_note": extraction_note,
        "text_preview": extracted_text[:2000],
        "extracted_fields": extracted_fields,
        "missing_fields": missing_fields,
    }
