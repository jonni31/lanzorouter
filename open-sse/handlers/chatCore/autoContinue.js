/**
 * Auto-continue for truncated responses.
 * 
 * When a free model hits its output token limit (finish_reason: "length"),
 * this module automatically sends continuation requests so the model can
 * finish its work without the user having to manually prompt "continue".
 * 
 * Works by wrapping the final SSE ReadableStream: it monitors for
 * finish_reason, suppresses premature [DONE], makes continuation requests
 * through the full translation+execution pipeline, and streams them
 * seamlessly to the client.
 */

import { translateRequest } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { needsTranslation } from "../../translator/index.js";
import { FORMATS } from "../../translator/formats.js";

const MAX_CONTINUATIONS = 5;
const CONTINUE_PROMPT = "Continue exactly where you left off. Do not repeat any previous content.";

/**
 * Wrap a streaming response body with auto-continue logic.
 * 
 * @param {ReadableStream} originalBody - The already-translated SSE stream body
 * @param {object} opts - Configuration
 * @param {Function} opts.makeContinuationResponse - async (accContent) => ReadableStream|null
 * @param {object} opts.log - Logger
 * @returns {ReadableStream} Wrapped stream with auto-continue
 */
export function wrapWithAutoContinue(originalBody, { makeContinuationResponse, log }) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let reader = originalBody.getReader();
  let continuations = 0;
  let accContent = "";
  let eventBuffer = ""; // Buffer for incomplete SSE events
  let lastFinishReason = null;
  let heldEvents = []; // Events held back when finish_reason is "length"

  return new ReadableStream({
    async pull(controller) {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // Current stream ended
            if (lastFinishReason === "length" && continuations < MAX_CONTINUATIONS) {
              continuations++;
              log?.info?.("AUTOCONTINUE", `Continuation ${continuations}/${MAX_CONTINUATIONS} | ${accContent.length} chars so far`);

              const contStream = await makeContinuationResponse(accContent);
              if (contStream) {
                // Switch to continuation reader, discard held events (finish+[DONE])
                reader = contStream.getReader();
                heldEvents = [];
                lastFinishReason = null;
                eventBuffer = "";
                continue; // Read from continuation
              }

              log?.warn?.("AUTOCONTINUE", `Continuation ${continuations} failed, flushing`);
            }

            // Truly done — flush any held events
            for (const evt of heldEvents) {
              controller.enqueue(encoder.encode(evt));
            }
            heldEvents = [];

            // Flush remaining buffer
            if (eventBuffer.trim()) {
              controller.enqueue(encoder.encode(eventBuffer));
            }

            controller.close();
            return;
          }

          // Decode chunk and add to buffer
          const text = decoder.decode(value, { stream: true });
          eventBuffer += text;

          // Split into complete SSE events (separated by double newline)
          const parts = eventBuffer.split("\n\n");
          eventBuffer = parts.pop() || ""; // Keep incomplete part

          for (const part of parts) {
            const event = part.trim();
            if (!event) continue;

            const eventWithDelimiter = part + "\n\n";

            // Check for [DONE]
            if (event === "data: [DONE]") {
              if (lastFinishReason === "length" && continuations < MAX_CONTINUATIONS) {
                // Hold back [DONE] — we'll continue instead
                heldEvents.push(eventWithDelimiter);
                continue;
              }
              // Forward [DONE]
              controller.enqueue(encoder.encode(eventWithDelimiter));
              continue;
            }

            // Parse data lines for finish_reason and content
            for (const line of event.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;
              try {
                const parsed = JSON.parse(jsonStr);
                // OpenAI format
                const choice = parsed.choices?.[0];
                if (choice) {
                  if (choice.finish_reason) lastFinishReason = choice.finish_reason;
                  const content = choice.delta?.content;
                  if (content && typeof content === "string") accContent += content;
                }
                // Claude format (message_delta with stop_reason)
                if (parsed.type === "message_delta" && parsed.delta?.stop_reason) {
                  lastFinishReason = parsed.delta.stop_reason === "max_tokens" ? "length" : parsed.delta.stop_reason;
                }
                // Content block delta
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  accContent += parsed.delta.text;
                }
              } catch { /* ignore parse errors */ }
            }

            // If finish_reason just became "length", hold this event back
            if (lastFinishReason === "length") {
              heldEvents.push(eventWithDelimiter);
              continue;
            }

            // If we had held events but finish_reason isn't "length", flush them first
            if (heldEvents.length > 0) {
              for (const held of heldEvents) {
                controller.enqueue(encoder.encode(held));
              }
              heldEvents = [];
            }

            // Forward event normally
            controller.enqueue(encoder.encode(eventWithDelimiter));
          }

          return; // Return after processing to respect backpressure
        }
      } catch (err) {
        log?.error?.("AUTOCONTINUE", `Stream error: ${err.message}`);
        // Flush held events and close
        for (const evt of heldEvents) {
          controller.enqueue(encoder.encode(evt));
        }
        try { controller.close(); } catch { /* already closed */ }
      }
    },

    cancel(reason) {
      reader.cancel(reason);
    }
  });
}

