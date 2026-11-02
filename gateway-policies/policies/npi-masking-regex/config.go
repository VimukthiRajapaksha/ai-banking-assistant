/*
 *  Copyright (c) 2026, WSO2 LLC. (http://www.wso2.org) All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 */

package npimaskingregex

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"
)

// Mode values.
const (
	ModeEnforce = "enforce"
	ModeMonitor = "monitor"
)

// OnError values.
const (
	OnErrorBlock       = "block"
	OnErrorPassThrough = "passThrough"
)

var entityNamePattern = regexp.MustCompile(`^[A-Z][A-Z_]*$`)

// entityConfig is one enabled entity after defaults and overrides are applied.
type entityConfig struct {
	Name            string
	Action          Action
	Keys            []string
	LabelValue      string
	LabelNeedsDigit bool
	// ValueRegex is a custom entity's optional value shape. It is used both as a
	// format detector and as the value shape after a label.
	ValueRegex *regexp.Regexp
}

// policyConfig is the validated, compiled form of the policy parameters. It is
// built once per policy instance in GetPolicy and is read-only afterwards.
type policyConfig struct {
	Mode         string
	OnError      string
	LabelledText bool

	entities        map[string]*entityConfig
	keyIndex        map[string]string // normalised key → entity name
	formatDetectors []formatDetector
	labelDetectors  []labelDetector
	hmacKey         []byte
}

func (c *policyConfig) entity(name string) *entityConfig {
	return c.entities[name]
}

