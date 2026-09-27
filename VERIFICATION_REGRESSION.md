# Verification regression rules

This build keeps the field-level rules stable and fixes recipient-name extraction.

## Status rules

- Both sides unavailable for a mapped field: ignore that field and continue.
- One side has a real mapped value and the other side is unavailable: **Needs Review**.
- Both sides have real mapped values and they match: field matched.
- Both sides have real mapped values and they differ: **Not Verified**.
- At least one comparable field matches and there are no mismatches or one-sided fields: **Verified**.
- No comparable mapped fields: **Ignore**.
- `issue_date` is not a verification field.
- Browser HTTP/status text never overrides field comparison.
- QR/certificate ID selects the verification page but never overrides a name mismatch or one-sided missing field.

## Recipient extraction fix

Recipient names are extracted structurally from phrases such as:

- `This is to certify that`
- `This certificate has been issued to`
- `Issued to`
- `Awarded to`
- `Presented to`

The extractor stops before common sentence continuations such as `for`, `has`, `successfully`, `completed`, `on`, and `in`. Single-word names such as `Daniels` are valid.
