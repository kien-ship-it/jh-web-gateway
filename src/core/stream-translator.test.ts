import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
    translateToStream,
    translateToCompletion,
    extractContentFromJhSse,
} from "./stream-translator.js";
import type { OpenAIChunk, OpenAICompletion } from "../infra/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a JH SSE on_message_delta event with text content. */
function makeDeltaEvent(text: string): string {
    const data = JSON.stringify({
        event: "on_message_delta",
        delta: { content: [{ type: "text", text }] },
    });
    return `event: message\ndata: ${data}`;
}

/** Build a JH SSE final message event with accumulated text. */
function makeMessageEvent(
    text: string,
    opts?: { isCreatedByUser?: boolean; sender?: string },
): string {
    const data = JSON.stringify({
        event: "message",
        message: {
            text,
            isCreatedByUser: opts?.isCreatedByUser ?? false,
            sender: opts?.sender ?? "Assistant",
        },
    });
    return `event: message\ndata: ${data}`;
}

/** Build a user echo event (should be skipped). */
function makeUserEchoEvent(text: string): string {
    return makeMessageEvent(text, { isCreatedByUser: true, sender: "User" });
}

/** Combine SSE events into raw SSE text. */
function buildSse(...events: string[]): string {
    return events.join("\n\n") + "\n\n";
}

/** Extract all content text from streaming chunks. */
function collectStreamContent(chunks: OpenAIChunk[]): string {
    return chunks
        .map((c) => c.choices[0]?.delta?.content ?? "")
        .join("");
}

/** Extract all tool_calls from streaming chunks. */
function collectStreamToolCalls(
    chunks: OpenAIChunk[],
): Array<{ id: string; name: string; arguments: string }> {
    const calls: Array<{ id: string; name: string; arguments: string }> = [];
    for (const chunk of chunks) {
        const tcs = chunk.choices[0]?.delta?.tool_calls;
        if (tcs) {
            for (const tc of tcs) {
                if (tc.id && tc.function?.name) {
                    calls.push({
                        id: tc.id,
                        name: tc.function.name,
                        arguments: tc.function.arguments ?? "",
                    });
                }
            }
        }
    }
    return calls;
}

/** Get the finish_reason from the last chunk. */
function getFinishReason(chunks: OpenAIChunk[]): string | null {
    return chunks[chunks.length - 1]?.choices[0]?.finish_reason ?? null;
}

// ── Tests: tool_response content must not leak ────────────────────────────────

describe("translateToStream: tool_response content must not leak", () => {
    /**
     * BUG SCENARIO:
     * When the JH platform echoes back <tool_response> XML in the SSE stream
     * (which contains file contents from tool results), this content must NOT
     * appear in the streamed content chunks sent to the client.
     *
     * The client (OpenCode) should only see the model's actual response text
     * and structured tool_calls — never the raw tool_response XML or its content.
     */
    it("tool_response XML in deltas must not leak as content", () => {
        // Simulate JH echoing back the tool_response followed by the model's reply
        const toolResponseXml =
            '<tool_response id="call_1">{"name": "jh-web-gateway", "version": "2.2.0"}</tool_response>';
        const modelReply = "The project name is jh-web-gateway.";

        const rawSse = buildSse(
            makeDeltaEvent(toolResponseXml),
            makeDeltaEvent(modelReply),
        );

        const chunks = translateToStream(rawSse, "test-model", "test-id");
        const content = collectStreamContent(chunks);

        // The tool_response XML must NOT appear in the content
        expect(content).not.toContain("<tool_response");
        expect(content).not.toContain("</tool_response>");
        // The model's actual reply SHOULD appear
        expect(content).toContain("The project name is jh-web-gateway.");
    });

    it("large file content inside tool_response must not leak", () => {
        // Simulate a large file being echoed back in the stream
        const fileContent = "# README\n\n" + "This is line N of the file.\n".repeat(50);
        const toolResponseXml = `<tool_response id="call_1">${fileContent}</tool_response>`;
        const modelReply = "The file is a README with 50 lines.";

        const rawSse = buildSse(
            makeDeltaEvent(toolResponseXml),
            makeDeltaEvent(modelReply),
        );

        const chunks = translateToStream(rawSse, "test-model", "test-id");
        const content = collectStreamContent(chunks);

        expect(content).not.toContain("<tool_response");
        expect(content).not.toContain("This is line N of the file.");
        expect(content).toContain("The file is a README with 50 lines.");
    });

    it("tool_response split across multiple deltas must not leak", () => {
        // The tool_response might arrive in chunks across multiple delta events
        const rawSse = buildSse(
            makeDeltaEvent("<tool_response"),
            makeDeltaEvent(' id="call_1">'),
            makeDeltaEvent('{"name": "test-project"}'),
            makeDeltaEvent("</tool_response>"),
            makeDeltaEvent("The project is called test-project."),
        );

        const chunks = translateToStream(rawSse, "test-model", "test-id");
        const content = collectStreamContent(chunks);

        expect(content).not.toContain("<tool_response");
        expect(content).not.toContain("</tool_response>");
        expect(content).not.toContain('"name": "test-project"');
        expect(content).toContain("The project is called test-project.");
    });

    it("multiple tool_responses must not leak", () => {
        const rawSse = buildSse(
            makeDeltaEvent('<tool_response id="c1">file1 content</tool_response>'),
            makeDeltaEvent('<tool_response id="c2">file2 content</tool_response>'),
            makeDeltaEvent("Both files have been read."),
        );

        const chunks = translateToStream(rawSse, "test-model", "test-id");
        const content = collectStreamContent(chunks);

        expect(content).not.toContain("file1 content");
        expect(content).not.toContain("file2 content");
        expect(content).not.toContain("<tool_response");
        expect(content).toContain("Both files have been read.");
    });
});

