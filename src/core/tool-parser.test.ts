import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
    parseToolsAndThinking,
    toOpenAIToolCalls,
    toToolCallXml,
    StreamingToolBuffer,
} from "./tool-parser.js";
import type { ParsedToolCall } from "../infra/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeToolCallXml(id: string, name: string, args: string): string {
    return `<tool_call id="${id}" name="${name}">${args}</tool_call>`;
}

function makeToolCallXmlWithExtras(
    id: string, name: string, args: string, extras: Record<string, string>,
): string {
    const extraAttrs = Object.entries(extras).map(([k, v]) => `${k}="${v}"`).join(" ");
    return `<tool_call id="${id}" name="${name}" ${extraAttrs}>${args}</tool_call>`;
}

function streamInChunks(chunks: string[]): { text: string; toolCalls: ParsedToolCall[] } {
    const buf = new StreamingToolBuffer();
    let text = "";
    const toolCalls: ParsedToolCall[] = [];
    for (const chunk of chunks) {
        const result = buf.push(chunk);
        text += result.text;
        toolCalls.push(...result.completedCalls);
    }
    text += buf.flush();
    return { text, toolCalls };
}

function splitIntoChunks(text: string, sizes: number[]): string[] {
    const chunks: string[] = [];
    let pos = 0;
    let sizeIdx = 0;
    while (pos < text.length) {
        const size = Math.max(1, sizes[sizeIdx % sizes.length]);
        chunks.push(text.slice(pos, pos + size));
        pos += size;
        sizeIdx++;
    }
    return chunks;
}

// ── fast-check arbitraries ────────────────────────────────────────────────────

const arbToolId = fc.stringMatching(/^[a-z0-9_]{1,20}$/).map((s) => `call_${s}`);
const arbToolName = fc.stringMatching(/^[a-zA-Z]{1,20}$/);
const arbJsonArgs = fc
    .dictionary(
        fc.stringMatching(/^[a-z]{1,10}$/),
        fc.oneof(fc.stringMatching(/^[a-zA-Z0-9 ]{0,20}$/), fc.integer(), fc.boolean()),
        { minKeys: 1, maxKeys: 5 },
    )
    .map((obj) => JSON.stringify(obj));
const arbSafeText = fc
    .stringMatching(/^[a-zA-Z0-9 .,!?;:\n]{0,100}$/)
    .filter((s) => !s.includes("<tool") && !s.includes("</tool"));
const arbToolCallXml = fc
    .tuple(arbToolId, arbToolName, arbJsonArgs)
    .map(([id, name, args]) => ({ xml: makeToolCallXml(id, name, args), id, name, args }));
const arbChunkSizes = fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 100 });

// ── Unit Tests: parseToolsAndThinking ─────────────────────────────────────────

