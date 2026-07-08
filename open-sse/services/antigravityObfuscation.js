/**
 * Sensitive word obfuscation for Antigravity requests.
 *
 * Google's Antigravity backend scans request bodies for third-party coding-tool
 * names (OpenCode, Cursor, Claude Code, etc.). Requests carrying those names are
 * a signal used to flag/ban accounts. We insert a zero-width joiner (U+200D) after
 * the first character of each match so the word no longer matches a literal grep
 * yet still renders identically to a human reader.
 *
 * Ported from OmniRoute's antigravityObfuscation.ts (which mirrors CLIProxyAPI's
 * cloak system and ZeroGravity's ZEROGRAVITY_SENSITIVE_WORDS).
 */

const ZWJ = "‍";

const DEFAULT_WORDS = [
  "opencode",
  "open-code",
  "cline",
  "roo-cline",
  "roo_cline",
  "cursor",
  "windsurf",
  "aider",
  "continue.dev",
  "copilot",
  "avante",
  "codecompanion",
  "claude code",
  "claude-code",
  "kilo code",
  "kilocode",
  "zevairouter",
  "9router",
];

let words = [...DEFAULT_WORDS];

export function setAntigravitySensitiveWords(w) {
  words = Array.isArray(w) && w.length > 0 ? w : [...DEFAULT_WORDS];
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Per-word regex cache — avoids recompiling one RegExp per word on every request
// body. Global regexes are safe to reuse (String.replace resets lastIndex).
const _obfuscationRegexCache = new Map();
function getObfuscationRegex(word) {
  let regex = _obfuscationRegexCache.get(word);
  if (!regex) {
    if (_obfuscationRegexCache.size > 2000) _obfuscationRegexCache.clear();
    regex = new RegExp(escapeRegex(word), "gi");
    _obfuscationRegexCache.set(word, regex);
  }
  return regex;
}

/**
 * Insert a zero-width joiner after the first character of every sensitive word
 * found in `text`. Single-character matches are left untouched.
 */
export function obfuscateSensitiveWords(text) {
  if (!text || words.length === 0) return text;
  let result = text;
  for (const word of words) {
    if (!word) continue;
    const regex = getObfuscationRegex(word);
    result = result.replace(regex, (m) => (m.length <= 1 ? m : m[0] + ZWJ + m.slice(1)));
  }
  return result;
}

/**
 * Obfuscate sensitive words inside a JSON-serializable request body by
 * round-tripping through its string form. Returns a new object; the input is
 * not mutated. Falls back to the original body if (de)serialization fails.
 */
export function obfuscateRequestBody(body) {
  if (body == null || typeof body !== "object") return body;
  try {
    const serialized = JSON.stringify(body);
    const obfuscated = obfuscateSensitiveWords(serialized);
    if (obfuscated === serialized) return body;
    return JSON.parse(obfuscated);
  } catch {
    return body;
  }
}

export const __DEFAULT_SENSITIVE_WORDS = DEFAULT_WORDS;
