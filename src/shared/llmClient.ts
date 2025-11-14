import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { LLMRequest, WebFeatureResponse, PageContext } from './types.js';
import { WEB_FEATURE_BUILDER_SYSTEM_PROMPT, UI_GENERATOR_SYSTEM_PROMPT } from './constants.js';
import { 
  countMessageTokens, 
  logTokenUsage, 
  truncateToTokenLimit,
  MAX_INPUT_TOKENS 
} from './tokenCounter.js';

export interface LLMClientConfig {
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
  model?: string;
}

class LLMClient {
  private config: LLMClientConfig;
  private anthropic: Anthropic | null = null;

  constructor(config: LLMClientConfig = {}) {
    this.config = {
      timeout: config.timeout || 60000, // 60 seconds
      maxRetries: config.maxRetries || 3,
      model: config.model || 'claude-sonnet-4-5-20250929',
      ...config
    };

    if (config.apiKey) {
      this.initializeClient();
    }
  }

  private initializeClient(): void {
    if (!this.config.apiKey) return;

    this.anthropic = new Anthropic({
      apiKey: this.config.apiKey,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
      // For extension environment, we need to handle browser compatibility
      dangerouslyAllowBrowser: true
    });
  }

  async callWebFeatureBuilder(request: LLMRequest, tabId?: number): Promise<WebFeatureResponse> {
    const { userInstruction, pageContext, screenshotBase64 } = request;

    try {
      if (!this.anthropic) {
        console.warn('No Anthropic client configured. Using mock response for demonstration.');
        return this.getMockResponse(userInstruction);
      }

      const messages = this.buildMessages(userInstruction, pageContext, screenshotBase64);
      const response = await this.makeAnthropicAPICall(messages, tabId);
      return this.parseResponse(response);
    } catch (error) {
      console.error('LLM API call failed:', error);

      // Fallback to mock response if API call fails
      if (error instanceof Anthropic.AuthenticationError) {
        throw new Error('Invalid API key. Please check your Anthropic API key in settings.');
      } else if (error instanceof Anthropic.RateLimitError) {
        throw new Error('Rate limit exceeded. Please try again later.');
      } else if (error instanceof Anthropic.APIConnectionError) {
        throw new Error('Unable to connect to Anthropic API. Please check your internet connection.');
      } else {
        throw new Error(`AI request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  async generateUIAtLocation(
    userInstruction: string, 
    location: { x: number; y: number; width: number; height: number },
    pageContext: PageContext,
    screenshotBase64?: string
  ): Promise<WebFeatureResponse> {
    try {
      // Use the same Anthropic client but with UI-specific system prompt
      const messages = this.buildUIGenerationMessages(userInstruction, location, pageContext, screenshotBase64);
      const response = await this.makeAnthropicAPICall(messages, undefined, UI_GENERATOR_SYSTEM_PROMPT);
      return this.parseResponse(response);
    } catch (error) {
      console.error('UI generation failed:', error);
      
      if (error instanceof Anthropic.AuthenticationError) {
        throw new Error('Invalid API key. Please check your Anthropic API key in settings.');
      } else if (error instanceof Anthropic.RateLimitError) {
        throw new Error('Rate limit exceeded. Please try again later.');
      } else if (error instanceof Anthropic.APIConnectionError) {
        throw new Error('Unable to connect to Anthropic API. Please check your internet connection.');
      } else {
        throw new Error(`UI generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

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
    // Truncate very long class names
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

  private buildUIGenerationMessages(
    userInstruction: string,
    location: { x: number; y: number; width: number; height: number },
    pageContext: PageContext,
    screenshotBase64?: string
  ): Anthropic.MessageParam[] {
    const content: Anthropic.MessageParam['content'] = [];

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
- Title: ${pageContext.domSummary.title}

Your task:
1. Create HTML/CSS/JavaScript for a UI component that fits in the specified location
2. The component should be positioned at the exact coordinates using fixed or absolute positioning
3. Make it visually appealing with modern design (use gradients, shadows, rounded corners)
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

    // Add screenshot if available (very helpful for UI generation)
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

    // Determine how many elements to include based on token budget
    // Start conservative to leave room for tool results (which can be large)
    let maxElements = Math.min(30, pageContext.domSummary.elements.length);
    
    // Build the text content - keep it concise to avoid token limits
    let textContent = this.buildPageContextText(userInstruction, pageContext, maxElements);
    
    // Check token count and reduce elements if needed
    let textTokens = countMessageTokens([{ role: 'user', content: textContent }], WEB_FEATURE_BUILDER_SYSTEM_PROMPT);
    
    // If we're using more than 30% of tokens just for the initial context, reduce elements
    // This leaves plenty of room for tool results
    while (textTokens.percentUsed > 30 && maxElements > 10) {
      maxElements = Math.floor(maxElements * 0.7); // Reduce by 30%
      textContent = this.buildPageContextText(userInstruction, pageContext, maxElements);
      textTokens = countMessageTokens([{ role: 'user', content: textContent }], WEB_FEATURE_BUILDER_SYSTEM_PROMPT);
    }
    
    console.log(`Web Augmenter: Including ${maxElements} DOM elements in context (${textTokens.totalTokens.toLocaleString()} tokens, ${textTokens.percentUsed.toFixed(1)}% of limit)`);

    content.push({
      type: 'text',
      text: textContent
    });

    // Add screenshot if available
    if (screenshotBase64) {
      // Remove data URL prefix if present
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

  private async makeAnthropicAPICall(
    messages: Anthropic.MessageParam[], 
    tabId?: number,
    systemPrompt: string = WEB_FEATURE_BUILDER_SYSTEM_PROMPT
  ): Promise<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    // Count tokens BEFORE making the API call
    const tokenCount = countMessageTokens(messages, systemPrompt);
    logTokenUsage(tokenCount, 'Initial request');

    // Check if we're within the token limit
    if (!tokenCount.withinLimit) {
      const excess = tokenCount.totalTokens - tokenCount.maxTokens;
      throw new Error(
        `Prompt is too long: ${tokenCount.totalTokens.toLocaleString()} tokens > ${tokenCount.maxTokens.toLocaleString()} maximum. ` +
        `Exceeds limit by ${excess.toLocaleString()} tokens. Try reducing the page complexity or use a simpler instruction.`
      );
    }

    // Warn if we're using more than 80% of the limit
    if (tokenCount.percentUsed > 80) {
      console.warn(
        `⚠️ Token usage is high (${tokenCount.percentUsed.toFixed(1)}%). ` +
        `Consider reducing page context to avoid hitting limits.`
      );
    }

    // Define tools for DOM exploration
    const tools: Anthropic.Tool[] = [
      {
        name: 'search_dom',
        description: 'Search the DOM for elements matching a CSS selector. Returns element details including tag, id, class, text content, and attributes.',
        input_schema: {
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
        input_schema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the element to read'
            },
            includeHTML: {
              type: 'boolean',
              description: 'Whether to include the element\'s innerHTML'
            }
          },
          required: ['selector']
        }
      },
      {
        name: 'get_page_structure',
        description: 'Get a hierarchical structure of the page DOM, showing parent-child relationships.',
        input_schema: {
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
        input_schema: {
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
        input_schema: {
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

    // Tool execution loop
    let currentMessages = [...messages];
    let maxIterations = 5; // Prevent infinite loops
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      // Check token count before each iteration
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

      // Make API call
      const response = await this.anthropic.messages.create({
        model: this.config.model!,
        max_tokens: 4000,
        system: systemPrompt,
        messages: currentMessages,
        tools: tools
      });

      // Check if Claude wants to use tools
      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
      
      if (toolUseBlocks.length === 0) {
        // No tools requested, extract final answer
        const textContent = response.content.find(content => content.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          throw new Error('No text content in Anthropic API response');
        }
        return textContent.text;
      }

      // Execute tools
      console.log(`Web Augmenter: Claude requested ${toolUseBlocks.length} tool(s)`);
      
      // Add assistant's response to messages
      currentMessages.push({
        role: 'assistant',
        content: response.content
      });

      // Execute each tool and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      
      for (const toolBlock of toolUseBlocks) {
        if (toolBlock.type !== 'tool_use') continue;
        
        console.log(`Web Augmenter: Executing tool: ${toolBlock.name}`, toolBlock.input);
        
        let toolResult: string;
        
        if (tabId) {
          // Execute tool in content script
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
        
        // Truncate tool results if they're too large
        // Limit each tool result to ~10k tokens (35k characters) to prevent overflow
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

      // Add tool results to messages
      currentMessages.push({
        role: 'user',
        content: toolResults
      });
    }

    throw new Error('Max tool execution iterations reached');
  }

  private getMockResponse(userInstruction: string): WebFeatureResponse {
    const instruction = userInstruction || 'create a feature';

    // Generate contextual mock responses based on common patterns
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
          // Create dark mode toggle
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
          // Hide common distraction elements
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

          // Focus on main content
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

    // Default mock response
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

  private parseResponse(response: string): WebFeatureResponse {
    try {
      let jsonString = response.trim();

      // Strategy 1: Check if response is wrapped in markdown code blocks
      if (jsonString.includes('```')) {
        const codeBlockMatch = jsonString.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (codeBlockMatch) {
          jsonString = codeBlockMatch[1].trim();
        }
      }

      // Strategy 2: If there's text before the JSON, try to extract just the JSON
      // Look for the first { and last } to extract the JSON object
      if (!jsonString.startsWith('{')) {
        const firstBrace = jsonString.indexOf('{');
        const lastBrace = jsonString.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonString = jsonString.substring(firstBrace, lastBrace + 1);
        }
      }

      // Strategy 3: Remove any trailing text after the JSON
      if (jsonString.endsWith('}') === false) {
        const lastBrace = jsonString.lastIndexOf('}');
        if (lastBrace !== -1) {
          jsonString = jsonString.substring(0, lastBrace + 1);
        }
      }

      const parsed = JSON.parse(jsonString);

      // Validate required fields
      if (!parsed.high_level_goal || !parsed.plan) {
        throw new Error('Invalid response format: missing required fields');
      }

      if (!Array.isArray(parsed.plan)) {
        throw new Error('Invalid response format: plan must be an array');
      }

      // Ensure at least CSS or script is provided
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

  updateConfig(config: Partial<LLMClientConfig>): void {
    this.config = { ...this.config, ...config };

    // Reinitialize client if API key changed
    if (config.apiKey !== undefined) {
      if (config.apiKey) {
        this.initializeClient();
      } else {
        this.anthropic = null;
      }
    }
  }
}

export const llmClient = new LLMClient();