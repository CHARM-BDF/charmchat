"""ToolUniverse curated wrapper MCP server.

Reads tool specs from ToolUniverse's built-in catalog at startup (fast, JSON only),
then lazy-loads the full ToolUniverse runtime on first tool call.
"""

import sys
import time
import logging
import threading

import mcp.server.stdio
import mcp.types as types
from mcp.server import Server

from tooluniverse_mcp.config import CURATED_TOOLS, RATE_LIMITS
from tooluniverse_mcp.formatting import format_result

logging.basicConfig(stream=sys.stderr, level=logging.INFO)
logger = logging.getLogger("tooluniverse-mcp")


# ---------------------------------------------------------------------------
# Load tool specs at startup (reads JSON files, no heavy initialization)
# ---------------------------------------------------------------------------

def _load_specs() -> tuple[dict[str, dict], set[str]]:
    from tooluniverse import ToolUniverse
    tu = ToolUniverse()
    all_specs = tu.list_built_in_tools(mode="list_spec")
    curated = {}
    all_names = set()
    for spec in all_specs:
        name = spec.get("name", "")
        all_names.add(name)
        if CURATED_TOOLS is None or name in CURATED_TOOLS:
            # Strip oneOf/allOf/anyOf from top-level schema (Anthropic API rejects them)
            param = spec.get("parameter", {})
            for key in ("oneOf", "allOf", "anyOf"):
                param.pop(key, None)
            # Tell the LLM how to call discovered tools
            if name == "Tool_Finder_Keyword":
                spec = {**spec, "description": spec.get("description", "") +
                    "\n\nIMPORTANT: To call a tool found by this search, you must prefix its name with 'tooluniverse__'. "
                    "For example, if you find 'OmniPath_get_tf_target_interactions', call it as 'tooluniverse__OmniPath_get_tf_target_interactions'."}
            curated[name] = spec
    logger.info("Loaded %d curated / %d total tool specs", len(curated), len(all_names))
    return curated, all_names


TOOL_SPECS, ALL_TOOL_NAMES = _load_specs()


# ---------------------------------------------------------------------------
# Lazy-load ToolUniverse runtime on first tool call
# ---------------------------------------------------------------------------

_tu = None
_tu_lock = threading.Lock()


def _get_tu():
    global _tu
    if _tu is None:
        with _tu_lock:
            if _tu is None:
                from tooluniverse import ToolUniverse
                logger.info("Loading ToolUniverse runtime...")
                _tu = ToolUniverse()
                _tu.load_tools(quiet=True)
                logger.info("ToolUniverse ready (%d tools)", len(_tu.tools) if hasattr(_tu, "tools") else 0)
    return _tu


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

_rate_last: dict[str, float] = {}
_rate_lock = threading.Lock()


def _rate_limit(tool_name: str):
    for prefix, delay in RATE_LIMITS.items():
        if tool_name.startswith(prefix):
            with _rate_lock:
                now = time.monotonic()
                elapsed = now - _rate_last.get(prefix, 0)
                if elapsed < delay:
                    time.sleep(delay - elapsed)
                _rate_last[prefix] = time.monotonic()
            return


# ---------------------------------------------------------------------------
# MCP Server
# ---------------------------------------------------------------------------

server = Server("tooluniverse")


@server.list_tools()
async def handle_list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name=spec["name"],
            description=spec.get("description", ""),
            inputSchema=spec.get("parameter", {"type": "object", "properties": {}}),
        )
        for spec in TOOL_SPECS.values()
    ]


@server.call_tool()
async def handle_call_tool(name: str, arguments: dict | None) -> list[types.TextContent]:
    if name not in ALL_TOOL_NAMES:
        raise types.McpError(types.INVALID_PARAMS, f"Unknown tool: {name}")

    _rate_limit(name)

    try:
        result = await _get_tu().run_one_function_async({"name": name, "arguments": arguments or {}})
    except Exception as e:
        logger.error("%s failed: %s", name, e)
        raise types.McpError(types.INTERNAL_ERROR, str(e))

    return [types.TextContent(type="text", text=format_result(result))]


async def _run():
    async with mcp.server.stdio.stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


def main():
    import asyncio
    asyncio.run(_run())


if __name__ == "__main__":
    main()
