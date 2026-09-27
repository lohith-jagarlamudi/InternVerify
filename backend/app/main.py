from pathlib import Path
import re
from uuid import uuid4

import cv2
import fitz
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader

app = FastAPI(title="InternVerify API", version="1.0.0")
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

IGNORED_FIELD_KEYS = {"issue_date"}

UNAVAILABLE_MARKERS = {
    "",
    "n/a",
    "na",
    "none",
    "null",
    "unknown",
    "not found",
    "not detected",
    "missing",
    "not available",
    "unavailable",
    "insufficient data",
    "insufficient data to compare",
    "not enough data",
    "not enough data to compare",
    "not enough information to compare",
    "not enough information",
    "data not available",
}

def extract_pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join((page.extract_text() or "") for page in reader.pages).strip()

def clean_url(value: str) -> str:
    return value.rstrip(".,;)]}>")

def extract_urls(text: str) -> list[str]:
    return list(dict.fromkeys(clean_url(x) for x in re.findall(r"https?://[^\s<>\"']+", text)))

def scan_image(image, detector, page_number: int | None = None) -> list[dict]:
    found = []
    try:
        data, _, _ = detector.detectAndDecode(image)
        if data and data.startswith(("http://", "https://")):
            found.append({"source_type": "qr", "url": clean_url(data), "page": page_number})
    except Exception:
        pass
    return found

def detect_verification_sources(path: Path, content_type: str, text: str) -> list[dict]:
    detector = cv2.QRCodeDetector()
    sources = []
    if content_type == "application/pdf":
        document = fitz.open(str(path))
        try:
            for index, page in enumerate(document):
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                image = cv2.imdecode(
                    __import__("numpy").frombuffer(pix.tobytes("png"), dtype="uint8"),
                    cv2.IMREAD_COLOR,
                )
                sources.extend(scan_image(image, detector, index + 1))
        finally:
            document.close()
    elif content_type.startswith("image/"):
        image = cv2.imread(str(path))
        if image is not None:
            sources.extend(scan_image(image, detector))
    for url in extract_urls(text):
        if not any(item["url"] == url for item in sources):
            sources.append({"source_type": "link", "url": url, "page": None})
    return sources

def normalise_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()

def is_unavailable(value: object) -> bool:
    text = normalise_text(value).casefold()
    if not text:
        return True
    compact = re.sub(r"[^a-z0-9]+", " ", text).strip()
    if compact in UNAVAILABLE_MARKERS:
        return True
    return any(
        phrase in text
        for phrase in (
            "not enough data to compare",
            "not enough information to compare",
            "insufficient data to compare",
        )
    )

def first_match(patterns: list[str], text: str) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            value = re.sub(r"\s+", " ", match.group(1)).strip(" :.-\t\n").rstrip(".,;")
            if value and not is_unavailable(value):
                return value
    return None

def extract_certificate_fields(text: str) -> dict[str, str | None]:
    return {
        "student_name": first_match(
            [
                r"(?:student|intern|trainee)\s*(?:name)?\s*[:\-]\s*([^\n]+)",
                r"(?:awarded|presented|issued)\s+to\s*[:\-]?\s*([^\n]+)",
            ],
            text,
        ),
        "company_name": first_match(
            [
                r"(?:company|organization|organisation|employer)\s*(?:name)?\s*[:\-]\s*([^\n]+)",
                r"(?:internship|training|program)\s+(?:at|with)\s+([A-Z][A-Za-z0-9 &'.,-]{2,100})",
            ],
            text,
        ),
        "certificate_number": first_match(
            [r"(?:certificate|certification)\s*(?:no|number|id)\s*[:#\-]\s*([A-Za-z0-9./_-]+)"],
            text,
        ),
    }

def compare_mapped_fields(uploaded: dict, browser: dict) -> dict:
    labels = {
        "student_name": "Student name",
        "company_name": "Company name",
        "internship_role": "Internship role",
        "start_date": "Start date",
        "end_date": "End date",
        "certificate_number": "Certificate number",
        "duration": "Duration",
    }
    items = []
    for key, label in labels.items():
        left = uploaded.get(key)
        right = browser.get(key)
        left_missing = is_unavailable(left)
        right_missing = is_unavailable(right)
        if left_missing and right_missing:
            state = "ignored"
            matched = None
        elif left_missing or right_missing:
            state = "needs_review"
            matched = None
        else:
            matched = normalise_text(left).casefold() == normalise_text(right).casefold()
            state = "matched" if matched else "mismatch"
        items.append({
            "field": key,
            "label": label,
            "uploaded": left,
            "verification_page": right,
            "matched": matched,
            "state": state,
        })

    mismatches = [x for x in items if x["state"] == "mismatch"]
    one_sided = [x for x in items if x["state"] == "needs_review"]
    comparable = [x for x in items if x["state"] == "matched" or x["state"] == "mismatch"]

    if mismatches:
        status = "not_verified"
        reason = "At least one mapped field differs on both sides."
    elif one_sided:
        status = "needs_review"
        reason = "A mapped field is present on only one side."
    elif comparable:
        status = "verified"
        reason = "All available mapped fields matched."
    else:
        status = "ignored"
        reason = "No comparable mapped fields were available."

    return {
        "status": status,
        "reason": reason,
        "items": items,
        "matched": sum(x["state"] == "matched" for x in items),
        "compared": len(comparable),
        "mismatches": len(mismatches),
        "needs_review_fields": len(one_sided),
    }