describe("parseToolsAndThinking", () => {
    it("returns empty for plain text", () => {
        const r = parseToolsAndThinking("Hello world");
        expect(r.text).toBe("Hello world");
        expect(r.toolCalls).toHaveLength(0);
        expect(r.thinking).toBeNull();
    });

    it("extracts a single tool call", () => {
        const r = parseToolsAndThinking(makeToolCallXml("c1", "read", '{"path":"test.md"}'));
        expect(r.text).toBe("");
        expect(r.toolCalls).toHaveLength(1);
        expect(r.toolCalls[0]).toMatchObject({ id: "c1", name: "read" });
    });

    it("extracts multiple tool calls with text between", () => {
        const text = "Before. " + makeToolCallXml("c1", "read", '{"f":1}') + " Middle. " + makeToolCallXml("c2", "write", '{"f":2}');
        const r = parseToolsAndThinking(text);
        expect(r.toolCalls).toHaveLength(2);
        expect(r.text).toBe("Before.  Middle.");
    });

    it("handles extra attributes", () => {
        const r = parseToolsAndThinking(makeToolCallXmlWithExtras("c1", "Glob", '{"p":"*.ts"}', { description: "Find" }));
        expect(r.toolCalls).toHaveLength(1);
        expect(r.toolCalls[0].name).toBe("Glob");
    });

    it("handles reversed attribute order", () => {
        const r = parseToolsAndThinking('<tool_call name="write" id="c1">{"x":1}</tool_call>');
        expect(r.toolCalls).toHaveLength(1);
        expect(r.toolCalls[0]).toMatchObject({ id: "c1", name: "write" });
    });

    it("handles Anthropic-style IDs", () => {
        const r = parseToolsAndThinking(makeToolCallXml("toolu_01UECYGHTnGHfHoJJ5VZe6bD", "read", '{"f":"/test"}'));
        expect(r.toolCalls[0].id).toBe("toolu_01UECYGHTnGHfHoJJ5VZe6bD");
    });

    it("handles newlines inside tool call body", () => {
        const r = parseToolsAndThinking('<tool_call id="c1" name="read">{"f": "/test"}\n\n</tool_call>');
        expect(r.toolCalls).toHaveLength(1);
        expect(JSON.parse(r.toolCalls[0].arguments)).toEqual({ f: "/test" });
    });

    it("extracts thinking tags", () => {
        const r = parseToolsAndThinking("<think>Hmm...</think>Answer.");
        expect(r.thinking).toBe("Hmm...");
        expect(r.text).toBe("Answer.");
    });

    it("handles malformed JSON in arguments", () => {
        const r = parseToolsAndThinking('<tool_call id="c1" name="read">not json</tool_call>');
        expect(r.toolCalls).toHaveLength(1);
        expect(JSON.parse(r.toolCalls[0].arguments)).toBe("not json");
    });
});

// ── Unit Tests: StreamingToolBuffer ───────────────────────────────────────────

describe("StreamingToolBuffer", () => {
    it("passes through plain text", () => {
        const r = streamInChunks(["Hello ", "world!"]);
        expect(r.text).toBe("Hello world!");
        expect(r.toolCalls).toHaveLength(0);
    });

    it("extracts tool call in one chunk", () => {
        const r = streamInChunks([makeToolCallXml("c1", "read", '{"f":"test"}')]);
        expect(r.text).toBe("");
        expect(r.toolCalls).toHaveLength(1);
    });

    it("extracts tool call split into single characters", () => {
        const xml = makeToolCallXml("c1", "read", '{"f":"test"}');
        const r = streamInChunks(xml.split(""));
        expect(r.text).toBe("");
        expect(r.toolCalls).toHaveLength(1);
        expect(r.toolCalls[0]).toMatchObject({ id: "c1", name: "read" });
    });

    it("handles text before and after tool call", () => {
        const text = "Before. " + makeToolCallXml("c1", "read", '{"f":1}') + " After.";
        const r = streamInChunks(splitIntoChunks(text, [3, 7, 5]));
        expect(r.toolCalls).toHaveLength(1);
        expect(r.text).toBe("Before.  After.");
    });

    it("handles multiple tool calls", () => {
        const text = makeToolCallXml("c1", "read", '{"f":1}') + "mid" + makeToolCallXml("c2", "write", '{"f":2}');
        const r = streamInChunks(splitIntoChunks(text, [5, 3, 8]));
        expect(r.toolCalls).toHaveLength(2);
        expect(r.text).toBe("mid");
    });

    it("handles extra attributes in streamed tool calls", () => {
        const xml = makeToolCallXmlWithExtras("c1", "Glob", '{"p":"*.ts"}', { description: "Find" });
        const r = streamInChunks(splitIntoChunks(xml, [4, 6, 3]));
        expect(r.toolCalls).toHaveLength(1);
        expect(r.toolCalls[0].name).toBe("Glob");
    });

    it("does not leak partial tag prefixes", () => {
        const xml = makeToolCallXml("c1", "read", '{"f":1}');
        const r = streamInChunks(["<tool", xml.slice(5)]);
        expect(r.text).toBe("");
        expect(r.toolCalls).toHaveLength(1);
    });

    it("emits non-tool-call angle brackets as text", () => {
        const r = streamInChunks(["<div>", "hello", "</div>"]);
        expect(r.text).toBe("<div>hello</div>");
        expect(r.toolCalls).toHaveLength(0);
    });

    it("handles the exact real-world streaming pattern", () => {
        const deltas = ["<tool", "_call id", '="call', "_1", '" name="read">{"', "fil", 'ePath": "package.json"}', "</tool_call>"];
        const r = streamInChunks(deltas);
        expect(r.text).toBe("");
        expect(r.toolCalls).toHaveLength(1);
        expect(r.toolCalls[0].name).toBe("read");
    });
});