// parseParams parses and validates parameters from map to struct.
func parseParams(params map[string]interface{}) (*policyConfig, error) {
	cfg := &policyConfig{
		Mode:         ModeEnforce,
		OnError:      OnErrorBlock,
		LabelledText: true,
		entities:     make(map[string]*entityConfig),
		keyIndex:     make(map[string]string),
	}

	var err error
	if cfg.Mode, err = parseEnumParam(params, "mode", ModeEnforce, ModeEnforce, ModeMonitor); err != nil {
		return nil, err
	}
	if cfg.OnError, err = parseEnumParam(params, "onError", OnErrorBlock, OnErrorBlock, OnErrorPassThrough); err != nil {
		return nil, err
	}
	if cfg.LabelledText, err = parseBoolParam(params, "labelledText", true); err != nil {
		return nil, err
	}

	// Start from every built-in, enabled with its default action.
	for _, b := range builtinEntities {
		cfg.entities[b.Name] = &entityConfig{
			Name:            b.Name,
			Action:          b.Action,
			Keys:            append([]string(nil), b.Keys...),
			LabelValue:      b.LabelValue,
			LabelNeedsDigit: b.LabelNeedsDigit,
		}
	}

	overrides, err := parseObjectArrayParam(params, "entities")
	if err != nil {
		return nil, err
	}
	seenOverride := make(map[string]bool)
	for i, o := range overrides {
		name, err := requiredString(o, "name", fmt.Sprintf("entities[%d]", i))
		if err != nil {
			return nil, err
		}
		if _, ok := findBuiltinEntity(name); !ok {
			return nil, fmt.Errorf("'entities[%d].name' %q is not a built-in entity", i, name)
		}
		if seenOverride[name] {
			return nil, fmt.Errorf("'entities[%d].name' %q is configured more than once", i, name)
		}
		seenOverride[name] = true

		enabled, err := parseBoolParam(o, "enabled", true)
		if err != nil {
			return nil, fmt.Errorf("'entities[%d]': %w", i, err)
		}
		if !enabled {
			delete(cfg.entities, name)
			continue
		}
		e := cfg.entities[name]
		if action, ok, err := parseAction(o, fmt.Sprintf("entities[%d]", i)); err != nil {
			return nil, err
		} else if ok {
			e.Action = action
		}
		extra, err := parseStringArray(o, "additionalKeys", fmt.Sprintf("entities[%d]", i))
		if err != nil {
			return nil, err
		}
		e.Keys = append(e.Keys, extra...)
	}

	customs, err := parseObjectArrayParam(params, "customEntities")
	if err != nil {
		return nil, err
	}
	for i, c := range customs {
		where := fmt.Sprintf("customEntities[%d]", i)
		name, err := requiredString(c, "name", where)
		if err != nil {
			return nil, err
		}
		if !entityNamePattern.MatchString(name) {
			return nil, fmt.Errorf("'%s.name' must contain only uppercase letters and underscores and start with a letter", where)
		}
		if _, ok := findBuiltinEntity(name); ok {
			return nil, fmt.Errorf("'%s.name' %q clashes with a built-in entity; use 'entities' to change a built-in", where, name)
		}
		if _, ok := cfg.entities[name]; ok {
			return nil, fmt.Errorf("'%s.name' %q is configured more than once", where, name)
		}
		keys, err := parseStringArray(c, "keys", where)
		if err != nil {
			return nil, err
		}
		e := &entityConfig{Name: name, Action: ActionMask, Keys: keys, LabelNeedsDigit: false}
		if action, ok, err := parseAction(c, where); err != nil {
			return nil, err
		} else if ok {
			e.Action = action
		}
		if raw, ok := c["valueRegex"]; ok && raw != nil {
			s, ok := raw.(string)
			if !ok {
				return nil, fmt.Errorf("'%s.valueRegex' must be a string", where)
			}
			if s != "" {
				re, err := regexp.Compile(s)
				if err != nil {
					return nil, fmt.Errorf("'%s.valueRegex' is invalid: %w", where, err)
				}
				e.ValueRegex = re
				e.LabelValue = s
			}
		}
		if len(e.Keys) == 0 && e.ValueRegex == nil {
			return nil, fmt.Errorf("'%s' needs at least one of 'keys' or 'valueRegex'", where)
		}
		cfg.entities[name] = e
	}

	if len(cfg.entities) == 0 {
		return nil, fmt.Errorf("at least one NPI entity must be enabled")
	}

	// A key may identify only one entity, or the same field would be masked
	// under whichever entity happened to be checked first.
	for _, e := range cfg.entities {
		for _, k := range e.Keys {
			nk := normalizeKey(k)
			if nk == "" {
				return nil, fmt.Errorf("entity %q has a key %q that is empty after normalisation", e.Name, k)
			}
			if owner, ok := cfg.keyIndex[nk]; ok && owner != e.Name {
				return nil, fmt.Errorf("key %q is claimed by both %q and %q", k, owner, e.Name)
			}
			cfg.keyIndex[nk] = e.Name
		}
	}

	cfg.formatDetectors = buildFormatDetectors(cfg)
	if cfg.LabelledText {
		if cfg.labelDetectors, err = buildLabelDetectors(cfg); err != nil {
			return nil, err
		}
	}

	hmacKey, err := parseStringParam(params, "hmacKey")
	if err != nil {
		return nil, err
	}
	if hmacKey != "" {
		cfg.hmacKey = []byte(hmacKey)
	} else {
		cfg.hmacKey = fallbackHMACKey()
	}

	return cfg, nil
}

var (
	fallbackKeyOnce sync.Once
	fallbackKey     []byte
)

// fallbackHMACKey returns a random per-process key, used when no hmacKey system
// parameter is configured. Correctness does not depend on the key: each request
// restores only the placeholders it minted itself. A shared, configured key only
// keeps placeholders stable across replicas and restarts.
func fallbackHMACKey() []byte {
	fallbackKeyOnce.Do(func() {
		fallbackKey = make([]byte, 32)
		if _, err := rand.Read(fallbackKey); err != nil {
			panic(fmt.Sprintf("npi-masking-regex: cannot generate a placeholder key: %v", err))
		}
		slog.Warn("NPIMaskingRegex: no hmacKey configured; using a random per-process key, so placeholders differ across replicas and restarts")
	})
	return fallbackKey
}

