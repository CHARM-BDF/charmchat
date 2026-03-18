"""Format ToolUniverse results as readable markdown."""

import json


def format_result(result) -> str:
    """Generic formatter: convert a TU result to markdown text."""
    if result is None:
        return "No results returned."
    if isinstance(result, str):
        return result
    if isinstance(result, list):
        return _format_list(result)
    if isinstance(result, dict):
        return _format_dict(result)
    return str(result)


def _format_dict(d: dict) -> str:
    if not d:
        return "Empty result."
    lines = []
    for key, value in d.items():
        label = key.replace("_", " ").title()
        if isinstance(value, dict):
            lines.append(f"**{label}:**")
            lines.append(_format_dict(value))
        elif isinstance(value, list):
            lines.append(f"**{label}:**")
            lines.append(_format_list(value))
        elif isinstance(value, str) and len(value) > 200:
            lines.append(f"**{label}:**\n{value}")
        else:
            lines.append(f"**{label}:** {value}")
    return "\n".join(lines)


def _format_list(items: list) -> str:
    if not items:
        return "No items."
    if all(isinstance(item, dict) for item in items) and len(items) > 1:
        return _format_table(items)
    lines = []
    for item in items:
        if isinstance(item, dict):
            lines.append(f"- {_format_dict(item)}")
        else:
            lines.append(f"- {item}")
    return "\n".join(lines)


def _format_table(rows: list[dict]) -> str:
    if not rows:
        return ""
    keys = list(rows[0].keys())[:8]
    header = "| " + " | ".join(k.replace("_", " ").title() for k in keys) + " |"
    separator = "| " + " | ".join("---" for _ in keys) + " |"
    lines = [header, separator]
    for row in rows[:50]:
        cells = [str(row.get(k, ""))[:80] for k in keys]
        lines.append("| " + " | ".join(cells) + " |")
    if len(rows) > 50:
        lines.append(f"\n*... and {len(rows) - 50} more rows*")
    return "\n".join(lines)


def format_json(data, title: str = "Result") -> str:
    """Wrap data in a JSON code block."""
    return f"```json\n{json.dumps(data, indent=2, default=str)}\n```"