/**
 * Create a continuation response stream through the full pipeline.
 * 
 * @param {object} opts
 * @param {string} accContent - Accumulated assistant content so far
 * @param {object} opts.body - Original client request body (pre-translation)
 * @param {string} opts.sourceFormat - Client's format
 * @param {string} opts.targetFormat - Provider's format
 * @param {string} opts.upstreamModel - Model ID for the provider
 * @param {object} opts.credentials - Provider credentials
 * @param {string} opts.provider - Provider ID
 * @param {object} opts.executor - Provider executor
 * @param {AbortSignal} opts.signal - Abort signal
 * @param {object} opts.log - Logger
 * @param {object} opts.proxyOptions - Proxy config
 * @param {string} opts.userAgent - Client user agent
 * @param {string} opts.connectionId - Connection ID
 * @param {string} opts.apiKey - API key
 * @returns {ReadableStream|null} Translated SSE stream or null on failure
 */
export async function makeContinuationStream(accContent, {
  body, sourceFormat, targetFormat, upstreamModel,
  credentials, provider, executor, signal, log, proxyOptions,
  userAgent, connectionId, apiKey
}) {
  try {
    // Build continuation messages in client format
    const contMessages = [...(body.messages || [])];
    contMessages.push({ role: "assistant", content: accContent });
    contMessages.push({ role: "user", content: CONTINUE_PROMPT });

    const contBody = { ...body, messages: contMessages, stream: true };

    // Translate to provider format
    const translatedBody = translateRequest(
      sourceFormat, targetFormat, upstreamModel,
      contBody, true, credentials, provider,
      null, [], connectionId, null
    );
    if (!translatedBody) {
      log?.warn?.("AUTOCONTINUE", "Translation failed for continuation");
      return null;
    }
    delete translatedBody._toolNameMap;
    translatedBody.model = upstreamModel;

    // Execute request
    const result = await executor.execute({
      model: upstreamModel,
      body: translatedBody,
      stream: true,
      credentials,
      signal,
      log,
      proxyOptions
    });

    if (!result.response.ok) {
      log?.warn?.("AUTOCONTINUE", `Provider returned ${result.response.status} for continuation`);
      return null;
    }

    // Create transform stream to translate provider response to client format
    const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
    const isCodexTranslation = provider === "codex" && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

    let transformStream;
    if (isCodexTranslation) {
      let codexTarget;
      if (sourceFormat === FORMATS.OPENAI_RESPONSES) codexTarget = FORMATS.OPENAI_RESPONSES;
      else if (sourceFormat === FORMATS.CLAUDE) codexTarget = FORMATS.CLAUDE;
      else if ([FORMATS.ANTIGRAVITY, FORMATS.GEMINI, FORMATS.GEMINI_CLI].includes(sourceFormat)) codexTarget = FORMATS.ANTIGRAVITY;
      else codexTarget = FORMATS.OPENAI;
      transformStream = createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, null, null, upstreamModel, connectionId, contBody, null, apiKey);
    } else if (needsTranslation(targetFormat, sourceFormat)) {
      transformStream = createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, null, null, upstreamModel, connectionId, contBody, null, apiKey);
    } else {
      transformStream = createPassthroughStreamWithLogger(provider, null, upstreamModel, connectionId, contBody, null, apiKey);
    }

    // Pipe through transform
    return result.response.body.pipeThrough(transformStream);

  } catch (err) {
    log?.error?.("AUTOCONTINUE", `Continuation error: ${err.message}`);
    return null;
  }
}
