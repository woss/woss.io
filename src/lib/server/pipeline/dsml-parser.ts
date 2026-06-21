/**
 * DeepSeek Markup Language (DSML) parser.
 *
 * DeepSeek V4 Flash ("big-pickle") emits tool calls in DSML format:
 * ```
 * <｜DSML｜tool_calls>
 * <｜DSML｜invoke name="function_name">
 * <｜DSML｜parameter name="param" string="true">string_value</｜DSML｜parameter>
 * <｜DSML｜parameter name="count" string="false">5</｜DSML｜parameter>
 * </｜DSML｜invoke>
 * </｜DSML｜tool_calls>
 * ```
 *
 * The fullwidth bar `｜` is U+FF5C. Only V4 format (`tool_calls`, not `function_calls`) is handled.
 *
 * Adapted from vLLM's deepseekv32_tool_parser.py.
 */

export interface DsmlToolCall {
  name: string;
  params: Record<string, string>;
}

const toolCallRegex = /<｜DSML｜tool_calls\s*>([\s\S]*?)<\/｜DSML｜tool_calls\s*>/gi;

const invokeRegex =
  /<｜DSML｜invoke\s+name="([^"]+)"\s*\/\s*>|<｜DSML｜invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/｜DSML｜invoke\s*>/gi;

const paramRegex =
  /<｜DSML｜parameter\s+name="([^"]+)"\s+string="(true|false)"\s*>([\s\S]*?)<\/｜DSML｜parameter\s*>/gi;

/**
 * Extract `name="value"` pairs from an HTML/XML opening tag string,
 * excluding the `name` attribute (which is the function name).
 */
const inlineAttrRegex = /\b(\w+)\s*=\s*"([^"]*)"\s*/g;

/**
 * Check if text contains any DSML blocks.
 */
export function hasDsmlBlocks(text: string): boolean {
  return /｜DSML｜/i.test(text);
}

/**
 * Parse DSML tool call blocks into structured DsmlToolCall objects.
 *
 * Handles:
 * - `<｜DSML｜parameter>` child elements with `string="true"` (raw) or `string="false"` (JSON.parse)
 * - Self-closing `<｜DSML｜invoke name="x"/>` with inline attributes
 */
export function parseDsmlToolCalls(text: string): DsmlToolCall[] {
  const calls: DsmlToolCall[] = [];

  let tcMatch: RegExpExecArray | null;
  while ((tcMatch = toolCallRegex.exec(text)) !== null) {
    const blockContent = tcMatch[1];

    let invMatch: RegExpExecArray | null;
    while ((invMatch = invokeRegex.exec(blockContent)) !== null) {
      const name = invMatch[1] ?? invMatch[2];
      if (!name) continue;

      const params: Record<string, string> = {};

      if (invMatch[3] !== undefined) {
        // Block invoke: extract <｜DSML｜parameter> children
        const inner = invMatch[3];
        let pMatch: RegExpExecArray | null;
        while ((pMatch = paramRegex.exec(inner)) !== null) {
          const [, pName, stringFlag, pValue] = pMatch;
          const raw = pValue.trim();
          if (stringFlag === 'false') {
            try {
              params[pName] = JSON.parse(raw);
            } catch {
              params[pName] = raw;
            }
          } else {
            params[pName] = raw;
          }
        }
      } else {
        // Self-closing invoke: extract inline attributes
        const tagContent = invMatch[0];
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = inlineAttrRegex.exec(tagContent)) !== null) {
          const attrName = attrMatch[1];
          const attrValue = attrMatch[2];
          if (attrName !== 'name') {
            params[attrName] = attrValue;
          }
        }
      }

      calls.push({ name, params });
    }
  }

  return calls;
}

/**
 * Remove all DSML tool call blocks from text.
 * Text before and after blocks is preserved.
 */
export function stripDsmlBlocks(text: string): string {
  return text.replace(toolCallRegex, '').trim();
}
