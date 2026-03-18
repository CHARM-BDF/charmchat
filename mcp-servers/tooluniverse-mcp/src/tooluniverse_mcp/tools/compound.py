"""Compound and drug tools: ChEMBL, PubChem, FDA."""

from typing import Annotated

from tooluniverse_mcp.formatting import format_result


def register(mcp, call):

    @mcp.tool(name="search-compounds")
    def search_compounds(
        query: Annotated[str, "Compound name, formula, or identifier"],
        limit: Annotated[int, "Maximum results to return"] = 10,
    ) -> str:
        """Search ChEMBL for chemical compounds by name or identifier."""
        result = call(
            "ChEMBL_compound_search",
            {"query": query, "limit": limit},
            service="ChEMBL",
        )
        return format_result(result)

    @mcp.tool(name="get-compound-activity")
    def get_compound_activity(
        chembl_id: Annotated[str, "ChEMBL compound ID (e.g. CHEMBL25)"],
    ) -> str:
        """Get bioactivity data for a compound: targets, assay results, potency."""
        result = call(
            "ChEMBL_compound_activity",
            {"chembl_id": chembl_id},
            service="ChEMBL",
        )
        return format_result(result)

    @mcp.tool(name="get-drug-safety")
    def get_drug_safety(
        drug_name: Annotated[str, "Drug name (e.g. aspirin, ibuprofen)"],
    ) -> str:
        """Query FDA adverse event reports for a drug."""
        result = call(
            "FDA_drug_safety_query",
            {"drug_name": drug_name},
            service="FDA",
        )
        return format_result(result)

    @mcp.tool(name="get-compound-properties")
    def get_compound_properties(
        name: Annotated[str, "Compound name or PubChem CID"],
    ) -> str:
        """Get chemical properties from PubChem: structure, formula, weight, synonyms."""
        result = call(
            "PubChem_get_compound",
            {"name": name},
            service="PubChem",
        )
        return format_result(result)
