"""Configuration for tooluniverse-mcp."""

# Courtesy delays between calls to the same upstream service (seconds).
RATE_LIMITS: dict[str, float] = {
    "UniProt": 0.5,
    "AlphaFold": 0.5,
    "ChEMBL": 0.5,
    "PubChem": 0.5,
    "FDA": 1.0,
    "KEGG": 1.0,
    "Reactome": 0.5,
    "SemanticScholar": 0.5,
    "ClinVar": 0.35,
    "ClinicalTrials": 0.5,
    "OMIM": 0.5,
}
