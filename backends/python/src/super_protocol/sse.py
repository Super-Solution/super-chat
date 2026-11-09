# SPDX-License-Identifier: Apache-2.0
"""Incremental Server-Sent Events parser, ported from `parseSSE` in packages/protocol.

Feed raw bytes as they arrive; frames come back as soon as their blank line does. It copes with any
chunk boundary (including inside a multi-byte character) and with LF or CRLF line ends. Pending
text is limited to `max_frame_bytes` UTF-16 code units, like the reference. Never logs content.
"""

from __future__ import annotations

import codecs
import re
from typing import NamedTuple

from . import _js as js

DEFAULT_MAX_FRAME_BYTES = 2_000_000


class StreamFrameTooLarge(Exception):
    """The pending text grew past the limit before a frame ended (code `stream_frame_too_large`)."""

    code = "stream_frame_too_large"


class Frame(NamedTuple):
    event: str
    data: str


def _utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


_BLANK_LINE = re.compile(r"\r?\n\r?\n")
_LINE_END = re.compile(r"\r?\n")


def _parse_frame(frame: str) -> Frame | None:
    event = "message"
    data: list[str] = []
    for line in _LINE_END.split(frame):
        if line.startswith("event:"):
            event = js.trim(line[6:])
        if line.startswith("data:"):
            value = line[5:]
            data.append(value[1:] if value.startswith(" ") else value)
    return Frame(event, "\n".join(data)) if data else None


class SSEParser:
    def __init__(self, max_frame_bytes: int = DEFAULT_MAX_FRAME_BYTES) -> None:
        self._max = max_frame_bytes
        # "utf-8-sig" drops a byte order mark at the very start of the stream and nowhere else, which is
        # what the reference's TextDecoder does; a plain "utf-8" decoder keeps U+FEFF and the first
        # frame's field name then fails to match.
        self._decoder = codecs.getincrementaldecoder("utf-8-sig")(errors="replace")
        self._buffer = ""
        self._units = 0  # UTF-16 length of the buffer, kept as text comes and goes so a long frame is not recounted per chunk
        self._scan_from = 0  # nothing before this offset can start a frame end

    def feed(self, chunk: bytes) -> list[Frame]:
        """Add bytes; return the frames they completed. Raises StreamFrameTooLarge."""
        self._append(self._decoder.decode(chunk, final=False))
        return self._drain()

    def finish(self) -> list[Frame]:
        """Flush the decoder at end of stream. A frame without its blank line is dropped."""
        self._append(self._decoder.decode(b"", final=True))
        return self._drain()

    def _append(self, text: str) -> None:
        self._buffer += text
        self._units += _utf16_length(text)

    def _drain(self) -> list[Frame]:
        if self._units > self._max:
            raise StreamFrameTooLarge()
        frames: list[Frame] = []
        buffer = self._buffer
        offset = 0
        while (found := _BLANK_LINE.search(buffer, offset + self._scan_from)) is not None:
            frame = _parse_frame(buffer[offset : found.start()])
            offset = found.end()
            self._scan_from = 0
            if frame is not None:
                frames.append(frame)
        if offset:
            self._units -= _utf16_length(buffer[:offset])
            buffer = buffer[offset:]
        self._buffer = buffer
        # A frame end that is still incomplete can only start in the last three characters.
        self._scan_from = max(len(buffer) - 3, 0)
        return frames
