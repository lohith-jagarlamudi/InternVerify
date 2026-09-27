# Verification rules

- Both sides unavailable: ignore the field.
- One-sided missing mapped field: needs_review.
- Both available and equal: matched.
- Both available and different: not_verified.
- If all comparable mapped fields match with no one-sided fields: verified.
- issue_date is excluded from verification.
- QR/verification URL is a source locator only and cannot override field mismatches.