// ── Unit Tests: toOpenAIToolCalls ─────────────────────────────────────────────

describe("toOpenAIToolCalls", () => {
    it("converts with incrementing index", () => {
        const calls: ParsedToolCall[] = [
            { id: "c1", name: "read", arguments: '{"f":1}' },
            { id: "c2", name: "write", arguments: '{"f":2}' },
        ];
        const r = toOpenAIToolCalls(calls);
        expect(r[0]).toMatchObject({ index: 0, type: "function", function: { name: "read" } });
        expect(r[1]).toMatchObject({ index: 1, type: "function", function: { name: "write" } });
    });
});

// ── Property-Based Tests ──────────────────────────────────────────────────────

/**
 * Property 1: Streaming/non-streaming equivalence for tool calls
 *
 * For any input text containing well-formed tool calls, splitting the text
 * into arbitrary chunks and processing through StreamingToolBuffer must
 * produce the SAME tool calls as the single-pass parseToolsAndThinking.
 */
describe("Property 1: Streaming/non-streaming tool call equivalence", () => {
    it("streaming produces same tool calls as non-streaming for any chunking", () => {
        fc.assert(
            fc.property(
                fc.array(fc.tuple(arbSafeText, arbToolCallXml), { minLength: 1, maxLength: 3 }),
                arbSafeText,
                arbChunkSizes,
                (segments, trailing, chunkSizes) => {
                    const fullText = segments.map(([txt, tc]) => txt + tc.xml).join("") + trailing;
                    const nonStreaming = parseToolsAndThinking(fullText);
                    const streaming = streamInChunks(splitIntoChunks(fullText, chunkSizes));

                    expect(streaming.toolCalls.length).toBe(nonStreaming.toolCalls.length);
                    for (let i = 0; i < nonStreaming.toolCalls.length; i++) {
                        expect(streaming.toolCalls[i].id).toBe(nonStreaming.toolCalls[i].id);
                        expect(streaming.toolCalls[i].name).toBe(nonStreaming.toolCalls[i].name);
                        expect(streaming.toolCalls[i].arguments).toBe(nonStreaming.toolCalls[i].arguments);
                    }
                },
            ),
            { numRuns: 200 },
        );
    });
});

/**
 * Property 2: Streaming/non-streaming equivalence for text content
 *
 * The accumulated text from streaming must equal the text from non-streaming.
 * No XML should leak as text, no legitimate text should be swallowed.
 */
describe("Property 2: Streaming/non-streaming text equivalence", () => {
    it("streaming produces same text as non-streaming for any chunking", () => {
        fc.assert(
            fc.property(
                fc.array(fc.tuple(arbSafeText, arbToolCallXml), { minLength: 1, maxLength: 3 }),
                arbSafeText,
                arbChunkSizes,
                (segments, trailing, chunkSizes) => {
                    const fullText = segments.map(([txt, tc]) => txt + tc.xml).join("") + trailing;
                    const nonStreaming = parseToolsAndThinking(fullText);
                    const streaming = streamInChunks(splitIntoChunks(fullText, chunkSizes));
                    expect(streaming.text.trim()).toBe(nonStreaming.text);
                },
            ),
            { numRuns: 200 },
        );
    });
});

/**
 * Property 3: No XML leakage in streaming output
 *
 * Text emitted by the streaming buffer must NEVER contain <tool_call or
 * </tool_call> substrings. These must always be parsed into structured objects.
 */
