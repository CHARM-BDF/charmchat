"""Configuration for tooluniverse-mcp."""

# Tools to expose via MCP. Set to None to expose all tools.
CURATED_TOOLS: set[str] | None = {
    # Protein
    "UniProt_get_entry_by_accession",
    "UniProt_get_function_by_accession",
    "UniProt_get_sequence_by_accession",
    "UniProt_search",
    "alphafold_get_prediction",
    # Compound
    "ChEMBL_search_molecules",
    "ChEMBL_get_molecule",
    "ChEMBL_get_molecule_targets",
    "ChEMBL_get_drug",
    "PubChem_get_compound_properties_by_CID",
    "PubChem_get_CID_by_compound_name",
    # Pathway
    "kegg_get_pathway_info",
    "kegg_search_pathway",
    "ReactomeAnalysis_pathway_enrichment",
    "Reactome_get_pathway",
    # Literature
    "SemanticScholar_search",
    "SemanticScholar_get_paper",
    # Clinical
    "clinvar_get_clinical_significance",
    "clinvar_search_variants",
    "search_clinical_trials",
    "OMIM_search",
    "OMIM_get_entry",
    # Discovery
    "Tool_Finder_Keyword",
}

# Courtesy delays between calls to the same upstream service (seconds).
# Keyed by prefix of TU tool name (before first underscore).
RATE_LIMITS: dict[str, float] = {
    "UniProt": 0.5,
    "alphafold": 0.5,
    "ChEMBL": 0.5,
    "PubChem": 0.5,
    "kegg": 1.0,
    "Reactome": 0.5,
    "SemanticScholar": 0.5,
    "clinvar": 0.35,
    "search_clinical": 0.5,
    "OMIM": 0.5,
}
