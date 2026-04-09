import type { OpenAIMessage, OpenAITool, BuiltPrompt } from "../infra/types.js";

/**
 * Format tool definitions as XML for injection into the system prompt.
 */
export function formatToolDefinitionsXml(tools: OpenAITool[]): string {
  const defs = tools.map((t) => {
    const fn = t.function;
    let xml = `<tool name="${fn.name}"`;
    if (fn.description) {
      xml += ` description="${escapeXmlAttr(fn.description)}"`;
    }
    xml += ">";
    if (fn.parameters) {
      xml += `\n  <parameters>${JSON.stringify(fn.parameters)}</parameters>`;
    }
    xml += "\n</tool>";
    return xml;
  });

  return `<tools>\n${defs.join("\n")}\n</tools>`;
}

/**
 * Format a tool result message as `<tool_response>` XML.
 */
export function formatToolResponse(toolCallId: string, content: string): string {
  return `<tool_response id="${toolCallId}">${content}</tool_response>`;
}

/**
 * Convert OpenAI messages + tools into JH prompt format.
 *
 * Rules:
 * 1. system → prepended as system prompt section
 * 2. user → "Human: {content}"
 * 3. assistant → "Assistant: {content}" (including tool_calls as XML)
 * 4. tool → "<tool_response id="{tool_call_id}">{content}</tool_response>"
 * 5. tools array → XML tool definitions injected into system prompt
 * 6. tool_choice: "required" → append instruction
 * 7. tool_choice: { function: { name } } → append specific tool instruction
 */
export function buildPrompt(
  messages: OpenAIMessage[],
  tools?: OpenAITool[],
  toolChoice?: string | { type: string; function: { name: string } },
): BuiltPrompt {
  let systemPrompt: string | undefined;
  const parts: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        // Accumulate system messages (rare to have multiple, but handle it)
        systemPrompt = systemPrompt
          ? `${systemPrompt}\n${msg.content ?? ""}`
          : (msg.content ?? "");
        break;

      case "user":
        parts.push(`Human: ${msg.content ?? ""}`);
        break;

      case "assistant": {
        let content = msg.content ?? "";
        // If assistant message includes tool_calls, append them as XML
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const toolXml = msg.tool_calls
            .map(
              (tc) =>
                `<tool_call id="${tc.id}" name="${tc.function.name}">${tc.function.arguments}</tool_call>`,
            )
            .join("");
          content = content ? `${content}\n${toolXml}` : toolXml;
        }
        parts.push(`Assistant: ${content}`);
        break;
      }

      case "tool":
        parts.push(formatToolResponse(msg.tool_call_id ?? "unknown", msg.content ?? ""));
        break;
    }
  }

  // Inject tool definitions into system prompt if tools are provided
  if (tools && tools.length > 0) {
    const toolsXml = formatToolDefinitionsXml(tools);
    const toolInstructions =
      "You have access to the following tools. To use a tool, respond with " +
      '<tool_call id="call_ID" name="TOOL_NAME">ARGUMENTS_JSON</tool_call>';
    const injection = `${toolInstructions}\n\n${toolsXml}`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${injection}` : injection;
  }

  // Append tool_choice instructions
  if (toolChoice) {
    let instruction = "";
    if (toolChoice === "required") {
      instruction = "You MUST use a tool in your response.";
    } else if (typeof toolChoice === "object" && toolChoice.function?.name) {
      instruction = `You MUST use the tool "${toolChoice.function.name}" in your response.`;
    }
    if (instruction) {
      parts.push(instruction);
    }
  }

  return {
    prompt: parts.join("\n\n"),
    systemPrompt,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
