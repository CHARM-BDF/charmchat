"""Clinical tools: ClinVar, ClinicalTrials, OMIM."""

from typing import Annotated

from tooluniverse_mcp.formatting import format_result


def register(mcp, call):

    @mcp.tool(name="get-variant-significance")
    def get_variant_significance(
        variant: Annotated[str, "Variant identifier (e.g. rs121913529, NM_004333.6:c.1799T>A)"],
    ) -> str:
        """Get clinical significance of a genetic variant from ClinVar: pathogenicity, conditions, review status."""
        result = call(
            "ClinVar_get_variant",
            {"variant": variant},
            service="ClinVar",
        )
        return format_result(result)

    @mcp.tool(name="search-clinical-trials")
    def search_clinical_trials(
        query: Annotated[str, "Condition, drug, or keyword to search for"],
        limit: Annotated[int, "Maximum results to return"] = 10,
    ) -> str:
        """Search ClinicalTrials.gov for active and completed trials."""
        result = call(
            "ClinicalTrials_search",
            {"query": query, "limit": limit},
            service="Clinical_Trials",
        )
        return format_result(result)

    @mcp.tool(name="get-disease-info")
    def get_disease_info(
        query: Annotated[str, "Disease name or OMIM ID (e.g. 176300)"],
    ) -> str:
        """Get genetic disease information from OMIM: inheritance, gene associations, clinical synopsis."""
        result = call(
            "OMIM_get_disease",
            {"query": query},
            service="OMIM",
        )
        return format_result(result)
