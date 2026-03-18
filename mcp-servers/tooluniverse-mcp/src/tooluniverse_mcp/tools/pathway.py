"""Pathway tools: KEGG, Reactome."""

from typing import Annotated

from tooluniverse_mcp.formatting import format_result


def register(mcp, call):

    @mcp.tool(name="get-pathway")
    def get_pathway(
        pathway_id: Annotated[str, "KEGG pathway ID (e.g. hsa04110) or search term"],
    ) -> str:
        """Get KEGG pathway details: description, gene list, linked pathways."""
        result = call(
            "kegg_get_pathway_info",
            {"pathway_id": pathway_id},
            service="KEGG",
        )
        return format_result(result)

    @mcp.tool(name="pathway-enrichment")
    def pathway_enrichment(
        genes: Annotated[str, "Comma-separated gene symbols (e.g. BRAF,TP53,EGFR)"],
    ) -> str:
        """Run Reactome pathway enrichment analysis on a set of genes."""
        gene_list = [g.strip() for g in genes.split(",") if g.strip()]
        result = call(
            "ReactomeAnalysis_pathway_enrichment",
            {"genes": gene_list},
            service="Reactome",
        )
        return format_result(result)
