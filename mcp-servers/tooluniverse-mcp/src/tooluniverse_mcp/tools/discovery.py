"""Tool discovery: search ToolUniverse's full catalog."""

from typing import Annotated

from tooluniverse_mcp.formatting import format_result


def register(mcp, call):

    @mcp.tool(name="find-tools")
    def find_tools(
        query: Annotated[str, "What you're looking for (e.g. 'protein-protein interaction', 'drug metabolism')"],
        limit: Annotated[int, "Maximum results to return"] = 5,
    ) -> str:
        """Search ToolUniverse's catalog of 600+ biomedical tools by keyword.
        Use when the available tools don't cover what you need.
        Returns tool names, descriptions, and parameter schemas."""
        result = call(
            "Tool_Finder_Keyword",
            {"description": query, "limit": limit},
        )
        return format_result(result)
