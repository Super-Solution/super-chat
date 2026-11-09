# SPDX-License-Identifier: Apache-2.0
"""The SSE parser must stay linear: a long frame arriving in small chunks, and many frames in one chunk."""

import random
import time

from super_protocol.sse import SSEParser

# The old parser recounted and rescanned the whole buffer per chunk (about 15 s for the first case, about 10 s for
# the second). The new one takes about 0.2 s and 0.1 s; the budget is generous so a slow machine does not flake.
BUDGET_SECONDS = 3.0


def _feed(payload: bytes, chunk: int) -> int:
    parser = SSEParser(max_frame_bytes=10_000_000)
    frames = 0
    for i in range(0, len(payload), chunk):
        frames += len(parser.feed(payload[i : i + chunk]))
    return frames + len(parser.finish())


def test_one_long_frame_in_small_chunks_is_linear() -> None:
    payload = b"data: " + b"x" * 1_900_000 + b"\n\n"
    started = time.perf_counter()
    assert _feed(payload, 1024) == 1
    assert time.perf_counter() - started < BUDGET_SECONDS


def test_many_frames_in_one_chunk_is_linear() -> None:
    payload = b'event: output.delta\ndata: {"a":1}\n\n' * 100_000
    started = time.perf_counter()
    assert _feed(payload, len(payload)) == 100_000
    assert time.perf_counter() - started < BUDGET_SECONDS


def test_chunking_never_changes_the_frames() -> None:
    rng = random.Random(11)
    pieces = ["data:", "event:", " ", "x", "\r", "\n", "\r\n", "\n\n", "\r\n\r\n", "é", "😀", "data: {}\n\n"]
    for _ in range(300):
        data = "".join(rng.choice(pieces) for _ in range(rng.randint(0, 40))).encode()
        whole = SSEParser()
        expected = whole.feed(data) + whole.finish()
        cuts = sorted(rng.sample(range(len(data) + 1), min(len(data) + 1, rng.randint(0, 6))))
        parts = [data[a:b] for a, b in zip([0, *cuts], [*cuts, len(data)])]
        split = SSEParser()
        got = [f for part in parts for f in split.feed(part)] + split.finish()
        assert got == expected
