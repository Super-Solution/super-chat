// SPDX-License-Identifier: Apache-2.0

package protocol

import (
	"errors"
	"strings"
	"unicode/utf8"
)

// DefaultMaxFrameBytes is the pending-text limit when none is given.
const DefaultMaxFrameBytes = 2_000_000

// ErrStreamFrameTooLarge means the pending text grew past the limit before a frame ended. Its
// message is the reference's error code.
var ErrStreamFrameTooLarge = errors.New("stream_frame_too_large")

// Frame is one Server-Sent Event.
type Frame struct {
	Event string
	Data  string
}

// Parser is an incremental SSE parser, ported from `parseSSE` in packages/protocol. Feed raw bytes
// as they arrive; frames come back as soon as their blank line does. It copes with any chunk
// boundary (including inside a multi-byte character) and with LF or CRLF line ends. The pending
// text is limited to MaxFrameBytes UTF-16 code units, like the reference. Invalid UTF-8 is replaced
// run by run, which differs from the WHATWG decoder for some malformed input. It never logs content.
type Parser struct {
	maxUnits int
	partial  []byte // an incomplete UTF-8 sequence waiting for its next bytes
	buffer   string
	units    int // UTF-16 length of buffer
	scanFrom int // nothing before this offset can start a frame end
	started  bool // some text has been decoded; a byte order mark is only dropped before this
}

// NewParser returns a parser limited to maxFrameBytes pending UTF-16 code units; zero or less
// means DefaultMaxFrameBytes.
func NewParser(maxFrameBytes int) *Parser {
	if maxFrameBytes <= 0 {
		maxFrameBytes = DefaultMaxFrameBytes
	}
	return &Parser{maxUnits: maxFrameBytes}
}

// Feed adds bytes and returns the frames they completed.
func (p *Parser) Feed(chunk []byte) ([]Frame, error) {
	data := chunk
	if len(p.partial) > 0 {
		data = append(p.partial, chunk...)
		p.partial = nil
	}
	end := len(data)
	// Hold back an incomplete multi-byte sequence at the end.
	for back := 1; back <= 3 && back <= len(data); back++ {
		if b := data[len(data)-back]; utf8.RuneStart(b) {
			if !utf8.FullRune(data[len(data)-back:]) {
				end = len(data) - back
			}
			break
		}
	}
	if end < len(data) {
		p.partial = append([]byte(nil), data[end:]...)
	}
	p.append(string(data[:end]))
	return p.drain()
}

// Finish flushes the decoder at the end of the stream. A frame without its blank line is dropped.
func (p *Parser) Finish() ([]Frame, error) {
	if len(p.partial) > 0 {
		p.partial = nil
		p.append("�")
	}
	return p.drain()
}

func (p *Parser) append(text string) {
	text = strings.ToValidUTF8(text, "�")
	// A byte order mark opens the stream and is not content (the reference's TextDecoder drops it);
	// a later U+FEFF is ordinary text. Nothing is "started" until some text exists, so a mark whose
	// bytes were split across chunks is still recognised.
	if !p.started && text != "" {
		p.started = true
		text = strings.TrimPrefix(text, "\ufeff")
	}
	p.buffer += text
	for _, r := range text {
		if r >= 0x10000 {
			p.units += 2
		} else {
			p.units++
		}
	}
}

func (p *Parser) drain() ([]Frame, error) {
	if p.units > p.maxUnits {
		return nil, ErrStreamFrameTooLarge
	}
	var frames []Frame
	buf := p.buffer
	offset := 0
	for {
		start, end := blankLine(buf, offset+p.scanFrom)
		if start < 0 {
			break
		}
		if frame, ok := parseFrame(buf[offset:start]); ok {
			frames = append(frames, frame)
		}
		offset = end
		p.scanFrom = 0
	}
	if offset > 0 {
		consumed := buf[:offset]
		for _, r := range consumed {
			if r >= 0x10000 {
				p.units -= 2
			} else {
				p.units--
			}
		}
		p.buffer = buf[offset:]
	}
	// Nothing before the last few bytes can start a frame end that is still incomplete.
	p.scanFrom = max(len(p.buffer)-3, 0)
	return frames, nil
}

// blankLine finds the leftmost match of /\r?\n\r?\n/ at or after from, as [start, end), or -1.
func blankLine(s string, from int) (int, int) {
	for from < len(s) {
		i := strings.IndexByte(s[from:], '\n')
		if i < 0 {
			return -1, -1
		}
		p := from + i
		switch {
		case strings.HasPrefix(s[p+1:], "\n"):
			return startOf(s, p), p + 2
		case strings.HasPrefix(s[p+1:], "\r\n"):
			return startOf(s, p), p + 3
		}
		from = p + 1
	}
	return -1, -1
}

func startOf(s string, newline int) int {
	if newline > 0 && s[newline-1] == '\r' {
		return newline - 1
	}
	return newline
}

func parseFrame(frame string) (Frame, bool) {
	event := "message"
	var data []string
	for {
		line, rest, more := strings.Cut(frame, "\n")
		if more {
			line = strings.TrimSuffix(line, "\r")
		}
		if strings.HasPrefix(line, "event:") {
			event = trim(line[len("event:"):])
		}
		if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(line[len("data:"):], " "))
		}
		if !more {
			break
		}
		frame = rest
	}
	if len(data) == 0 {
		return Frame{}, false
	}
	return Frame{Event: event, Data: strings.Join(data, "\n")}, true
}
