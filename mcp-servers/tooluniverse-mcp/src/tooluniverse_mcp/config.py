"""Configuration for tooluniverse-mcp."""

import os

# ToolUniverse categories to load.
# Maps to TU's built-in category names. Run tu.list_built_in_tools() to verify.
CATEGORIES = [
    "UniProt",
    "AlphaFold",
    "ChEMBL",
    "PubChem",
    "FDA_Drug_Label",
    "KEGG",
    "REACTOME",
    "Semantic_Scholar",
    "ClinVar",
    "Clinical_Trials",
    "OMIM",
]

# Override via TU_CATEGORIES env var (comma-separated)
_env_categories = os.environ.get("TU_CATEGORIES")
if _env_categories:
    CATEGORIES = [c.strip() for c in _env_categories.split(",") if c.strip()]

# Courtesy delays between calls to the same upstream service (seconds).
RATE_LIMITS: dict[str, float] = {
    "UniProt": 0.5,
    "AlphaFold": 0.5,
    "ChEMBL": 0.5,
    "PubChem": 0.5,
    "FDA": 1.0,
    "KEGG": 1.0,
    "REACTOME": 0.5,
    "Semantic_Scholar": 0.5,
    "ClinVar": 0.35,
    "Clinical_Trials": 0.5,
    "OMIM": 0.5,
}
