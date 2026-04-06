import Anthropic from '@anthropic-ai/sdk';
import { LLMRequest, WebFeatureResponse, PageContext, PageStyles } from './types.js';
import { WEB_FEATURE_BUILDER_SYSTEM_PROMPT, UI_GENERATOR_SYSTEM_PROMPT } from './constants.js';
import {
  countMessageTokens,
  logTokenUsage,
  truncateToTokenLimit,
  MAX_INPUT_TOKENS
} from './tokenCounter.js';

// ---- OpenRouter types ----

interface OpenRouterContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenRouterContentPart[] | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenRouterToolCall[];
    };
    finish_reason: string;
  }>;
  error?: { message: string; code?: number };
}

// ---- Shared tool definition (provider-agnostic) ----

interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

// ---- Client config ----

export interface LLMClientConfig {
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
  model?: string;
  provider?: 'anthropic' | 'openrouter';
}

class LLMClient {
  private config: LLMClientConfig;
  private anthropic: Anthropic | null = null;

  constructor(config: LLMClientConfig = {}) {
    this.config = {
      timeout: 60000,
      maxRetries: 3,
      model: 'claude-sonnet-4-5-20250929',
      provider: 'anthropic',
      ...config
    };

    if (this.config.apiKey && this.config.provider === 'anthropic') {
      this.initializeClient();
    }
  }

  private initializeClient(): void {
    if (!this.config.apiKey) return;

    this.anthropic = new Anthropic({
      apiKey: this.config.apiKey,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
      dangerouslyAllowBrowser: true
    });
  }

  // ---- Tool definitions (shared between providers) ----

