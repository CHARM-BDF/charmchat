"""ToolUniverse curated wrapper MCP server."""

import sys
import time
import logging
import threading

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

from tooluniverse_mcp.config import RATE_LIMITS

logging.basicConfig(stream=sys.stderr, level=logging.INFO)
logger = logging.getLogger("tooluniverse-mcp")


class RateLimiter:
    """Thread-safe per-service courtesy delay."""

    def __init__(self, limits: dict[str, float]):
        self._limits = limits
        self._last_call: dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, service: str):
        delay = self._limits.get(service, 0)
        if delay <= 0:
            return
        with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_call.get(service, 0)
            if elapsed < delay:
                time.sleep(delay - elapsed)
            self._last_call[service] = time.monotonic()


def _lazy_tu():
    """Lazy-load ToolUniverse on first tool call (not at server startup)."""
    tu = None
    lock = threading.Lock()

    def get():
        nonlocal tu
        if tu is None:
            with lock:
                if tu is None:
                    from tooluniverse import ToolUniverse

                    logger.info("Loading ToolUniverse...")
                    tu = ToolUniverse()
                    tu.load_tools(quiet=True)
                    logger.info("ToolUniverse loaded (%d tools)", len(tu.tools) if hasattr(tu, 'tools') else 0)
        return tu

    return get


def create_server() -> FastMCP:
    mcp = FastMCP("tooluniverse")

    get_tu = _lazy_tu()
    limiter = RateLimiter(RATE_LIMITS)

    def call(tool_name: str, arguments: dict, service: str | None = None):
        """Call a ToolUniverse tool with rate limiting and error handling."""
        if service:
            limiter.wait(service)
        try:
            return get_tu().run({"name": tool_name, "arguments": arguments})
        except Exception as e:
            logger.error("%s failed: %s", tool_name, e)
            raise ToolError(str(e))

    from tooluniverse_mcp.tools import (
        protein,
        compound,
        pathway,
        literature,
        clinical,
        discovery,
    )

    for module in [protein, compound, pathway, literature, clinical, discovery]:
        module.register(mcp, call)

    return mcp


def main():
    server = create_server()
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
