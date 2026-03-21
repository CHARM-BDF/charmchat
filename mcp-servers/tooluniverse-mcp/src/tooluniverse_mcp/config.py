"""Configuration for tooluniverse-mcp."""

# Tools to expose via MCP. Set to None to expose all 2000+ tools.
CURATED_TOOLS: set[str] | None = {
    # --- Protein (UniProt, AlphaFold) ---
    "UniProt_get_entry_by_accession",
    "UniProt_get_function_by_accession",
    "UniProt_get_sequence_by_accession",
    "UniProt_search",
    "alphafold_get_prediction",

    # --- Compound / Drug (ChEMBL, PubChem, DrugBank) ---
    "ChEMBL_search_molecules",
    "ChEMBL_get_molecule",
    "ChEMBL_get_molecule_targets",
    "ChEMBL_get_drug",
    "PubChem_get_compound_properties_by_CID",
    "PubChem_get_CID_by_compound_name",
    "drugbank_full_search",
    "drugbank_get_drug_basic_info_by_drug_name_or_id",
    "drugbank_get_targets_by_drug_name_or_drugbank_id",

    # --- Drug discovery / Target validation (Open Targets) ---
    "OpenTargets_get_target_id_description_by_name",
    "OpenTargets_get_disease_id_description_by_name",
    "OpenTargets_get_drug_id_description_by_name",
    "OpenTargets_get_associated_targets_by_disease_efoId",
    "OpenTargets_get_associated_drugs_by_disease_efoId",
    "OpenTargets_get_associated_drugs_by_target_ensemblID",
    "OpenTargets_get_evidence_by_datasource",
    "OpenTargets_get_target_tractability_by_ensemblID",
    "OpenTargets_get_target_safety_profile_by_ensemblID",
    "OpenTargets_get_variant_info",
    "OpenTargets_search_gwas_studies_by_disease",

    # --- Pathway (KEGG, Reactome) ---
    "kegg_get_pathway_info",
    "kegg_search_pathway",
    "ReactomeAnalysis_pathway_enrichment",
    "Reactome_get_pathway",

    # --- Literature (Semantic Scholar) ---
    "SemanticScholar_search_papers",
    "SemanticScholar_get_paper",

    # --- Clinical (ClinVar, ClinicalTrials, OMIM) ---
    "clinvar_get_clinical_significance",
    "clinvar_search_variants",
    "search_clinical_trials",
    "OMIM_search",
    "OMIM_get_entry",

    # --- Population genetics (gnomAD) ---
    "gnomad_get_gene",
    "gnomad_get_gene_constraints",
    "gnomad_get_variant",
    "gnomad_search_variants",

    # --- Tissue expression / eQTL (GTEx) ---
    "GTEx_get_expression_summary",
    "GTEx_get_median_gene_expression",
    "GTEx_query_eqtl",

    # --- Gene-disease associations (DisGeNET) ---
    "DisGeNET_search_gene",
    "DisGeNET_search_disease",

    # --- Protein structure (RCSB PDB) ---
    "RCSBGraphQL_get_structure_summary",
    "RCSBAdvSearch_search_structures",
    "RCSBGraphQL_get_ligand_info",

    # --- Protein interactions (STRING) ---
    "STRING_get_interaction_partners",
    "STRING_get_network",
    "STRING_functional_enrichment",

    # --- Gene / Variant annotation (Ensembl, VEP) ---
    "Ensembl_lookup_gene_by_symbol",
    "EnsemblVEP_annotate_hgvs",
    "EnsemblVEP_annotate_rsid",
    "EnsemblVar_get_population_frequencies",

    # --- Variant pathogenicity scoring ---
    "CADD_get_variant_score",
    "AlphaMissense_get_variant_score",
    "SpliceAI_predict_splice",

    # --- GWAS ---
    "GWAS_search_associations_by_gene",

    # --- Protein domains (InterPro, Pfam) ---
    "InterPro_get_protein_domains",
    "Pfam_get_protein_annotations",

    # --- Gene nomenclature (HGNC) ---
    "HGNC_fetch_gene_by_symbol",

    # --- Phenotype / Rare disease (HPO, Orphanet) ---
    "HPO_search_terms",
    "HPO_get_term",
    "Orphanet_search_diseases",
    "Orphanet_get_genes",

    # --- Pharmacogenomics (PharmGKB, CPIC) ---
    "PharmGKB_search_drugs",
    "CPIC_search_gene_drug_pairs",
    "CPIC_get_recommendations",

    # --- Druggable genome (DGIdb) ---
    "DGIdb_get_drug_gene_interactions",

    # --- Cancer (COSMIC, OncoKB, CIViC) ---
    "COSMIC_search_mutations",
    "OncoKB_annotate_variant",
    "OncoKB_get_cancer_genes",
    "civic_search_genes",
    "CancerPrognosis_search_studies",

    # --- Clinical gene validity (ClinGen) ---
    "ClinGen_search_gene_validity",

    # --- Toxicogenomics (CTD) ---
    "CTD_get_chemical_gene_interactions",
    "CTD_get_gene_diseases",

    # --- Gene Ontology ---
    "GO_get_annotations_for_gene",
    "GO_search_terms",

    # --- ADMET prediction ---
    "ADMETAI_predict_toxicity",
    "ADMETAI_predict_bioavailability",

    # --- Drug side effects (SIDER, FAERS) ---
    "SIDER_get_drug_side_effects",
    "FAERS_search_adverse_event_reports",

    # --- FDA Drug Labels ---
    "FDA_get_drug_label",
    "FDA_search_drug_labels",
    "FDA_get_dosage_and_storage_information_by_drug_name",
    "FDA_get_drug_interactions_by_drug_name",
    "FDA_get_contraindications_by_drug_name",

    # --- Discovery ---
    "Tool_Finder_Keyword",
}

# Courtesy delays between calls to the same upstream service (seconds).
# Keyed by prefix of TU tool name.
RATE_LIMITS: dict[str, float] = {
    "UniProt": 0.5,
    "alphafold": 0.5,
    "ChEMBL": 0.5,
    "PubChem": 0.5,
    "drugbank": 0.5,
    "OpenTargets": 0.3,
    "kegg": 1.0,
    "Reactome": 0.5,
    "SemanticScholar": 0.5,
    "clinvar": 0.35,
    "search_clinical": 0.5,
    "OMIM": 0.5,
    "gnomad": 0.5,
    "GTEx": 0.5,
    "DisGeNET": 0.5,
    "RCSB": 0.3,
    "STRING": 0.5,
    "Ensembl": 0.5,
    "CADD": 0.5,
    "AlphaMissense": 0.5,
    "SpliceAI": 0.5,
    "GWAS": 0.5,
    "InterPro": 0.5,
    "Pfam": 0.5,
    "HGNC": 0.5,
    "HPO": 0.5,
    "Orphanet": 0.5,
    "PharmGKB": 0.5,
    "CPIC": 0.5,
    "DGIdb": 0.5,
    "COSMIC": 0.5,
    "OncoKB": 0.5,
    "civic": 0.5,
    "Cancer": 0.5,
    "ClinGen": 0.5,
    "CTD": 0.5,
    "GO_": 0.5,
    "ADMETAI": 0.3,
    "SIDER": 0.5,
    "FAERS": 0.5,
}
