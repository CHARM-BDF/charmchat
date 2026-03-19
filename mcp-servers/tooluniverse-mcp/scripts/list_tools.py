"""Generate TOOLUNIVERSE_TOOLS.md catalog from the ToolUniverse package."""

from tooluniverse import ToolUniverse

tu = ToolUniverse()
specs = tu.list_built_in_tools(mode="list_spec")

lines = [
    "# ToolUniverse Tools Catalog",
    "",
    f"**{len(specs)} tools available** (tooluniverse v1.1.4)",
    "",
    "| Tool | Description |",
    "|------|-------------|",
]

for s in sorted(specs, key=lambda x: x.get("name", "")):
    name = s.get("name", "")
    desc = s.get("description", "").replace("\n", " ").replace("|", "/").strip()
    if len(desc) > 200:
        desc = desc[:197] + "..."
    lines.append(f"| `{name}` | {desc} |")

print("\n".join(lines))
