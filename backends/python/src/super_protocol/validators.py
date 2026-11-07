# SPDX-License-Identifier: Apache-2.0
"""Plugin manifest, editor card and chart card validators.

Ported from packages/protocol in the TypeScript reference; every message and every ordering of
checks matches it, and conformance/protocol.v1.json pins that. Inputs are decoded JSON.
"""

from __future__ import annotations

import re
from typing import Any, TypedDict

from . import _js as js
from ._js import UNDEFINED, get

PLUGIN_MANIFEST_VERSION = 0
EDITOR_CARD_KIND = "super-editor.document"
CHART_CARD_KIND = "super-chart.chart"
CHART_TYPES = ("candles", "hollow-candles", "ohlc", "line", "area", "baseline", "heikin-ashi")
CHART_LIMITS = {"bars": 20000, "annotations": 256, "indicators": 12, "anchors": 2, "textLength": 2048, "keyLength": 128}
CHART_HEIGHT = (160, 1200)
SURFACES = ("card", "panel", "tool", "canvas")


class ManifestIssue(TypedDict):
    path: str
    message: str


class CardResult(TypedDict, total=False):
    ok: bool
    error: str
    expected: str


_NAME = re.compile(r"(@[a-z0-9\-~][a-z0-9\-._~]*/)?[a-z0-9\-~][a-z0-9\-._~]*")
_SEMVER = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.\-]+)?(\+[0-9A-Za-z.\-]+)?")
_CAPABILITY_ID = re.compile(r"[a-z][a-z0-9\-]*(\.[a-z][a-z0-9\-]*)+")


def validate_plugin_manifest(value: Any) -> list[ManifestIssue]:
    """Every problem found; an empty list means the manifest is valid."""
    issues: list[ManifestIssue] = []

    def add(path: str, message: str) -> None:
        issues.append({"path": path, "message": message})

    if not js.is_object(value):
        return [{"path": "", "message": "manifest must be an object"}]
    if not js.equals_number(get(value, "manifestVersion"), PLUGIN_MANIFEST_VERSION):
        add("manifestVersion", f"must be {PLUGIN_MANIFEST_VERSION}")
    if not js.matches(_NAME, get(value, "name")):
        add("name", "must be a valid npm package name")
    if not js.matches(_SEMVER, get(value, "version")):
        add("version", "must be a semver string")
    license_ = get(value, "license")
    if not js.is_string(license_) or js.trim(license_) == "":
        add("license", "must be a non-empty SPDX expression")
    capabilities = get(value, "capabilities")
    if not isinstance(capabilities, list) or len(capabilities) == 0:
        add("capabilities", "must be a non-empty array")
    else:
        seen: set[str] = set()
        for i, cap in enumerate(capabilities):
            path = f"capabilities[{i}]"
            # `typeof c !== "object"`: arrays pass this test in the reference and fail the field checks.
            if not isinstance(cap, (dict, list)):
                add(path, "must be an object")
                continue
            cap_id = get(cap, "id")
            if not js.matches(_CAPABILITY_ID, cap_id):
                add(f"{path}.id", "must be a dotted lowercase id such as editor.document")
            elif cap_id in seen:
                add(f"{path}.id", "duplicate capability id")
            else:
                seen.add(cap_id)
            surface = get(cap, "surface")
            if not js.is_string(surface) or surface not in SURFACES:
                add(f"{path}.surface", f"must be one of {', '.join(SURFACES)}")
            card_kind, tool_name = get(cap, "cardKind"), get(cap, "toolName")
            if surface == "card" and (not js.is_string(card_kind) or card_kind == ""):
                add(f"{path}.cardKind", "is required for card capabilities")
            if surface == "tool" and (not js.is_string(tool_name) or tool_name == ""):
                add(f"{path}.toolName", "is required for tool capabilities")
            schema = get(cap, "inputSchema")
            if schema is not UNDEFINED and not js.is_object(schema):
                add(f"{path}.inputSchema", "must be an object")
    service = get(value, "service")
    if service is not UNDEFINED:
        base_url = get(service, "baseUrl")
        if not (js.is_object(service) and js.is_string(base_url) and js.is_http_url(base_url)):
            add("service.baseUrl", "must be an http(s) URL")
    return issues


def _fail(error: str, expected: str | None = None) -> CardResult:
    return {"ok": False, "error": error, "expected": expected} if expected else {"ok": False, "error": error}


_OK: CardResult = {"ok": True}


