"""Protein analysis tools: UniProt, AlphaFold."""

from typing import Annotated

from tooluniverse_mcp.formatting import format_result


def register(mcp, call):

    @mcp.tool(name="get-protein-entry")
    def get_protein_entry(
        accession: Annotated[str, "UniProt accession (e.g. P05067, Q9Y6K9)"],
    ) -> str:
        """Get full UniProt protein record: function, structure, GO terms, cross-references."""
        result = call(
            "UniProt_get_entry_by_accession",
            {"accession": accession},
            service="UniProt",
        )
        return format_result(result)

    @mcp.tool(name="get-protein-function")
    def get_protein_function(
        accession: Annotated[str, "UniProt accession (e.g. P05067)"],
    ) -> str:
        """Get functional annotations for a protein: catalytic activity, binding sites, pathways."""
        result = call(
            "UniProt_get_function_by_accession",
            {"accession": accession},
            service="UniProt",
        )
        return format_result(result)

    @mcp.tool(name="get-protein-expression")
    def get_protein_expression(
        accession: Annotated[str, "UniProt accession (e.g. P05067)"],
    ) -> str:
        """Get tissue expression patterns for a protein."""
        result = call(
            "UniProt_get_expression_by_accession",
            {"accession": accession},
            service="UniProt",
        )
        return format_result(result)

    @mcp.tool(name="get-protein-structure")
    def get_protein_structure(
        accession: Annotated[str, "UniProt accession (e.g. P05067)"],
    ) -> str:
        """Get AlphaFold2 predicted protein structure for a UniProt accession."""
        result = call(
            "AlphaFold_get_prediction",
            {"accession": accession},
            service="AlphaFold",
        )
        return format_result(result)