def locate_file(certificate_id: str) -> Path:
    matches = list(UPLOAD_DIR.glob(f"{certificate_id}_*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Certificate not found")
    return matches[0]

def extract_page_title(html: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    title = re.sub(r"<[^>]+>", " ", match.group(1))
    title = re.sub(r"\s+", " ", title).strip()
    return title[:300] or None

def classify_verification(response: httpx.Response) -> tuple[str, str]:
    if not response.is_success:
        return "verification_failed", f"Verification page returned HTTP {response.status_code}."
    body = response.text.lower()
    negative_markers = (
        "certificate not found",
        "certificate does not exist",
        "invalid certificate",
        "verification failed",
        "invalid credential",
        "credential not found",
        "record not found",
        "no record found",
        "verification unsuccessful",
    )
    if any(marker in body for marker in negative_markers):
        return "verification_failed", "The verification page indicates that the certificate is invalid or was not found."
    return "verification_unavailable", "The page was reachable, but field-level verification determines the final result."

@app.get("/health")
def health():
    return {"status": "ok", "service": "internverify-api", "version": "1.0.0"}

@app.post("/api/certificates/upload")
async def upload_certificate(file: UploadFile = File(...)):
    original_name = file.filename or "unknown"
    certificate_id = str(uuid4())
    stored_name = f"{certificate_id}_{Path(original_name).name}"
    destination = UPLOAD_DIR / stored_name
    contents = await file.read()
    destination.write_bytes(contents)
    content_type = (file.content_type or "application/octet-stream").lower()
    text = ""
    extraction_note = ""
    if content_type == "application/pdf":
        try:
            text = extract_pdf_text(destination)
            extraction_note = "PDF text extracted successfully." if text else "No selectable PDF text found."
        except Exception as exc:
            extraction_note = f"Text extraction failed: {type(exc).__name__}."
    sources = detect_verification_sources(destination, content_type, text)
    return {
        "certificate_id": certificate_id,
        "filename": original_name,
        "stored_filename": stored_name,
        "content_type": content_type,
        "size_bytes": len(contents),
        "status": "verification_source_found" if sources else "no_verification_source",
        "next_step": "verify_certificate" if sources else "manual_source_check",
        "extraction_note": extraction_note,
        "verification_sources": sources,
        "text_preview": text[:2000],
        "full_text": text,
        "extracted_fields": extract_certificate_fields(text) if text else {},
    }

@app.post("/api/certificates/{certificate_id}/verify")
async def verify_certificate(certificate_id: str):
    path = locate_file(certificate_id)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        content_type = "application/pdf"
        text = extract_pdf_text(path)
    else:
        content_type = "image/unknown"
        text = ""
    uploaded_fields = extract_certificate_fields(text)

    sources = detect_verification_sources(path, content_type, text)
    if not sources:
        return {
            "status": "needs_review",
            "message": "No QR code or verification link was found.",
            "comparison": None,
            "verification_results": [],
        }

    results = []
    browser_fields: dict[str, str | None] = {}
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=15,
        headers={"User-Agent": "InternVerify/1.0"},
    ) as client:
        for source in sources[:1]:
            try:
                response = await client.get(source["url"])
                page_text = response.text
                source_status, message = classify_verification(response)
                browser_fields = extract_certificate_fields(
                    re.sub(r"<[^>]+>", "\n", page_text)
                )
                results.append({
                    **source,
                    "http_status": response.status_code,
                    "final_url": str(response.url),
                    "page_title": extract_page_title(page_text),
                    "reachable": response.is_success,
                    "status": source_status,
                    "message": message,
                    "extracted_fields": browser_fields,
                })
            except httpx.HTTPError as exc:
                results.append({
                    **source,
                    "reachable": False,
                    "status": "verification_unavailable",
                    "message": f"Could not access verification page: {type(exc).__name__}.",
                    "extracted_fields": {},
                })

    comparison = compare_mapped_fields(uploaded_fields, browser_fields)
    return {
        "status": comparison["status"],
        "message": comparison["reason"],
        "comparison": comparison,
        "uploaded_fields": uploaded_fields,
        "verification_page_fields": browser_fields,
        "verification_results": results,
    }
