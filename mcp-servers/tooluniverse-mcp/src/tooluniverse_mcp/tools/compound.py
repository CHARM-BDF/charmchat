"""Compound and drug tools: ChEMBL, PubChem, FDA."""

from typing import Annotated

from tooluniverse_mcp.formatting import format_result


def register(mcp, call):

    @mcp.tool(name="search-compounds")
    def search_compounds(
        query: Annotated[str, "Compound name, formula, or identifier"],
    ) -> str:
        """Search ChEMBL for molecules by name or identifier."""
        result = call(
            "ChEMBL_search_molecules",
            {"query": query},
            service="ChEMBL",
        )
        return format_result(result)

    @mcp.tool(name="get-compound-activity")
    def get_compound_activity(
        chembl_id: Annotated[str, "ChEMBL compound ID (e.g. CHEMBL25)"],
    ) -> str:
        """Get bioactivity data for a compound: targets, assay results, potency."""
        result = call(
            "ChEMBL_get_molecule_targets",
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
            "extract_clinical_trial_adverse_events",
            {"drug_name": drug_name},
            service="FDA",
        )
        return format_result(result)

    @mcp.tool(name="get-compound-properties")
    def get_compound_properties(
        name: Annotated[str, "Compound name (e.g. aspirin)"],
    ) -> str:
        """Get PubChem compound ID from a compound name, then look up chemical properties."""
        cid_result = call(
            "PubChem_get_CID_by_compound_name",
            {"name": name},
            service="PubChem",
        )
        # If we got a CID, fetch properties
        if isinstance(cid_result, dict) and "CID" in cid_result:
            cid = cid_result["CID"]
            props = call(
                "PubChem_get_compound_properties_by_CID",
                {"cid": cid},
                service="PubChem",
            )
            return format_result(props)
        return format_result(cid_result)
