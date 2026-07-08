// Context injector: prepends user-authored context files (soul.md, agent.md, …)
// into the system message of the final request body, just before dispatch.
// Format-aware — mirrors open-sse/rtk/caveman.js so it works for both
// translated and native-passthrough flows across every provider.

import { FORMATS } from "../translator/formats.js";

const SEP = "\n\n";

export function injectContextFiles(body, format, text) {
  if (!body || !text || typeof text !== "string") return;

  switch (format) {
    case FORMATS.CLAUDE:
      injectClaudeSystem(body, text);
      return;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
    case FORMATS.ANTIGRAVITY:
      injectGeminiSystem(body, text);
      return;
    default:
      injectMessagesSystem(body, text);
  }
}

// OpenAI-shaped: messages[] (chat) or input[] (responses) or instructions (string)
function injectMessagesSystem(body, text) {
  if (typeof body.instructions === "string") {
    body.instructions = body.instructions ? `${text}${SEP}${body.instructions}` : text;
    return;
  }

  const arr = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!arr) return;

  const idx = arr.findIndex(m => m && (m.role === "system" || m.role === "developer"));
  if (idx >= 0) {
    prependToOpenAIMessage(arr[idx], text);
  } else {
    arr.unshift({ role: "system", content: text });
  }
}

function prependToOpenAIMessage(msg, text) {
  if (typeof msg.content === "string") {
    msg.content = `${text}${SEP}${msg.content}`;
  } else if (Array.isArray(msg.content)) {
    msg.content.unshift({ type: "input_text", text });
  } else {
    msg.content = text;
  }
}

// Claude shape: body.system as string | array of {type:"text", text}
function injectClaudeSystem(body, text) {
  if (typeof body.system === "string" && body.system.length > 0) {
    body.system = `${text}${SEP}${body.system}`;
    return;
  }
  if (Array.isArray(body.system)) {
    body.system.unshift({ type: "text", text });
    return;
  }
  body.system = text;
}

// Gemini shape: body.system_instruction | systemInstruction | body.request.systemInstruction
function injectGeminiSystem(body, text) {
  const target = body.request && typeof body.request === "object" ? body.request : body;
  const useSnake = Object.prototype.hasOwnProperty.call(target, "system_instruction");
  const key = useSnake ? "system_instruction" : "systemInstruction";
  const sys = target[key];
  if (sys && Array.isArray(sys.parts)) {
    sys.parts.unshift({ text });
    return;
  }
  target[key] = { parts: [{ text }] };
}