def validate_editor_card_spec(spec: Any) -> CardResult:
    if not js.is_object(spec):
        return _fail("Editor card spec must be an object.")
    if get(spec, "kind") != EDITOR_CARD_KIND:
        return _fail(f'kind must be "{EDITOR_CARD_KIND}".')
    title, mode = get(spec, "title"), get(spec, "mode")
    if title is not UNDEFINED and not js.is_string(title):
        return _fail("title must be a string.")
    if mode is not UNDEFINED and mode != "view" and mode != "edit":
        return _fail('mode must be "view" or "edit".')
    document, service = get(spec, "document"), get(spec, "service")
    has_document, has_service = document is not UNDEFINED, service is not UNDEFINED
    if has_document == has_service:
        return _fail(
            "Provide exactly one of `document` or `service`.", "document: {...} | service: { baseUrl, documentId }"
        )
    if has_service and mode == "edit":
        return _fail("A service-backed document is read-only for now: use an inline document to edit.")
    if has_document:
        if not (
            js.is_object(document)
            and js.equals_number(get(document, "schemaVersion"), 1)
            and js.is_string(get(document, "id"))
            and js.is_string(get(document, "title"))
            and isinstance(get(document, "blocks"), list)
        ):
            return _fail("document must be a schemaVersion 1 report document with id, title and blocks.")
    else:
        base_url, document_id = get(service, "baseUrl"), get(service, "documentId")
        ok = (
            js.is_object(service)
            and js.is_string(base_url)
            and js.is_string(document_id)
            and document_id != ""
            and js.is_http_url(base_url)
        )
        if not ok:
            return _fail("service needs an http(s) baseUrl and a documentId.")
    return _OK


def validate_period(v: Any) -> str | None:
    if not js.is_object(v):
        return "period must be an object."
    multiplier = get(v, "multiplier")
    if not js.is_safe_integer(multiplier) or multiplier <= 0:
        return "period.multiplier must be a positive integer."
    timespan, text = get(v, "timespan"), get(v, "text")
    if not js.is_string(timespan) or js.trim(timespan) == "":
        return "period.timespan must be a non-empty string."
    if not js.is_string(text) or js.trim(text) == "":
        return "period.text must be a non-empty string."
    return None


_SYMBOL_STRINGS = ("name", "shortName", "exchange", "market", "priceCurrency", "type", "logo", "timezone")


def validate_symbol(v: Any) -> str | None:
    if not js.is_object(v):
        return "symbol must be an object."
    ticker = get(v, "ticker")
    if not js.is_string(ticker) or js.trim(ticker) == "":
        return "symbol.ticker must be a non-empty string."
    for k in _SYMBOL_STRINGS:
        item = get(v, k)
        if item is not UNDEFINED and not js.is_string(item):
            return f"symbol.{k} must be a string."
    precision = get(v, "pricePrecision")
    if precision is not UNDEFINED and precision != "auto" and not (js.is_integer(precision) and 0 <= precision <= 12):
        return 'symbol.pricePrecision must be an integer from 0 to 12 or "auto".'
    return None


def validate_market_bar(v: Any) -> str | None:
    if not js.is_object(v):
        return "a bar must be an object."
    for k in ("timestamp", "open", "high", "low", "close"):
        if not js.finite(get(v, k)):
            return f"bar.{k} must be a finite number."
    volume = get(v, "volume")
    if volume is not UNDEFINED and not js.finite(volume):
        return "bar.volume must be a finite number."
    o, h, low, c = v["open"], v["high"], v["low"], v["close"]
    if h < max(o, c, low) or low > min(o, c):
        return "bar high/low must contain open and close."
    return None


_TONES = ("bull", "bear", "neutral", "accent")


def validate_chart_annotation(v: Any) -> str | None:
    if not js.is_object(v):
        return "an annotation must be an object."
    key_limit, text_limit = CHART_LIMITS["keyLength"], CHART_LIMITS["textLength"]
    key = get(v, "key")
    if not js.is_string(key) or js.trim(key) == "" or js.js_length(key) > key_limit:
        return f"annotation.key must be a non-empty string of at most {key_limit} characters."
    kind = get(v, "kind")
    if kind != "level" and kind != "zone" and kind != "marker":
        return 'annotation.kind must be "level", "zone" or "marker".'
    anchors = get(v, "anchors")
    if not isinstance(anchors, list) or len(anchors) == 0 or len(anchors) > CHART_LIMITS["anchors"]:
        return "annotation.anchors must hold one or two anchors."
    for a in anchors:
        if not js.is_object(a) or not js.finite(get(a, "time")):
            return "annotation anchors need a finite time."
        price = get(a, "price")
        if price is not UNDEFINED and not js.finite(price):
            return "annotation anchor price must be a finite number."
    priced = ["price" in a for a in anchors]
    if kind == "level" and (len(anchors) != 1 or not priced[0]):
        return "a level needs exactly one anchor with a price."
    if kind == "zone" and (len(anchors) != 2 or not all(priced)):
        return "a zone needs two anchors, both with a price."
    if kind == "marker" and len(anchors) != 1:
        return "a marker needs exactly one anchor."
    text = get(v, "text")
    if text is not UNDEFINED and (not js.is_string(text) or js.js_length(text) > text_limit):
        return f"annotation.text must be a string of at most {text_limit} characters."
    tone = get(v, "tone")
    if tone is not UNDEFINED and not (js.is_string(tone) and tone in _TONES):
        return "annotation.tone must be bull, bear, neutral or accent."
    color = get(v, "color")
    if color is not UNDEFINED and (not js.is_string(color) or js.js_length(color) > 128):
        return "annotation.color must be a short CSS color string."
    return None


