from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader

app = FastAPI(title="InternVerify API", version="0.3.0")

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
    pages = [(page.extract_text() or "") for page in reader.pages]
    return "\n".join(pages).strip()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "internverify-api"}


@app.post("/api/certificates/upload")
async def upload_certificate(file: UploadFile = File(...)) -> dict[str, str | int]:
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

    if (file.content_type or "").lower() == "application/pdf":
        try:
            extracted_text = extract_pdf_text(destination)
            extraction_status = "text_extraction_completed"
            extraction_note = "PDF text extracted successfully." if extracted_text else "PDF contains no selectable text; OCR may be needed."
        except Exception as exc:
            extraction_status = "text_extraction_failed"
            extraction_note = f"Could not extract PDF text: {type(exc).__name__}"
    elif (file.content_type or "").startswith("image/"):
        extraction_note = "Image OCR will be added in a later milestone."

    return {
        "certificate_id": certificate_id,
        "filename": original_name,
        "stored_filename": stored_name,
        "content_type": file.content_type or "application/octet-stream",
        "size_bytes": len(contents),
        "status": "received",
        "next_step": extraction_status,
        "extraction_note": extraction_note,
        "text_preview": extracted_text[:2000],
    }
