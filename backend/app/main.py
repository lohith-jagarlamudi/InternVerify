from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="InternVerify API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "internverify-api"}


@app.post("/api/certificates/upload")
async def upload_certificate(file: UploadFile = File(...)) -> dict[str, str]:
    # Initial vertical slice: validate receipt only.
    # Text extraction and verification will be added next.
    return {
        "filename": file.filename or "unknown",
        "content_type": file.content_type or "application/octet-stream",
        "status": "received",
    }
