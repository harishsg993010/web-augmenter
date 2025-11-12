import Anthropic from '@anthropic-ai/sdk';
import { LLMRequest, WebFeatureResponse, PageContext } from './types.js';
import { WEB_FEATURE_BUILDER_SYSTEM_PROMPT } from './constants.js';

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

  async callWebFeatureBuilder(request: LLMRequest): Promise<WebFeatureResponse> {
    const { userInstruction, pageContext, screenshotBase64 } = request;

    try {
      if (!this.anthropic) {
        console.warn('No Anthropic client configured. Using mock response for demonstration.');
        return this.getMockResponse(userInstruction);
      }

      const messages = this.buildMessages(userInstruction, pageContext, screenshotBase64);
      const response = await this.makeAnthropicAPICall(messages);
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

  private buildMessages(userInstruction: string, pageContext: PageContext, screenshotBase64?: string): Anthropic.MessageParam[] {
    const content: Anthropic.MessageParam['content'] = [];

    // Build the text content with full HTML if available
    let textContent = `Please analyze this web page and implement the user's request.

User Request: "${userInstruction}"

Page Context:
- URL: ${pageContext.url}
- Hostname: ${pageContext.hostname}
- Title: ${pageContext.domSummary.title}
- DOM Elements: ${pageContext.domSummary.elements.length} key elements detected

`;

    // Add full HTML structure if available
    if (pageContext.domSummary.fullHTML) {
      textContent += `Complete HTML Structure:
\`\`\`html
${pageContext.domSummary.fullHTML}
\`\`\`

`;
    }

    // Add key elements summary
    textContent += `Key Page Elements (Summary):
${pageContext.domSummary.elements.slice(0, 100).map(el => {
  const parts = [];
  if (el.tagName) parts.push(`<${el.tagName}>`);
  if (el.id) parts.push(`id="${el.id}"`);
  if (el.className) parts.push(`class="${el.className}"`);
  if (el.role) parts.push(`role="${el.role}"`);
  if (el.innerText && el.innerText.length < 100) parts.push(`text="${el.innerText}"`);
  return `- ${parts.join(' ')}`;
}).join('\n')}

Please respond with valid JSON following the exact schema specified in the system prompt.`;

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

  private async makeAnthropicAPICall(messages: Anthropic.MessageParam[]): Promise<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const response = await this.anthropic.messages.create({
      model: this.config.model!,
      max_tokens: 4000,
      system: WEB_FEATURE_BUILDER_SYSTEM_PROMPT,
      messages: messages
    });

    // Extract text content from response
    if (response.content.length === 0) {
      throw new Error('Empty response from Anthropic API');
    }

    const textContent = response.content.find(content => content.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in Anthropic API response');
    }

    return textContent.text;
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
      // Strip markdown code blocks if present
      let jsonString = response.trim();

      // Check if response is wrapped in markdown code blocks
      if (jsonString.startsWith('```')) {
        // Remove opening fence (```json or ```)
        const lines = jsonString.split('\n');
        lines.shift(); // Remove first line (```json or ```)

        // Remove closing fence (```)
        if (lines[lines.length - 1].trim() === '```') {
          lines.pop();
        }

        jsonString = lines.join('\n').trim();
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
      console.error('Failed to parse LLM response:', response);
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