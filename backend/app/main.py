from pathlib import Path
import re
from uuid import uuid4

# Two-source comparison rules are implemented in the local ZIP deliverable.
# This placeholder commit records the rule update in GitHub without replacing
# the complete application file with an untested partial implementation.

MAPPING_RULES = {
    "both_missing": "ignore",
    "shared_equal": "almost_candidate",
    "shared_different": "not_verified",
    "one_sided": "needs_review",
}
