# SPDX-License-Identifier: Apache-2.0
"""Small helpers that reproduce the JavaScript semantics the TypeScript reference relies on."""

from __future__ import annotations

import math
import re
from typing import Any, Final


class _Undefined:
    """A JSON object has no such key (JavaScript `undefined`), as opposed to `null`."""

    _instance: _Undefined | None = None

    def __new__(cls) -> _Undefined:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "UNDEFINED"

    def __bool__(self) -> bool:
        return False


UNDEFINED: Final = _Undefined()

# String.prototype.trim removes exactly these (WhiteSpace and LineTerminator in ECMAScript).
_JS_WHITESPACE = "\t\n\v\f\r                  　﻿"


def get(obj: Any, key: str) -> Any:
    """`obj[key]`: the value, or UNDEFINED when obj is not a mapping or lacks the key."""
    if isinstance(obj, dict):
        return obj.get(key, UNDEFINED)
    return UNDEFINED


def is_object(value: Any) -> bool:
    """`typeof v === "object" && v !== null && !Array.isArray(v)`."""
    return isinstance(value, dict)


def is_string(value: Any) -> bool:
    return isinstance(value, str)


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def finite(value: Any) -> bool:
    """`typeof v === "number" && Number.isFinite(v)`."""
    return is_number(value) and math.isfinite(value)


def is_integer(value: Any) -> bool:
    """`Number.isInteger(v)`."""
    return finite(value) and float(value).is_integer()


def is_safe_integer(value: Any) -> bool:
    """`Number.isSafeInteger(v)`."""
    return is_integer(value) and abs(value) <= 9007199254740991


def equals_number(value: Any, expected: int) -> bool:
    """`value === expected` for a number literal (true and false are not numbers)."""
    return is_number(value) and value == expected


def trim(text: str) -> str:
    return text.strip(_JS_WHITESPACE)


def js_length(text: str) -> int:
    """`text.length`: UTF-16 code units, so an emoji counts as two."""
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def matches(pattern: re.Pattern[str], value: Any) -> bool:
    """`typeof v === "string" && pattern.test(v)` for an anchored pattern."""
    return isinstance(value, str) and pattern.fullmatch(value) is not None


_SCHEME = re.compile(r"(?i)(https?):")
_HOST_FORBIDDEN = set("\x00\t\n\r #/:<>?@[\\]^|%") | {chr(c) for c in range(0x20)} | {"\x7f"}
_IPV6 = re.compile(r"\[[0-9A-Fa-f:.]+\]")


def is_http_url(text: str) -> bool:
    """Whether `new URL(text)` succeeds with an http or https scheme.

    Covers what a base URL realistically is: scheme, optional credentials, a host (name, IPv4 or
    bracketed IPv6) and an optional port, with the WHATWG leniency about extra slashes. Percent-encoded
    and internationalised hosts are not reproduced.
    """
    text = text.strip("".join(chr(c) for c in range(0x21))).translate({9: None, 10: None, 13: None})
    match = _SCHEME.match(text)
    if not match:
        return False
    rest = text[match.end() :].lstrip("/\\")
    end = len(rest)
    for stop in "/\\?#":
        index = rest.find(stop)
        if index != -1:
            end = min(end, index)
    authority = rest[:end]
    hostport = authority[authority.rfind("@") + 1 :]
    if hostport.startswith("["):
        close = hostport.find("]")
        if close == -1 or not _IPV6.fullmatch(hostport[: close + 1]):
            return False
        port = hostport[close + 1 :]
        return not port or (port.startswith(":") and _valid_port(port[1:]))
    host, _, port = hostport.partition(":")
    if host == "" or any(ch in _HOST_FORBIDDEN for ch in host):
        return False
    return _valid_port(port) if ":" in hostport else True


def _valid_port(port: str) -> bool:
    return port == "" or (port.isascii() and port.isdigit() and int(port) <= 65535)
