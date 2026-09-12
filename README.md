# InternVerify

Internship certificate verification platform for college faculty.

## Planned workflow

1. Upload internship certificates as PDF or images.
2. Extract student, company, role, dates, certificate ID, and verification URL.
3. Decode QR codes when present.
4. Fetch issuer verification pages when technically possible.
5. Compare certificate details with issuer-side details.
6. Produce statuses such as Verified, Mismatch, Manual review, and Could not verify.

## Initial architecture

- `backend/`: FastAPI service for uploads, extraction, verification, and reporting.
- `frontend/`: React + Vite user interface.
- SQLite for local development; PostgreSQL can be introduced later.

## Development principles

- Never trust arbitrary verification URLs.
- Apply URL allowlists/configuration, timeouts, redirect limits, and response-size limits.
- Treat CAPTCHA-protected or JavaScript-heavy portals as manual-review cases initially.
- Keep an audit trail of extracted data, source URLs, comparison results, and reviewer decisions.
