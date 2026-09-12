from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="InternVerify API", version="0.2.0")

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

    return {
        "certificate_id": certificate_id,
        "filename": original_name,
        "stored_filename": stored_name,
        "content_type": file.content_type or "application/octet-stream",
        "size_bytes": len(contents),
        "status": "received",
        "next_step": "text_extraction_pending",
    }
