"""Literature search tools: Semantic Scholar."""

from typing import Annotated

from tooluniverse_mcp.formatting import format_result


def register(mcp, call):

    @mcp.tool(name="search-papers")
    def search_papers(
        query: Annotated[str, "Search query (keywords, paper title, or topic)"],
        limit: Annotated[int, "Maximum results to return"] = 10,
    ) -> str:
        """Search academic papers via Semantic Scholar. Returns titles, authors, abstracts, citation counts."""
        result = call(
            "SemanticScholar_search",
            {"query": query, "limit": limit},
            service="SemanticScholar",
        )
        return format_result(result)

    @mcp.tool(name="get-paper-details")
    def get_paper_details(
        paper_id: Annotated[str, "Semantic Scholar paper ID, DOI, or ArXiv ID"],
    ) -> str:
        """Get full paper metadata: abstract, authors, references, citations, venue."""
        result = call(
            "SemanticScholar_get_paper",
            {"paper_id": paper_id},
            service="SemanticScholar",
        )
        return format_result(result)
