// SPDX-License-Identifier: Apache-2.0

// Package protocol ports the validators and the SSE parser of @supersolutions/super-protocol.
//
// Every message and the order of the checks match the TypeScript reference in packages/protocol;
// conformance/protocol.v1.json pins that. Inputs are decoded JSON (see jsutil.go).
package protocol

import (
	"fmt"
	"math"
	"regexp"
	"strings"
)

const (
	PluginManifestVersion = 0
	EditorCardKind        = "super-editor.document"
	ChartCardKind         = "super-chart.chart"
)

var (
	// ChartTypes are the chart styles a chart card may ask for.
	ChartTypes = []string{"candles", "hollow-candles", "ohlc", "line", "area", "baseline", "heikin-ashi"}
	surfaces   = []string{"card", "panel", "tool", "canvas"}
	tones      = []string{"bull", "bear", "neutral", "accent"}

	nameRe         = regexp.MustCompile(`^(@[a-z0-9\-~][a-z0-9\-._~]*/)?[a-z0-9\-~][a-z0-9\-._~]*$`)
	semverRe       = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.\-]+)?(\+[0-9A-Za-z.\-]+)?$`)
	capabilityIDRe = regexp.MustCompile(`^[a-z][a-z0-9\-]*(\.[a-z][a-z0-9\-]*)+$`)
)

const (
	maxBars        = 20000
	maxAnnotations = 256
	maxIndicators  = 12
	maxAnchors     = 2
	maxTextLength  = 2048
	maxKeyLength   = 128
	minHeight      = 160
	maxHeight      = 1200
)

// ManifestIssue is one problem found in a plugin manifest.
type ManifestIssue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// CardResult is the outcome of validating a card spec.
type CardResult struct {
	OK       bool   `json:"ok"`
	Error    string `json:"error,omitempty"`
	Expected string `json:"expected,omitempty"`
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// ValidatePluginManifest returns every problem found; an empty slice means the manifest is valid.
func ValidatePluginManifest(value any) []ManifestIssue {
	issues := []ManifestIssue{}
	add := func(path, message string) { issues = append(issues, ManifestIssue{path, message}) }
	if !isObject(value) {
		return []ManifestIssue{{Path: "", Message: "manifest must be an object"}}
	}
	if v, _ := get(value, "manifestVersion"); !equalsNumber(v, PluginManifestVersion) {
		add("manifestVersion", fmt.Sprintf("must be %d", PluginManifestVersion))
	}
	if v, _ := get(value, "name"); !matches(nameRe, v) {
		add("name", "must be a valid npm package name")
	}
	if v, _ := get(value, "version"); !matches(semverRe, v) {
		add("version", "must be a semver string")
	}
	if v, _ := get(value, "license"); !isString(v) || trim(v.(string)) == "" {
		add("license", "must be a non-empty SPDX expression")
	}
	caps, _ := get(value, "capabilities")
	list, isList := caps.([]any)
	if !isList || len(list) == 0 {
		add("capabilities", "must be a non-empty array")
	} else {
		seen := map[string]bool{}
		for i, cap := range list {
			path := fmt.Sprintf("capabilities[%d]", i)
			// `typeof c !== "object"`: arrays pass this test in the reference and fail the field checks.
			switch cap.(type) {
			case map[string]any, []any:
			default:
				add(path, "must be an object")
				continue
			}
			id, _ := get(cap, "id")
			if !matches(capabilityIDRe, id) {
				add(path+".id", "must be a dotted lowercase id such as editor.document")
			} else if seen[id.(string)] {
				add(path+".id", "duplicate capability id")
			} else {
				seen[id.(string)] = true
			}
			surface, _ := get(cap, "surface")
			surfaceName, surfaceIsString := asString(surface)
			if !surfaceIsString || !contains(surfaces, surfaceName) {
				add(path+".surface", "must be one of "+strings.Join(surfaces, ", "))
			}
			cardKind, _ := get(cap, "cardKind")
			toolName, _ := get(cap, "toolName")
			if k, ok := asString(cardKind); surfaceName == "card" && (!ok || k == "") {
				add(path+".cardKind", "is required for card capabilities")
			}
			if n, ok := asString(toolName); surfaceName == "tool" && (!ok || n == "") {
				add(path+".toolName", "is required for tool capabilities")
			}
			if schema, present := get(cap, "inputSchema"); present && !isObject(schema) {
				add(path+".inputSchema", "must be an object")
			}
		}
	}
	if service, present := get(value, "service"); present {
		baseURL, _ := get(service, "baseUrl")
		if s, ok := asString(baseURL); !(isObject(service) && ok && isHTTPURL(s)) {
			add("service.baseUrl", "must be an http(s) URL")
		}
	}
	return issues
}

func fail(message string) CardResult { return CardResult{Error: message} }

func failExpected(message, expected string) CardResult {
	return CardResult{Error: message, Expected: expected}
}

// ValidateEditorCardSpec checks the spec of a `super-editor.document` card.
func ValidateEditorCardSpec(spec any) CardResult {
	if !isObject(spec) {
		return fail("Editor card spec must be an object.")
	}
	if kind, _ := get(spec, "kind"); kind != EditorCardKind {
		return fail(fmt.Sprintf("kind must be %q.", EditorCardKind))
	}
	if title, present := get(spec, "title"); present && !isString(title) {
		return fail("title must be a string.")
	}
	mode, hasMode := get(spec, "mode")
	if hasMode && mode != "view" && mode != "edit" {
		return fail(`mode must be "view" or "edit".`)
	}
	document, hasDocument := get(spec, "document")
	service, hasService := get(spec, "service")
	if hasDocument == hasService {
		return failExpected("Provide exactly one of `document` or `service`.", "document: {...} | service: { baseUrl, documentId }")
	}
	if hasService && mode == "edit" {
		return fail("A service-backed document is read-only for now: use an inline document to edit.")
	}
	if hasDocument {
		version, _ := get(document, "schemaVersion")
		id, _ := get(document, "id")
		title, _ := get(document, "title")
		blocks, _ := get(document, "blocks")
		_, blocksIsList := blocks.([]any)
		if !(isObject(document) && equalsNumber(version, 1) && isString(id) && isString(title) && blocksIsList) {
			return fail("document must be a schemaVersion 1 report document with id, title and blocks.")
		}
	} else {
		baseURL, _ := get(service, "baseUrl")
		documentID, _ := get(service, "documentId")
		u, uOK := asString(baseURL)
		d, dOK := asString(documentID)
		if !(isObject(service) && uOK && dOK && d != "" && isHTTPURL(u)) {
			return fail("service needs an http(s) baseUrl and a documentId.")
		}
	}
	return CardResult{OK: true}
}

// ValidatePeriod returns "" when the period is valid, otherwise the problem.
func ValidatePeriod(v any) string {
	if !isObject(v) {
		return "period must be an object."
	}
	if m, _ := get(v, "multiplier"); !isSafeInteger(m) || m.(float64) <= 0 {
		return "period.multiplier must be a positive integer."
	}
	if t, _ := get(v, "timespan"); !isString(t) || trim(t.(string)) == "" {
		return "period.timespan must be a non-empty string."
	}
	if t, _ := get(v, "text"); !isString(t) || trim(t.(string)) == "" {
		return "period.text must be a non-empty string."
	}
	return ""
}

var symbolStrings = []string{"name", "shortName", "exchange", "market", "priceCurrency", "type", "logo", "timezone"}

// ValidateSymbol returns "" when the symbol is valid, otherwise the problem.
func ValidateSymbol(v any) string {
	if !isObject(v) {
		return "symbol must be an object."
	}
	if t, _ := get(v, "ticker"); !isString(t) || trim(t.(string)) == "" {
		return "symbol.ticker must be a non-empty string."
	}
	for _, k := range symbolStrings {
		if item, present := get(v, k); present && !isString(item) {
			return fmt.Sprintf("symbol.%s must be a string.", k)
		}
	}
	if p, present := get(v, "pricePrecision"); present && p != "auto" && !(isInteger(p) && p.(float64) >= 0 && p.(float64) <= 12) {
		return `symbol.pricePrecision must be an integer from 0 to 12 or "auto".`
	}
	return ""
}

// ValidateMarketBar returns "" when the bar is valid, otherwise the problem.
func ValidateMarketBar(v any) string {
	if !isObject(v) {
		return "a bar must be an object."
	}
	for _, k := range []string{"timestamp", "open", "high", "low", "close"} {
		if x, _ := get(v, k); !finite(x) {
			return fmt.Sprintf("bar.%s must be a finite number.", k)
		}
	}
	if vol, present := get(v, "volume"); present && !finite(vol) {
		return "bar.volume must be a finite number."
	}
	m := v.(map[string]any)
	o, h, l, c := m["open"].(float64), m["high"].(float64), m["low"].(float64), m["close"].(float64)
	if h < max(o, c, l) || l > min(o, c) {
		return "bar high/low must contain open and close."
	}
	return ""
}

// ValidateChartAnnotation returns "" when the annotation is valid, otherwise the problem.
func ValidateChartAnnotation(v any) string {
	if !isObject(v) {
		return "an annotation must be an object."
	}
	key, _ := get(v, "key")
	if k, ok := asString(key); !ok || trim(k) == "" || jsLength(k) > maxKeyLength {
		return fmt.Sprintf("annotation.key must be a non-empty string of at most %d characters.", maxKeyLength)
	}
	if kind, _ := get(v, "kind"); kind != "level" && kind != "zone" && kind != "marker" {
		return `annotation.kind must be "level", "zone" or "marker".`
	}
	kind, _ := get(v, "kind")
	anchorsValue, _ := get(v, "anchors")
	anchors, ok := anchorsValue.([]any)
	if !ok || len(anchors) == 0 || len(anchors) > maxAnchors {
		return "annotation.anchors must hold one or two anchors."
	}
	priced := make([]bool, len(anchors))
	for i, a := range anchors {
		if t, _ := get(a, "time"); !isObject(a) || !finite(t) {
			return "annotation anchors need a finite time."
		}
		price, present := get(a, "price")
		if present && !finite(price) {
			return "annotation anchor price must be a finite number."
		}
		priced[i] = present
	}
	allPriced := true
	for _, p := range priced {
		allPriced = allPriced && p
	}
	switch {
	case kind == "level" && (len(anchors) != 1 || !priced[0]):
		return "a level needs exactly one anchor with a price."
	case kind == "zone" && (len(anchors) != 2 || !allPriced):
		return "a zone needs two anchors, both with a price."
	case kind == "marker" && len(anchors) != 1:
		return "a marker needs exactly one anchor."
	}
	if text, present := get(v, "text"); present {
		if s, ok := asString(text); !ok || jsLength(s) > maxTextLength {
			return fmt.Sprintf("annotation.text must be a string of at most %d characters.", maxTextLength)
		}
	}
	if tone, present := get(v, "tone"); present {
		if s, ok := asString(tone); !ok || !contains(tones, s) {
			return "annotation.tone must be bull, bear, neutral or accent."
		}
	}
	if color, present := get(v, "color"); present {
		if s, ok := asString(color); !ok || jsLength(s) > 128 {
			return "annotation.color must be a short CSS color string."
		}
	}
	return ""
}

// ValidateChartAnnotations returns "" when every annotation is valid and keys are unique.
func ValidateChartAnnotations(v any) string {
	list, ok := v.([]any)
	if !ok {
		return "annotations must be an array."
	}
	if len(list) > maxAnnotations {
		return fmt.Sprintf("at most %d annotations per chart.", maxAnnotations)
	}
	keys := make(map[string]bool, len(list))
	for _, item := range list {
		if problem := ValidateChartAnnotation(item); problem != "" {
			return problem
		}
		key, _ := get(item, "key")
		k := key.(string)
		if keys[k] {
			return fmt.Sprintf("duplicate annotation key %q.", k)
		}
		keys[k] = true
	}
	return ""
}

// ValidateChartCardSpec checks the spec of a `super-chart.chart` card.
func ValidateChartCardSpec(spec any) CardResult {
	if !isObject(spec) {
		return fail("Chart card spec must be an object.")
	}
	if kind, _ := get(spec, "kind"); kind != ChartCardKind {
		return fail(fmt.Sprintf("kind must be %q.", ChartCardKind))
	}
	if id, present := get(spec, "id"); present {
		if s, ok := asString(id); !ok || trim(s) == "" || jsLength(s) > 128 {
			return fail("id must be a non-empty string.")
		}
	}
	if title, present := get(spec, "title"); present && !isString(title) {
		return fail("title must be a string.")
	}
	symbol, _ := get(spec, "symbol")
	period, _ := get(spec, "period")
	problem := ValidateSymbol(symbol)
	if problem == "" {
		problem = ValidatePeriod(period)
	}
	if problem != "" {
		return fail(problem)
	}
	if h, present := get(spec, "height"); present && !(finite(h) && h.(float64) >= minHeight && h.(float64) <= maxHeight) {
		return fail(fmt.Sprintf("height must be %d..%d pixels.", minHeight, maxHeight))
	}
	if t, present := get(spec, "chartType"); present {
		if s, ok := asString(t); !ok || !contains(ChartTypes, s) {
			return fail("chartType must be one of " + strings.Join(ChartTypes, ", ") + ".")
		}
	}
	bars, hasBars := get(spec, "bars")
	feed, hasFeed := get(spec, "feed")
	if hasBars == hasFeed {
		return failExpected("Provide exactly one of `bars` or `feed`.", "bars: [{timestamp, open, high, low, close, volume?}] | feed: { id }")
	}
	if hasBars {
		list, ok := bars.([]any)
		if !ok || len(list) == 0 {
			return fail("bars must be a non-empty array.")
		}
		if len(list) > maxBars {
			return fail(fmt.Sprintf("at most %d inline bars; reference a feed for more.", maxBars))
		}
		previous := math.Inf(-1)
		for _, bar := range list {
			if bad := ValidateMarketBar(bar); bad != "" {
				return fail(bad)
			}
			t := bar.(map[string]any)["timestamp"].(float64)
			if t <= previous {
				return fail("bars must be sorted oldest first with unique timestamps.")
			}
			previous = t
		}
	} else if id, _ := get(feed, "id"); !isObject(feed) || !isString(id) || trim(id.(string)) == "" {
		return fail("feed needs a non-empty id.")
	}
	if indicators, present := get(spec, "indicators"); present {
		list, ok := indicators.([]any)
		if !ok || len(list) > maxIndicators {
			return fail(fmt.Sprintf("indicators must be an array of at most %d.", maxIndicators))
		}
		for _, item := range list {
			if name, _ := get(item, "name"); !isObject(item) || !isString(name) || trim(name.(string)) == "" {
				return fail("each indicator needs a name.")
			}
			if params, present := get(item, "params"); present {
				values, ok := params.([]any)
				if !ok {
					return fail("indicator params must be an array of finite numbers.")
				}
				for _, p := range values {
					if !finite(p) {
						return fail("indicator params must be an array of finite numbers.")
					}
				}
			}
		}
	}
	if annotations, present := get(spec, "annotations"); present {
		if bad := ValidateChartAnnotations(annotations); bad != "" {
			return fail(bad)
		}
	}
	return CardResult{OK: true}
}

// IsTerminalEvent reports whether a stream event type ends a request.
func IsTerminalEvent(eventType string) bool {
	return eventType == "request.completed" || eventType == "request.failed" || eventType == "request.replayed"
}