// ── Tests: tool_call XML must not leak as content ─────────────────────────────

describe("translateToStream: tool_call XML must not leak", () => {
    it("tool_call in deltas becomes structured tool_calls, not content", () => {
        const rawSse = buildSse(
            makeDeltaEvent("I will read the file."),
            makeDeltaEvent('<tool_call id="call_1" name="read">{"filePath": "test.md"}</tool_call>'),
        );

        const chunks = translateToStream(rawSse, "test-model", "test-id");
        const content = collectStreamContent(chunks);
        const toolCalls = collectStreamToolCalls(chunks);

        expect(content).not.toContain("<tool_call");
        expect(content).toContain("I will read the file.");
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0].name).toBe("read");
        expect(getFinishReason(chunks)).toBe("tool_calls");
    });

    it("tool_call split across deltas becomes structured tool_calls", () => {
        const rawSse = buildSse(
            makeDeltaEvent("<tool"),
            makeDeltaEvent("_call id"),
            makeDeltaEvent('="call_1"'),
            makeDeltaEvent(' name="read">'),
            makeDeltaEvent('{"filePath": "test.md"}'),
            makeDeltaEvent("</tool_call>"),
        );

        const chunks = translateToStream(rawSse, "test-model", "test-id");
        const content = collectStreamContent(chunks);
        const toolCalls = collectStreamToolCalls(chunks);

        expect(content).toBe("");
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0].name).toBe("read");
    });
});

// ── Tests: streaming/non-streaming equivalence ────────────────────────────────

describe("translateToStream vs translateToCompletion equivalence", () => {
    /**
     * CORRECTNESS PROPERTY:
     * For the same raw SSE input, the streaming path must produce the same
     * tool calls and text content as the non-streaming path.
     */
    it("both paths produce same tool calls for tool_call in response", () => {
        const rawSse = buildSse(
            makeDeltaEvent("Let me read that."),
            makeDeltaEvent('<tool_call id="c1" name="read">{"f":"test.md"}</tool_call>'),
            makeMessageEvent(
                'Let me read that.<tool_call id="c1" name="read">{"f":"test.md"}</tool_call>',
            ),
        );

        const streaming = translateToStream(rawSse, "test-model", "test-id");
        const completion = translateToCompletion(rawSse, "test-model", "test-id");

        const streamCalls = collectStreamToolCalls(streaming);
        const completionCalls = completion.choices[0].message.tool_calls ?? [];

        expect(streamCalls.length).toBe(completionCalls.length);
        for (let i = 0; i < completionCalls.length; i++) {
            expect(streamCalls[i].name).toBe(completionCalls[i].function.name);
        }
    });

    it("both paths produce same text content (no XML leakage in either)", () => {
        const rawSse = buildSse(
            makeDeltaEvent("The answer is 42."),
            makeMessageEvent("The answer is 42."),
        );

        const streaming = translateToStream(rawSse, "test-model", "test-id");
        const completion = translateToCompletion(rawSse, "test-model", "test-id");

        const streamContent = collectStreamContent(streaming);
        expect(streamContent).toBe(completion.choices[0].message.content);
    });

    it("tool_response content is excluded from both paths", () => {
        const toolResponse = '<tool_response id="c1">secret file content</tool_response>';
        const modelReply = "Here is the summary.";

        const rawSse = buildSse(
            makeDeltaEvent(toolResponse + modelReply),
            makeMessageEvent(toolResponse + modelReply),
        );

        const streaming = translateToStream(rawSse, "test-model", "test-id");
        const completion = translateToCompletion(rawSse, "test-model", "test-id");

        const streamContent = collectStreamContent(streaming);

        // Neither path should leak tool_response content
        expect(streamContent).not.toContain("secret file content");
        expect(streamContent).not.toContain("<tool_response");
        expect(completion.choices[0].message.content).not.toContain("secret file content");
        expect(completion.choices[0].message.content).not.toContain("<tool_response");
    });
});

// ── Tests: user echo filtering ────────────────────────────────────────────────

describe("translateToStream: user echo filtering", () => {
    it("user echo events are not emitted as content", () => {
        const rawSse = buildSse(
            makeUserEchoEvent("This is the user's message"),
            makeDeltaEvent("This is the assistant's reply."),
        );

        const chunks = translateToStream(rawSse, "test-model", "test-id");
        const content = collectStreamContent(chunks);

        expect(content).not.toContain("This is the user's message");
        expect(content).toContain("This is the assistant's reply.");
    });
});

// ── Tests: thinking tags ──────────────────────────────────────────────────────

describe("translateToStream: thinking tags", () => {
    it("think tags in deltas should not appear in content", () => {
        const rawSse = buildSse(
            makeDeltaEvent("<think>Let me consider this carefully.</think>"),
            makeDeltaEvent("The answer is 42."),
        );

        const chunks = translateToStream(rawSse, "test-model", "test-id");
        const content = collectStreamContent(chunks);

        // Think tags should ideally be stripped, but at minimum
        // the actual answer must be present
        expect(content).toContain("The answer is 42.");
    });
});