// normalizeKey lower-cases a JSON key and drops everything outside [a-z0-9], so
// accountNumber, account_number and Account-Number all compare equal.
func normalizeKey(key string) string {
	var b strings.Builder
	b.Grow(len(key))
	for _, r := range strings.ToLower(key) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func parseAction(m map[string]interface{}, where string) (Action, bool, error) {
	raw, ok := m["action"]
	if !ok || raw == nil {
		return "", false, nil
	}
	s, ok := raw.(string)
	if !ok {
		return "", false, fmt.Errorf("'%s.action' must be a string", where)
	}
	switch Action(s) {
	case ActionMask, ActionRedact:
		return Action(s), true, nil
	default:
		return "", false, fmt.Errorf("'%s.action' must be %q or %q", where, ActionMask, ActionRedact)
	}
}

func requiredString(m map[string]interface{}, field, where string) (string, error) {
	s, ok := m[field].(string)
	if !ok || strings.TrimSpace(s) == "" {
		return "", fmt.Errorf("'%s.%s' is required and must be a non-empty string", where, field)
	}
	return strings.TrimSpace(s), nil
}

func parseStringArray(m map[string]interface{}, field, where string) ([]string, error) {
	raw, ok := m[field]
	if !ok || raw == nil {
		return nil, nil
	}
	arr, ok := raw.([]interface{})
	if !ok {
		if strs, ok := raw.([]string); ok {
			return strs, nil
		}
		return nil, fmt.Errorf("'%s.%s' must be an array of strings", where, field)
	}
	out := make([]string, 0, len(arr))
	for i, v := range arr {
		s, ok := v.(string)
		if !ok || strings.TrimSpace(s) == "" {
			return nil, fmt.Errorf("'%s.%s[%d]' must be a non-empty string", where, field, i)
		}
		out = append(out, strings.TrimSpace(s))
	}
	return out, nil
}

// parseObjectArrayParam reads an array-of-objects parameter, accepting either a
// decoded array or a JSON string, as pii-masking-regex does for customPIIEntities.
func parseObjectArrayParam(params map[string]interface{}, name string) ([]map[string]interface{}, error) {
	raw, ok := params[name]
	if !ok || raw == nil {
		return nil, nil
	}
	var arr []interface{}
	switch v := raw.(type) {
	case []interface{}:
		arr = v
	case string:
		if strings.TrimSpace(v) == "" {
			return nil, nil
		}
		if err := json.Unmarshal([]byte(v), &arr); err != nil {
			return nil, fmt.Errorf("error unmarshaling '%s': %w", name, err)
		}
	default:
		return nil, fmt.Errorf("'%s' must be an array or JSON string", name)
	}
	out := make([]map[string]interface{}, 0, len(arr))
	for i, item := range arr {
		obj, ok := item.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("'%s[%d]' must be an object", name, i)
		}
		out = append(out, obj)
	}
	return out, nil
}

func parseEnumParam(params map[string]interface{}, name, def string, allowed ...string) (string, error) {
	raw, ok := params[name]
	if !ok || raw == nil {
		return def, nil
	}
	s, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("'%s' must be a string", name)
	}
	if s == "" {
		return def, nil
	}
	for _, a := range allowed {
		if s == a {
			return s, nil
		}
	}
	return "", fmt.Errorf("'%s' must be one of %s", name, strings.Join(allowed, ", "))
}

func parseBoolParam(params map[string]interface{}, name string, def bool) (bool, error) {
	raw, ok := params[name]
	if !ok || raw == nil {
		return def, nil
	}
	switch v := raw.(type) {
	case bool:
		return v, nil
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "true":
			return true, nil
		case "false":
			return false, nil
		}
	}
	return false, fmt.Errorf("'%s' must be a boolean", name)
}

func parseStringParam(params map[string]interface{}, name string) (string, error) {
	raw, ok := params[name]
	if !ok || raw == nil {
		return "", nil
	}
	s, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("'%s' must be a string", name)
	}
	return s, nil
}