  private getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'search_dom',
        description: 'Search the DOM for elements matching a CSS selector. Returns element details including tag, id, class, text content, and attributes.',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to search for elements (e.g., ".button", "#header", "[data-testid=\\"submit\\"]")'
            }
          },
          required: ['selector']
        }
      },
      {
        name: 'read_element',
        description: 'Read detailed information about a specific DOM element, including its HTML structure, computed styles, and position.',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the element to read'
            },
            includeHTML: {
              type: 'boolean',
              description: "Whether to include the element's innerHTML"
            }
          },
          required: ['selector']
        }
      },
      {
        name: 'get_page_structure',
        description: 'Get a hierarchical structure of the page DOM, showing parent-child relationships.',
        parameters: {
          type: 'object',
          properties: {
            maxDepth: {
              type: 'number',
              description: 'Maximum depth to traverse (default: 3)'
            },
            rootSelector: {
              type: 'string',
              description: 'Root element to start from (default: body)'
            }
          }
        }
      },
      {
        name: 'search_page_source',
        description: 'Search the raw HTML source code for a specific term or pattern. Returns matching lines with context.',
        parameters: {
          type: 'object',
          properties: {
            searchTerm: {
              type: 'string',
              description: 'Text or regex pattern to search for in the HTML source'
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results to return (default: 20)'
            }
          },
          required: ['searchTerm']
        }
      },
      {
        name: 'read_page_source',
        description: 'Read a specific range of lines from the raw HTML source code. Useful for examining the page structure.',
        parameters: {
          type: 'object',
          properties: {
            startLine: {
              type: 'number',
              description: 'Starting line number (1-indexed, default: 1)'
            },
            endLine: {
              type: 'number',
              description: 'Ending line number (default: startLine + 50)'
            }
          }
        }
      }
    ];
  }

  private getAnthropicTools(): Anthropic.Tool[] {
    return this.getToolDefinitions().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool.InputSchema
    }));
  }

  private getOpenRouterTools(): OpenRouterTool[] {
    return this.getToolDefinitions().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  // ---- Public API ----

  async callWebFeatureBuilder(request: LLMRequest, tabId?: number): Promise<WebFeatureResponse> {
    const { userInstruction, pageContext, screenshotBase64 } = request;

    try {
      if (!this.config.apiKey) {
        console.warn('No API key configured. Using mock response for demonstration.');
        return this.getMockResponse(userInstruction);
      }

      const messages = this.buildMessages(userInstruction, pageContext, screenshotBase64);

      const response = this.config.provider === 'openrouter'
        ? await this.makeOpenRouterAPICall(messages, tabId)
        : await this.makeAnthropicAPICall(messages, tabId);

      return this.parseResponse(response);
    } catch (error) {
      console.error('LLM API call failed:', error);

      if (this.config.provider !== 'openrouter') {
        if (error instanceof Anthropic.AuthenticationError) {
          throw new Error('Invalid API key. Please check your Anthropic API key in settings.');
        } else if (error instanceof Anthropic.RateLimitError) {
          throw new Error('Rate limit exceeded. Please try again later.');
        } else if (error instanceof Anthropic.APIConnectionError) {
          throw new Error('Unable to connect to Anthropic API. Please check your internet connection.');
        }
      }

      throw new Error(`AI request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateUIAtLocation(
    userInstruction: string,
    location: { x: number; y: number; width: number; height: number },
    pageContext: PageContext,
    screenshotBase64?: string,
    pageStyles?: PageStyles
  ): Promise<WebFeatureResponse> {
    try {
      const messages = this.buildUIGenerationMessages(userInstruction, location, pageContext, screenshotBase64, pageStyles);

      const response = this.config.provider === 'openrouter'
        ? await this.makeOpenRouterAPICall(messages, undefined, UI_GENERATOR_SYSTEM_PROMPT)
        : await this.makeAnthropicAPICall(messages, undefined, UI_GENERATOR_SYSTEM_PROMPT);

      return this.parseResponse(response);
    } catch (error) {
      console.error('UI generation failed:', error);

      if (this.config.provider !== 'openrouter') {
        if (error instanceof Anthropic.AuthenticationError) {
          throw new Error('Invalid API key. Please check your Anthropic API key in settings.');
        } else if (error instanceof Anthropic.RateLimitError) {
          throw new Error('Rate limit exceeded. Please try again later.');
        } else if (error instanceof Anthropic.APIConnectionError) {
          throw new Error('Unable to connect to Anthropic API. Please check your internet connection.');
        }
      }

      throw new Error(`UI generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ---- Message building (Anthropic format as internal representation) ----

  private buildPageContextText(userInstruction: string, pageContext: PageContext, maxElements: number): string {
    return `Please analyze this web page and implement the user's request.

User Request: "${userInstruction}"

Page Context:
- URL: ${pageContext.url}
- Hostname: ${pageContext.hostname}
- Title: ${pageContext.domSummary.title}
- DOM Elements: ${pageContext.domSummary.elements.length} key elements detected (showing top ${maxElements})

Key Page Elements (Top ${maxElements}):
${pageContext.domSummary.elements.slice(0, maxElements).map(el => {
  const parts = [];
  if (el.tagName) parts.push(`<${el.tagName}>`);
  if (el.id) parts.push(`id="${el.id}"`);
  if (el.className) {
    const className = el.className.length > 100 ? el.className.substring(0, 100) + '...' : el.className;
    parts.push(`class="${className}"`);
  }
  if (el.role) parts.push(`role="${el.role}"`);
  if (el.innerText && el.innerText.length < 80) parts.push(`text="${el.innerText}"`);
  return `- ${parts.join(' ')}`;
}).join('\n')}

**Note:** If you need more details about the page structure, use the available tools:
- search_dom(selector) - Find specific elements
- read_element(selector) - Get detailed element info
- get_page_structure() - See DOM hierarchy
- search_page_source(term) - Search HTML source
- read_page_source(start, end) - Read HTML source lines

Please respond with valid JSON following the exact schema specified in the system prompt.`;
  }

  private formatPageStyles(pageStyles: PageStyles): string {
    const lines: string[] = ['Page Design System:'];

    const varEntries = Object.entries(pageStyles.cssVariables);
    if (varEntries.length > 0) {
      lines.push('CSS Variables:');
      for (const [name, value] of varEntries.slice(0, 60)) {
        lines.push(`  ${name}: ${value}`);
      }
    }

    if (pageStyles.elements.length > 0) {
      lines.push('Element Styles:');
      for (const el of pageStyles.elements) {
        const parts = [
          el.color !== 'rgba(0, 0, 0, 0)' && el.color ? `color=${el.color}` : null,
          el.backgroundColor !== 'rgba(0, 0, 0, 0)' && el.backgroundColor ? `bg=${el.backgroundColor}` : null,
          el.fontFamily ? `font=${el.fontFamily.split(',')[0].replace(/['"]/g, '')}` : null,
          el.fontSize ? `${el.fontSize}` : null,
          el.fontWeight && el.fontWeight !== '400' ? `weight=${el.fontWeight}` : null,
          el.borderRadius && el.borderRadius !== '0px' ? `radius=${el.borderRadius}` : null,
          el.boxShadow && el.boxShadow !== 'none' ? `shadow=${el.boxShadow}` : null,
        ].filter(Boolean);
        if (parts.length > 0) {
          lines.push(`  ${el.selector}: ${parts.join(', ')}`);
        }
      }
    }

    return lines.join('\n');
  }

  private buildUIGenerationMessages(
    userInstruction: string,
    location: { x: number; y: number; width: number; height: number },
    pageContext: PageContext,
    screenshotBase64?: string,
    pageStyles?: PageStyles
  ): Anthropic.MessageParam[] {
    const content: Anthropic.MessageParam['content'] = [];

    const stylesSection = pageStyles
      ? `\n\n${this.formatPageStyles(pageStyles)}`
      : '';

    const textContent = `You are a UI generator. Create a custom UI component at a specific location on the webpage.

User Request: "${userInstruction}"

Target Location:
- X: ${location.x}px from left
- Y: ${location.y}px from top
- Width: ${location.width}px
- Height: ${location.height}px

Page Context:
- URL: ${pageContext.url}
- Hostname: ${pageContext.hostname}
- Title: ${pageContext.domSummary.title}${stylesSection}

Your task:
1. Create HTML/CSS/JavaScript for a UI component that fits in the specified location
2. The component should be positioned at the exact coordinates using fixed or absolute positioning
3. Match the host page's design system using the styles above — use its colors, fonts, and border-radius values
4. Ensure it's responsive and doesn't break the page layout
5. Add any necessary event listeners and interactivity

Important:
- Use position: fixed with the exact coordinates provided
- Set z-index high enough to appear above page content (e.g., 999999)
- Include all necessary styling inline or in the CSS field
- Make it draggable if appropriate
- Add a close/minimize button if it's a panel or widget

Please respond with valid JSON following the exact schema specified in the system prompt.`;

    content.push({
      type: 'text',
      text: textContent
    });

    if (screenshotBase64) {
      const base64Data = screenshotBase64.replace(/^data:image\/[^;]+;base64,/, '');
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: base64Data
        }
      });
    }

    return [
      {
        role: 'user',
        content: content
      }
    ];
  }

  private buildMessages(userInstruction: string, pageContext: PageContext, screenshotBase64?: string): Anthropic.MessageParam[] {
    const content: Anthropic.MessageParam['content'] = [];

    let maxElements = Math.min(30, pageContext.domSummary.elements.length);

    let textContent = this.buildPageContextText(userInstruction, pageContext, maxElements);

    let textTokens = countMessageTokens([{ role: 'user', content: textContent }], WEB_FEATURE_BUILDER_SYSTEM_PROMPT);

    while (textTokens.percentUsed > 30 && maxElements > 10) {
      maxElements = Math.floor(maxElements * 0.7);
      textContent = this.buildPageContextText(userInstruction, pageContext, maxElements);
      textTokens = countMessageTokens([{ role: 'user', content: textContent }], WEB_FEATURE_BUILDER_SYSTEM_PROMPT);
    }

    console.log(`Web Augmenter: Including ${maxElements} DOM elements in context (${textTokens.totalTokens.toLocaleString()} tokens, ${textTokens.percentUsed.toFixed(1)}% of limit)`);

    content.push({
      type: 'text',
      text: textContent
    });

    if (screenshotBase64) {
      const base64Data = screenshotBase64.replace(/^data:image\/[^;]+;base64,/, '');

      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: base64Data
        }
      });
    }

    return [
      {
        role: 'user',
        content: content
      }
    ];
  }

  // ---- OpenRouter API ----

  private convertMessagesToOpenRouter(messages: Anthropic.MessageParam[]): OpenRouterMessage[] {
    const result: OpenRouterMessage[] = [];

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        result.push({ role: msg.role as OpenRouterMessage['role'], content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Skip image blocks — not all OpenRouter models support vision input.
        // The DOM snapshot and tool-based exploration provide sufficient page context.
        const parts: OpenRouterContentPart[] = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text });
          }
          // Images are intentionally omitted for OpenRouter compatibility
        }

        if (parts.length > 0) {
          result.push({ role: msg.role as OpenRouterMessage['role'], content: parts });
        }
      }
    }

    return result;
  }

  private async makeOpenRouterAPICall(
    messages: Anthropic.MessageParam[],
    tabId?: number,
    systemPrompt: string = WEB_FEATURE_BUILDER_SYSTEM_PROMPT
  ): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    // Token counting on initial messages (approximate pre-flight check)
    const tokenCount = countMessageTokens(messages, systemPrompt);
    logTokenUsage(tokenCount, 'OpenRouter initial request');

    if (!tokenCount.withinLimit) {
      const excess = tokenCount.totalTokens - tokenCount.maxTokens;
      throw new Error(
        `Prompt is too long: ${tokenCount.totalTokens.toLocaleString()} tokens > ${tokenCount.maxTokens.toLocaleString()} maximum. ` +
        `Exceeds limit by ${excess.toLocaleString()} tokens. Try reducing the page complexity or use a simpler instruction.`
      );
    }

    // Convert to OpenRouter format
    let currentMessages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      ...this.convertMessagesToOpenRouter(messages)
    ];

    const tools = this.getOpenRouterTools();
    let maxIterations = 5;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'X-OpenRouter-Title': 'Web Augmenter'
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: currentMessages,
          tools,
          max_tokens: 4000
        })
      });

      if (!res.ok) {
        const status = res.status;
        if (status === 401) throw new Error('Invalid API key. Please check your OpenRouter API key in settings.');
        if (status === 429) throw new Error('Rate limit exceeded. Please try again later.');
        if (status === 402) throw new Error('Insufficient credits. Please add credits to your OpenRouter account.');
        const errorText = await res.text();
        throw new Error(`OpenRouter API error (${status}): ${errorText}`);
      }

      const data: OpenRouterResponse = await res.json();
      if (data.error) {
        throw new Error(`OpenRouter error: ${data.error.message}`);
      }

      const choice = data.choices?.[0];
      if (!choice) throw new Error('No response from OpenRouter API');

      const assistantMsg = choice.message;

      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        console.log(`Web Augmenter: Model requested ${assistantMsg.tool_calls.length} tool(s)`);

        // Add assistant message to conversation
        currentMessages.push({
          role: 'assistant',
          content: assistantMsg.content,
          tool_calls: assistantMsg.tool_calls
        });

        // Execute each tool and add results
        for (const toolCall of assistantMsg.tool_calls) {
          console.log(`Web Augmenter: Executing tool: ${toolCall.function.name}`, toolCall.function.arguments);

          let toolResult: string;

          if (tabId) {
            try {
              const toolInput = JSON.parse(toolCall.function.arguments);
              const toolResponse = await chrome.tabs.sendMessage(tabId, {
                type: 'EXECUTE_TOOL',
                toolName: toolCall.function.name,
                toolInput
              });
              toolResult = toolResponse.result;
            } catch (error) {
              toolResult = JSON.stringify({ error: `Failed to execute tool: ${error}` });
            }
          } else {
            toolResult = JSON.stringify({ error: 'No tab ID available for tool execution' });
          }

          // Truncate large results
          const MAX_TOOL_RESULT_TOKENS = 10000;
          const maxChars = MAX_TOOL_RESULT_TOKENS * 3.5;
          if (toolResult.length > maxChars) {
            toolResult = toolResult.substring(0, maxChars) +
              '\n\n[... Result truncated due to length. Consider using more specific selectors or reducing maxResults ...]';
            console.warn(`Web Augmenter: Tool result truncated to ${maxChars} characters`);
          }

          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult
          });
        }
      } else {
        // No tool calls — return final text
        if (!assistantMsg.content) {
          throw new Error('No content in OpenRouter API response');
        }
        return assistantMsg.content;
      }
    }

    throw new Error('Max tool execution iterations reached');
  }

  // ---- Anthropic API ----

  private async makeAnthropicAPICall(
    messages: Anthropic.MessageParam[],
    tabId?: number,
    systemPrompt: string = WEB_FEATURE_BUILDER_SYSTEM_PROMPT
  ): Promise<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const tokenCount = countMessageTokens(messages, systemPrompt);
    logTokenUsage(tokenCount, 'Initial request');

    if (!tokenCount.withinLimit) {
      const excess = tokenCount.totalTokens - tokenCount.maxTokens;
      throw new Error(
        `Prompt is too long: ${tokenCount.totalTokens.toLocaleString()} tokens > ${tokenCount.maxTokens.toLocaleString()} maximum. ` +
        `Exceeds limit by ${excess.toLocaleString()} tokens. Try reducing the page complexity or use a simpler instruction.`
      );
    }

    if (tokenCount.percentUsed > 80) {
      console.warn(
        `⚠️ Token usage is high (${tokenCount.percentUsed.toFixed(1)}%). ` +
        `Consider reducing page context to avoid hitting limits.`
      );
    }

    const tools = this.getAnthropicTools();

    let currentMessages = [...messages];
    let maxIterations = 5;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      if (iteration > 1) {
        const iterationTokenCount = countMessageTokens(currentMessages, systemPrompt);
        logTokenUsage(iterationTokenCount, `Iteration ${iteration}`);

        if (!iterationTokenCount.withinLimit) {
          throw new Error(
            `Token limit exceeded during tool execution (iteration ${iteration}). ` +
            `Current: ${iterationTokenCount.totalTokens.toLocaleString()} tokens. ` +
            `Try using fewer tools or simpler queries.`
          );
        }
      }

      const response = await this.anthropic.messages.create({
        model: this.config.model!,
        max_tokens: 4000,
        system: systemPrompt,
        messages: currentMessages,
        tools: tools
      });

      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

      if (toolUseBlocks.length === 0) {
        const textContent = response.content.find(content => content.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          throw new Error('No text content in Anthropic API response');
        }
        return textContent.text;
      }

      console.log(`Web Augmenter: Claude requested ${toolUseBlocks.length} tool(s)`);

      currentMessages.push({
        role: 'assistant',
        content: response.content
      });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        if (toolBlock.type !== 'tool_use') continue;

        console.log(`Web Augmenter: Executing tool: ${toolBlock.name}`, toolBlock.input);

        let toolResult: string;

        if (tabId) {
          try {
            const response = await chrome.tabs.sendMessage(tabId, {
              type: 'EXECUTE_TOOL',
              toolName: toolBlock.name,
              toolInput: toolBlock.input
            });

            toolResult = response.result;
          } catch (error) {
            toolResult = JSON.stringify({ error: `Failed to execute tool: ${error}` });
          }
        } else {
          toolResult = JSON.stringify({ error: 'No tab ID available for tool execution' });
        }

        const MAX_TOOL_RESULT_TOKENS = 10000;
        const maxChars = MAX_TOOL_RESULT_TOKENS * 3.5;

        if (toolResult.length > maxChars) {
          const truncated = toolResult.substring(0, maxChars);
          toolResult = truncated + '\n\n[... Result truncated due to length. Consider using more specific selectors or reducing maxResults ...]';
          console.warn(`Web Augmenter: Tool result truncated from ${toolResult.length} to ${maxChars} characters`);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: toolResult
        });
      }

      currentMessages.push({
        role: 'user',
        content: toolResults
      });
    }

    throw new Error('Max tool execution iterations reached');
  }

  // ---- Mock response ----

  private getMockResponse(userInstruction: string): WebFeatureResponse {
    const instruction = userInstruction || 'create a feature';

    if (instruction.toLowerCase().includes('dark mode')) {
      return {
        high_level_goal: "Add a dark mode toggle to the current website",
        plan: [
          "Create a floating toggle button",
          "Implement dark theme CSS variables",
          "Add click handler to toggle themes",
          "Save user preference to localStorage"
        ],
        script: `(function() {
          const toggle = document.createElement('div');
          toggle.id = 'web-augmenter-dark-toggle';
          toggle.innerHTML = '🌙';
          toggle.style.cssText = \`
            position: fixed;
            top: 20px;
            right: 20px;
            width: 50px;
            height: 50px;
            background: #333;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 10000;
            font-size: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
          \`;

          const isDark = localStorage.getItem('web-augmenter-dark-mode') === 'true';
          if (isDark) {
            document.documentElement.classList.add('web-augmenter-dark');
            toggle.innerHTML = '☀️';
          }

          toggle.addEventListener('click', () => {
            document.documentElement.classList.toggle('web-augmenter-dark');
            const nowDark = document.documentElement.classList.contains('web-augmenter-dark');
            localStorage.setItem('web-augmenter-dark-mode', nowDark.toString());
            toggle.innerHTML = nowDark ? '☀️' : '🌙';
          });

          document.body.appendChild(toggle);
        })();`,
        css: `
          .web-augmenter-dark {
            --bg-color: #1a1a1a;
            --text-color: #e0e0e0;
            --border-color: #333;
          }

          .web-augmenter-dark body,
          .web-augmenter-dark div,
          .web-augmenter-dark p,
          .web-augmenter-dark span {
            background-color: var(--bg-color) !important;
            color: var(--text-color) !important;
            border-color: var(--border-color) !important;
          }

          .web-augmenter-dark a {
            color: #66b3ff !important;
          }
        `,
        notes_for_extension: "Dark mode toggle injected. Uses localStorage for persistence across page loads."
      };
    }

    if (instruction.toLowerCase().includes('hide') || instruction.toLowerCase().includes('instagram')) {
      return {
        high_level_goal: "Hide distracting elements and show only main content",
        plan: [
          "Identify main content containers",
          "Hide sidebar and navigation elements",
          "Hide promotional banners and ads",
          "Style remaining content for focus"
        ],
        script: `(function() {
          const selectors = [
            '[role="complementary"]',
            'aside',
            '.sidebar',
            '.recommendations',
            '.ads',
            '.promoted',
            'nav:not([role="main"])',
            '.stories'
          ];

          selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
              el.style.display = 'none';
            });
          });

          const main = document.querySelector('main, [role="main"], .main-content');
          if (main) {
            main.style.maxWidth = '800px';
            main.style.margin = '0 auto';
            main.style.padding = '20px';
          }
        })();`,
        css: `
          .web-augmenter-focused {
            max-width: 800px !important;
            margin: 0 auto !important;
            padding: 20px !important;
          }
        `,
        notes_for_extension: "Applied content focus mode. Hidden sidebar and promotional elements."
      };
    }

    return {
      high_level_goal: "Implement the requested web feature",
      plan: [
        "Analyze the current page structure",
        "Implement the requested functionality",
        "Apply styling for better user experience"
      ],
      script: `(function() {
        console.log('Web Augmenter: Feature applied');
        const notice = document.createElement('div');
        notice.textContent = 'Web Augmenter: ${instruction}';
        notice.style.cssText = \`
          position: fixed;
          top: 10px;
          left: 50%;
          transform: translateX(-50%);
          background: #4CAF50;
          color: white;
          padding: 10px 20px;
          border-radius: 5px;
          z-index: 10000;
          font-family: Arial, sans-serif;
        \`;
        document.body.appendChild(notice);
        setTimeout(() => notice.remove(), 3000);
      })();`,
      css: "",
      notes_for_extension: `Mock implementation for: ${instruction}`
    };
  }

  // ---- Response parsing ----

  private parseResponse(response: string): WebFeatureResponse {
    try {
      let jsonString = response.trim();

      if (jsonString.includes('```')) {
        const codeBlockMatch = jsonString.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (codeBlockMatch) {
          jsonString = codeBlockMatch[1].trim();
        }
      }

      if (!jsonString.startsWith('{')) {
        const firstBrace = jsonString.indexOf('{');
        const lastBrace = jsonString.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonString = jsonString.substring(firstBrace, lastBrace + 1);
        }
      }

      if (jsonString.endsWith('}') === false) {
        const lastBrace = jsonString.lastIndexOf('}');
        if (lastBrace !== -1) {
          jsonString = jsonString.substring(0, lastBrace + 1);
        }
      }

      const parsed = JSON.parse(jsonString);

      if (!parsed.high_level_goal || !parsed.plan) {
        throw new Error('Invalid response format: missing required fields');
      }

      if (!Array.isArray(parsed.plan)) {
        throw new Error('Invalid response format: plan must be an array');
      }

      if (!parsed.css && !parsed.script) {
        console.warn('LLM response contains neither CSS nor script. This may not produce visible changes.');
      }

      return {
        high_level_goal: String(parsed.high_level_goal),
        plan: parsed.plan.map((step: any) => String(step)),
        script: String(parsed.script || ''),
        css: String(parsed.css || ''),
        notes_for_extension: String(parsed.notes_for_extension || '')
      };
    } catch (error) {
      console.error('Failed to parse LLM response:', response.substring(0, 500));
      throw new Error(`Invalid JSON response from AI: ${error instanceof Error ? error.message : 'Parse error'}`);
    }
  }

  // ---- Config ----

  updateConfig(config: Partial<LLMClientConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.provider !== undefined || config.apiKey !== undefined) {
      if (this.config.provider === 'anthropic' && this.config.apiKey) {
        this.initializeClient();
      } else if (this.config.provider === 'openrouter') {
        // No Anthropic client needed for OpenRouter
        this.anthropic = null;
      } else if (!this.config.apiKey) {
        this.anthropic = null;
      }
    }
  }
}

export const llmClient = new LLMClient();
