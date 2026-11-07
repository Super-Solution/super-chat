// SPDX-License-Identifier: Apache-2.0

package protocol

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// Values are decoded JSON: map[string]any, []any, string, float64, bool and nil. A missing key is
// reported separately from null, because the TypeScript reference tells `undefined` from `null`.

// jsWhitespace is what String.prototype.trim removes.
const jsWhitespace = "\t\n\v\f\r                  　\uFEFF"

func trim(s string) string { return strings.Trim(s, jsWhitespace) }

// get is `obj[key]`; present is false when obj is not an object or has no such key.
func get(obj any, key string) (value any, present bool) {
	if m, ok := obj.(map[string]any); ok {
		value, present = m[key]
	}
	return
}

func isObject(v any) bool { _, ok := v.(map[string]any); return ok }

func isString(v any) bool { _, ok := v.(string); return ok }

func asString(v any) (string, bool) { s, ok := v.(string); return s, ok }

func finite(v any) bool {
	f, ok := v.(float64)
	return ok && !math.IsNaN(f) && !math.IsInf(f, 0)
}

func isInteger(v any) bool { return finite(v) && v.(float64) == math.Trunc(v.(float64)) }

func isSafeInteger(v any) bool { return isInteger(v) && math.Abs(v.(float64)) <= 9007199254740991 }

func equalsNumber(v any, expected float64) bool {
	f, ok := v.(float64)
	return ok && f == expected
}

// jsLength is `s.length`: UTF-16 code units, so a character outside the BMP counts twice.
func jsLength(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func matches(re *regexp.Regexp, v any) bool {
	s, ok := v.(string)
	return ok && re.MatchString(s)
}

var (
	schemeRe   = regexp.MustCompile(`(?i)^https?:`)
	ipv6Re     = regexp.MustCompile(`^\[[0-9A-Fa-f:.]+\]$`)
	hostBanned = "\x00\t\n\r #/:<>?@[\\]^|%\x7f"
)

// isHTTPURL reports whether `new URL(s)` succeeds with an http or https scheme. It covers what a
// base URL realistically is: scheme, optional credentials, a host (name, IPv4 or bracketed IPv6)
// and an optional port, with the WHATWG leniency about extra slashes. Percent-encoded and
// internationalised hosts are not reproduced.
func isHTTPURL(s string) bool {
	s = strings.TrimFunc(s, func(r rune) bool { return r <= 0x20 })
	s = strings.NewReplacer("\t", "", "\n", "", "\r", "").Replace(s)
	loc := schemeRe.FindStringIndex(s)
	if loc == nil {
		return false
	}
	rest := strings.TrimLeft(s[loc[1]:], `/\`)
	if i := strings.IndexAny(rest, `/\?#`); i != -1 {
		rest = rest[:i]
	}
	hostport := rest[strings.LastIndex(rest, "@")+1:]
	if strings.HasPrefix(hostport, "[") {
		closeIdx := strings.Index(hostport, "]")
		if closeIdx == -1 || !ipv6Re.MatchString(hostport[:closeIdx+1]) {
			return false
		}
		port := hostport[closeIdx+1:]
		return port == "" || (strings.HasPrefix(port, ":") && validPort(port[1:]))
	}
	host, port, hasPort := strings.Cut(hostport, ":")
	if host == "" {
		return false
	}
	for _, r := range host {
		if r < 0x20 || strings.ContainsRune(hostBanned, r) {
			return false
		}
	}
	return !hasPort || validPort(port)
}

func validPort(p string) bool {
	if p == "" {
		return true
	}
	for i := 0; i < len(p); i++ {
		if p[i] < '0' || p[i] > '9' {
			return false
		}
	}
	n, err := strconv.ParseUint(p, 10, 64)
	return err == nil && n <= 65535
}