def validate_chart_annotations(v: Any) -> str | None:
    if not isinstance(v, list):
        return "annotations must be an array."
    if len(v) > CHART_LIMITS["annotations"]:
        return f"at most {CHART_LIMITS['annotations']} annotations per chart."
    keys: set[str] = set()
    for item in v:
        problem = validate_chart_annotation(item)
        if problem:
            return problem
        key = item["key"]
        if key in keys:
            return f'duplicate annotation key "{key}".'
        keys.add(key)
    return None


def validate_chart_card_spec(spec: Any) -> CardResult:
    if not js.is_object(spec):
        return _fail("Chart card spec must be an object.")
    if get(spec, "kind") != CHART_CARD_KIND:
        return _fail(f'kind must be "{CHART_CARD_KIND}".')
    spec_id, title = get(spec, "id"), get(spec, "title")
    if spec_id is not UNDEFINED and (
        not js.is_string(spec_id) or js.trim(spec_id) == "" or js.js_length(spec_id) > 128
    ):
        return _fail("id must be a non-empty string.")
    if title is not UNDEFINED and not js.is_string(title):
        return _fail("title must be a string.")
    problem = validate_symbol(get(spec, "symbol")) or validate_period(get(spec, "period"))
    if problem:
        return _fail(problem)
    height = get(spec, "height")
    low, high = CHART_HEIGHT
    if height is not UNDEFINED and not (js.finite(height) and low <= height <= high):
        return _fail(f"height must be {low}..{high} pixels.")
    chart_type = get(spec, "chartType")
    if chart_type is not UNDEFINED and not (js.is_string(chart_type) and chart_type in CHART_TYPES):
        return _fail(f"chartType must be one of {', '.join(CHART_TYPES)}.")
    bars, feed = get(spec, "bars"), get(spec, "feed")
    has_bars, has_feed = bars is not UNDEFINED, feed is not UNDEFINED
    if has_bars == has_feed:
        return _fail(
            "Provide exactly one of `bars` or `feed`.",
            "bars: [{timestamp, open, high, low, close, volume?}] | feed: { id }",
        )
    if has_bars:
        if not isinstance(bars, list) or len(bars) == 0:
            return _fail("bars must be a non-empty array.")
        if len(bars) > CHART_LIMITS["bars"]:
            return _fail(f"at most {CHART_LIMITS['bars']} inline bars; reference a feed for more.")
        previous = float("-inf")
        for bar in bars:
            bad = validate_market_bar(bar)
            if bad:
                return _fail(bad)
            if bar["timestamp"] <= previous:
                return _fail("bars must be sorted oldest first with unique timestamps.")
            previous = bar["timestamp"]
    else:
        feed_id = get(feed, "id")
        if not js.is_object(feed) or not js.is_string(feed_id) or js.trim(feed_id) == "":
            return _fail("feed needs a non-empty id.")
    indicators = get(spec, "indicators")
    if indicators is not UNDEFINED:
        if not isinstance(indicators, list) or len(indicators) > CHART_LIMITS["indicators"]:
            return _fail(f"indicators must be an array of at most {CHART_LIMITS['indicators']}.")
        for item in indicators:
            name = get(item, "name")
            if not js.is_object(item) or not js.is_string(name) or js.trim(name) == "":
                return _fail("each indicator needs a name.")
            params = get(item, "params")
            if params is not UNDEFINED and (not isinstance(params, list) or not all(js.finite(p) for p in params)):
                return _fail("indicator params must be an array of finite numbers.")
    annotations = get(spec, "annotations")
    if annotations is not UNDEFINED:
        bad = validate_chart_annotations(annotations)
        if bad:
            return _fail(bad)
    return _OK


_TERMINAL = ("request.completed", "request.failed", "request.replayed")


def is_terminal_event(event_type: str) -> bool:
    return event_type in _TERMINAL
