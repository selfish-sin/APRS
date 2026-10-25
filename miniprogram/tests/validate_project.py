"""Static validation for the AnimFlow WeChat mini program.

Checks package/page completeness, JSON validity, WXML well-formedness, WXSS
brace balance, local require targets and tabBar assets.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def check_json_files() -> None:
    for path in ROOT.rglob("*.json"):
        if "node_modules" in path.parts:
            continue
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            fail(f"JSON parse failed: {path.relative_to(ROOT)}: {exc}")


def check_pages() -> None:
    app = json.loads((ROOT / "app.json").read_text(encoding="utf-8"))
    for page in app.get("pages", []):
        for extension in ("js", "json", "wxml", "wxss"):
            path = ROOT / f"{page}.{extension}"
            if not path.exists():
                fail(f"Missing page file: {path.relative_to(ROOT)}")
    for entry in app.get("tabBar", {}).get("list", []):
        if entry["pagePath"] not in app.get("pages", []):
            fail(f"tabBar page is not registered: {entry['pagePath']}")
        for key in ("iconPath", "selectedIconPath"):
            icon = entry.get(key)
            if icon and not (ROOT / icon).exists():
                fail(f"Missing tabBar icon: {icon}")
    for name, component in app.get("usingComponents", {}).items():
        base = ROOT / component.lstrip("/")
        for extension in ("js", "json", "wxml", "wxss"):
            path = base.parent / f"{base.name}.{extension}"
            if not path.exists():
                fail(
                    f"Missing file for component '{name}': "
                    f"{path.relative_to(ROOT)}"
                )


def check_requires() -> None:
    for path in ROOT.rglob("*.js"):
        if "node_modules" in path.parts or "tools" in path.parts:
            continue
        source = path.read_text(encoding="utf-8")
        for target in re.findall(r"require\(['\"]([^'\"]+)['\"]\)", source):
            if not target.startswith("."):
                continue
            resolved = (path.parent / target).resolve()
            candidates = [resolved, resolved.with_suffix(".js"), resolved / "index.js"]
            if not any(item.exists() for item in candidates):
                fail(f"Unresolved require in {path.relative_to(ROOT)}: {target}")


def check_wxml() -> None:
    for path in ROOT.rglob("*.wxml"):
        source = path.read_text(encoding="utf-8")
        normalized = re.sub(
            r"(\s)(scroll-x|scroll-y|enhanced|wx:else)(?=[\s/>])",
            r'\1\2="true"',
            source,
        )
        wrapped = (
            '<root xmlns:wx="https://wx.example/ns" '
            'xmlns:bind="https://wx.example/bind">' + normalized + "</root>"
        )
        try:
            etree.fromstring(wrapped.encode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            fail(f"WXML parse failed: {path.relative_to(ROOT)}: {exc}")
        if re.search(r"\{\{[^}]*<[^}]*\}\}", source):
            fail(f"Unescaped '<' in WXML expression: {path.relative_to(ROOT)}")


def check_wxss() -> None:
    for path in ROOT.rglob("*.wxss"):
        source = path.read_text(encoding="utf-8")
        if source.count("{") != source.count("}"):
            fail(f"Unbalanced WXSS braces: {path.relative_to(ROOT)}")


def check_no_legacy_component_props() -> None:
    for path in ROOT.rglob("*.wxml"):
        source = path.read_text(encoding="utf-8")
        if "actionLabel=" in source:
            fail(f"Use action-label for component props: {path.relative_to(ROOT)}")


def check_event_handlers() -> None:
    pattern = re.compile(r'(?:bind|catch):?[a-z]+="([A-Za-z_][A-Za-z0-9_]*)"')
    for path in ROOT.rglob("*.wxml"):
        script = path.with_suffix(".js")
        if not script.exists():
            continue
        source = path.read_text(encoding="utf-8")
        handlers = sorted(set(pattern.findall(source)))
        js = script.read_text(encoding="utf-8")
        for handler in handlers:
            if not re.search(rf"(?<![\w$]){re.escape(handler)}\s*\(", js):
                fail(
                    f"Missing event handler '{handler}' for "
                    f"{path.relative_to(ROOT)} in {script.relative_to(ROOT)}"
                )


def main() -> int:
    check_json_files()
    check_pages()
    check_requires()
    check_wxml()
    check_wxss()
    check_no_legacy_component_props()
    check_event_handlers()

    if ERRORS:
        for error in ERRORS:
            print("FAIL", error)
        return 1
    print(
        "PASS  JSON, pages, require targets, WXML, WXSS, tabBar assets "
        "and event handlers"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