describe("Property 3: No XML leakage in streaming", () => {
    it("emitted text never contains tool_call XML tags", () => {
        fc.assert(
            fc.property(
                fc.array(fc.tuple(arbSafeText, arbToolCallXml), { minLength: 1, maxLength: 3 }),
                arbSafeText,
                arbChunkSizes,
                (segments, trailing, chunkSizes) => {
                    const fullText = segments.map(([txt, tc]) => txt + tc.xml).join("") + trailing;
                    const chunks = splitIntoChunks(fullText, chunkSizes);
                    const buf = new StreamingToolBuffer();
                    for (const chunk of chunks) {
                        const result = buf.push(chunk);
                        expect(result.text).not.toContain("<tool_call");
                        expect(result.text).not.toContain("</tool_call>");
                    }
                    const flushed = buf.flush();
                    expect(flushed).not.toContain("<tool_call");
                    expect(flushed).not.toContain("</tool_call>");
                },
            ),
            { numRuns: 200 },
        );
    });
});

/**
 * Property 4: Round-trip XML reconstruction
 *
 * parse → toXml → parse must yield identical tool calls.
 */
describe("Property 4: Round-trip XML reconstruction", () => {
    it("parse then reconstruct then parse yields same calls", () => {
        fc.assert(
            fc.property(
                fc.array(arbToolCallXml, { minLength: 1, maxLength: 5 }),
                (toolCalls) => {
                    const xml = toolCalls.map((tc) => tc.xml).join("");
                    const p1 = parseToolsAndThinking(xml);
                    const p2 = parseToolsAndThinking(toToolCallXml(p1.toolCalls));
                    expect(p2.toolCalls.length).toBe(p1.toolCalls.length);
                    for (let i = 0; i < p1.toolCalls.length; i++) {
                        expect(p2.toolCalls[i].id).toBe(p1.toolCalls[i].id);
                        expect(p2.toolCalls[i].name).toBe(p1.toolCalls[i].name);
                        expect(p2.toolCalls[i].arguments).toBe(p1.toolCalls[i].arguments);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

/**
 * Property 5: Plain text passthrough
 *
 * Text without tool_call patterns passes through both paths unchanged.
 */
describe("Property 5: Plain text passthrough", () => {
    it("text without tool calls passes through unchanged", () => {
        fc.assert(
            fc.property(arbSafeText, arbChunkSizes, (text, chunkSizes) => {
                const nonStreaming = parseToolsAndThinking(text);
                expect(nonStreaming.toolCalls).toHaveLength(0);
                expect(nonStreaming.text).toBe(text.trim());

                const streaming = streamInChunks(splitIntoChunks(text, chunkSizes));
                expect(streaming.toolCalls).toHaveLength(0);
                expect(streaming.text.trim()).toBe(text.trim());
            }),
            { numRuns: 200 },
        );
    });
});

/**
 * Property 6: Single-character streaming (worst case)
 *
 * Character-by-character streaming must produce identical results to
 * non-streaming. This is the hardest case for the buffer.
 */
describe("Property 6: Single-character streaming", () => {
    it("char-by-char streaming matches non-streaming", () => {
        fc.assert(
            fc.property(
                fc.array(fc.tuple(arbSafeText, arbToolCallXml), { minLength: 1, maxLength: 2 }),
                arbSafeText,
                (segments, trailing) => {
                    const fullText = segments.map(([txt, tc]) => txt + tc.xml).join("") + trailing;
                    const nonStreaming = parseToolsAndThinking(fullText);
                    const streaming = streamInChunks(fullText.split(""));

                    expect(streaming.toolCalls.length).toBe(nonStreaming.toolCalls.length);
                    for (let i = 0; i < nonStreaming.toolCalls.length; i++) {
                        expect(streaming.toolCalls[i].id).toBe(nonStreaming.toolCalls[i].id);
                        expect(streaming.toolCalls[i].name).toBe(nonStreaming.toolCalls[i].name);
                        expect(streaming.toolCalls[i].arguments).toBe(nonStreaming.toolCalls[i].arguments);
                    }
                    expect(streaming.text.trim()).toBe(nonStreaming.text);
                },
            ),
            { numRuns: 100 },
        );
    });
});
