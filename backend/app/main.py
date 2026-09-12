from pathlib import Path
import re
from uuid import uuid4

import cv2
import fitz
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader

app = FastAPI(title="InternVerify API", version="0.8.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

BASE_DIR = Path(__file__).resolve().parents[2]
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


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
        for index, page in enumerate(document):
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image = cv2.imdecode(__import__("numpy").frombuffer(pix.tobytes("png"), dtype="uint8"), cv2.IMREAD_COLOR)
            sources.extend(scan_image(image, detector, index + 1))
        document.close()
    elif content_type.startswith("image/"):
        image = cv2.imread(str(path))
        if image is not None:
            sources.extend(scan_image(image, detector))
    for url in extract_urls(text):
        if not any(item["url"] == url for item in sources):
            sources.append({"source_type": "link", "url": url, "page": None})
    return sources


def first_match(patterns: list[str], text: str) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            value = re.sub(r"\s+", " ", match.group(1)).strip(" :.-\t\n").rstrip(".,;")
            if value:
                return value
    return None


def extract_certificate_fields(text: str) -> dict[str, str | None]:
    return {
        "student_name": first_match([r"(?:student|intern|trainee)\s*(?:name)?\s*[:\-]\s*([^\n]+)", r"(?:awarded|presented|issued)\s+to\s*[:\-]?\s*([^\n]+)"], text),
        "company_name": first_match([r"(?:company|organization|organisation|employer)\s*(?:name)?\s*[:\-]\s*([^\n]+)", r"(?:internship|training|program)\s+(?:at|with)\s+([A-Z][A-Za-z0-9 &'.,-]{2,100})"], text),
        "certificate_number": first_match([r"(?:certificate|certification)\s*(?:no|number|id)\s*[:#\-]\s*([A-Za-z0-9./_-]+)"], text),
    }


def locate_file(certificate_id: str) -> Path:
    matches = list(UPLOAD_DIR.glob(f"{certificate_id}_*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Certificate not found")
    return matches[0]


def classify_verification(response: httpx.Response) -> tuple[str, str]:
    if not response.is_success:
        return "verification_failed", f"Verification page returned HTTP {response.status_code}."
    body = response.text.lower()
    positive_markers = ("certificate is valid", "certificate verified", "verification successful", "credential verified", "valid certificate")
    negative_markers = ("certificate not found", "invalid certificate", "verification failed", "invalid credential", "does not exist")
    if any(marker in body for marker in negative_markers):
        return "verification_failed", "The verification page indicates that the certificate is invalid or was not found."
    if any(marker in body for marker in positive_markers):
        return "verified", "The verification page contains a positive certificate-verification result."
    return "verification_unavailable", "The verification page was reachable, but no clear verification result was detected."


@app.get("/health")
def health():
    return {"status": "ok", "service": "internverify-api"}


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
            extraction_note = "PDF text extracted successfully." if text else "No selectable PDF text found. QR scanning was still attempted."
        except Exception as exc:
            extraction_note = f"Text extraction failed: {type(exc).__name__}. QR scanning was still attempted."
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
        "extracted_fields": extract_certificate_fields(text) if text else {},
    }


@app.post("/api/certificates/{certificate_id}/verify")
async def verify_certificate(certificate_id: str):
    path = locate_file(certificate_id)
    content_type = "application/pdf" if path.suffix.lower() == ".pdf" else "image/unknown"
    text = extract_pdf_text(path) if content_type == "application/pdf" else ""
    sources = detect_verification_sources(path, content_type, text)
    if not sources:
        return {"status": "no_verification_source", "message": "No QR code or verification link was found."}
    results = []
    async with httpx.AsyncClient(follow_redirects=True, timeout=15, headers={"User-Agent": "InternVerify/0.8"}) as client:
        for source in sources:
            try:
                response = await client.get(source["url"])
                status, message = classify_verification(response)
                results.append({**source, "http_status": response.status_code, "reachable": response.is_success, "status": status, "message": message})
            except httpx.HTTPError as exc:
                results.append({**source, "reachable": False, "status": "verification_unavailable", "message": f"Could not access verification page: {type(exc).__name__}."})
    if any(item["status"] == "verified" for item in results):
        overall_status = "verified"
    elif any(item["status"] == "verification_failed" for item in results):
        overall_status = "verification_failed"
    else:
        overall_status = "verification_unavailable"
    return {"status": overall_status, "message": "Verification completed for detected sources.", "verification_results": results}
