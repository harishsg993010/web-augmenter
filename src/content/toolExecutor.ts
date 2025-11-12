// Tool executor that runs in the page context
export class ToolExecutor {
  async executeTool(toolName: string, toolInput: any): Promise<string> {
    try {
      switch (toolName) {
        case 'search_dom':
          return this.searchDOM(toolInput.selector);
        
        case 'read_element':
          return this.readElement(toolInput.selector, toolInput.includeHTML);
        
        case 'get_page_structure':
          return this.getPageStructure(toolInput.maxDepth, toolInput.rootSelector);
        
        case 'search_page_source':
          return this.searchPageSource(toolInput.searchTerm, toolInput.maxResults);
        
        case 'read_page_source':
          return this.readPageSource(toolInput.startLine, toolInput.endLine);
        
        default:
          return JSON.stringify({ error: `Unknown tool: ${toolName}` });
      }
    } catch (error) {
      return JSON.stringify({ error: `Tool execution failed: ${error}` });
    }
  }

  private searchDOM(selector: string): string {
    try {
      const elements = document.querySelectorAll(selector);
      if (elements.length === 0) {
        return JSON.stringify({ 
          found: 0, 
          message: `No elements found matching selector: ${selector}` 
        });
      }
      
      const results = Array.from(elements).slice(0, 20).map((el, idx) => {
        const element = el as HTMLElement;
        return {
          index: idx,
          tagName: element.tagName.toLowerCase(),
          id: element.id || undefined,
          className: element.className || undefined,
          textContent: element.textContent?.trim().substring(0, 100) || undefined,
          attributes: Array.from(element.attributes).reduce((acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          }, {} as Record<string, string>)
        };
      });
      
      return JSON.stringify({
        found: elements.length,
        showing: results.length,
        elements: results
      }, null, 2);
    } catch (error) {
      return JSON.stringify({ error: `Failed to search DOM: ${error}` });
    }
  }

  private readElement(selector: string, includeHTML?: boolean): string {
    try {
      const element = document.querySelector(selector) as HTMLElement;
      if (!element) {
        return JSON.stringify({ error: `Element not found: ${selector}` });
      }
      
      const computedStyle = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      
      const result: any = {
        tagName: element.tagName.toLowerCase(),
        id: element.id || undefined,
        className: element.className || undefined,
        textContent: element.textContent?.trim() || undefined,
        attributes: Array.from(element.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {} as Record<string, string>),
        position: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        },
        computedStyles: {
          display: computedStyle.display,
          position: computedStyle.position,
          visibility: computedStyle.visibility,
          backgroundColor: computedStyle.backgroundColor,
          color: computedStyle.color,
          fontSize: computedStyle.fontSize,
          zIndex: computedStyle.zIndex
        }
      };
      
      if (includeHTML) {
        result.innerHTML = element.innerHTML.substring(0, 5000);
      }
      
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({ error: `Failed to read element: ${error}` });
    }
  }

  private getPageStructure(maxDepth?: number, rootSelector?: string): string {
    try {
      const root = rootSelector 
        ? document.querySelector(rootSelector) 
        : document.body;
      
      if (!root) {
        return JSON.stringify({ error: 'Root element not found' });
      }
      
      const depth = maxDepth || 3;
      
      const buildTree = (element: Element, currentDepth: number): any => {
        if (currentDepth > depth) return null;
        
        const el = element as HTMLElement;
        const node: any = {
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          class: el.className || undefined,
          children: []
        };
        
        // Only include direct children, limit to 10 per level
        const children = Array.from(el.children).slice(0, 10);
        for (const child of children) {
          const childNode = buildTree(child, currentDepth + 1);
          if (childNode) {
            node.children.push(childNode);
          }
        }
        
        if (node.children.length === 0) {
          delete node.children;
        }
        
        return node;
      };
      
      const structure = buildTree(root, 0);
      return JSON.stringify(structure, null, 2);
    } catch (error) {
      return JSON.stringify({ error: `Failed to get page structure: ${error}` });
    }
  }

  private searchPageSource(searchTerm: string, maxResults?: number): string {
    try {
      // Get the raw HTML source
      const htmlSource = document.documentElement.outerHTML;
      const lines = htmlSource.split('\n');
      
      const limit = maxResults || 20;
      const results: Array<{ lineNumber: number; line: string; context: string[] }> = [];
      
      // Search for the term (case-insensitive)
      const searchRegex = new RegExp(searchTerm, 'gi');
      
      for (let i = 0; i < lines.length && results.length < limit; i++) {
        if (searchRegex.test(lines[i])) {
          // Get context lines (2 before, 2 after)
          const contextStart = Math.max(0, i - 2);
          const contextEnd = Math.min(lines.length, i + 3);
          const context = lines.slice(contextStart, contextEnd);
          
          results.push({
            lineNumber: i + 1,
            line: lines[i].trim(),
            context: context.map((line, idx) => {
              const lineNum = contextStart + idx + 1;
              const marker = lineNum === i + 1 ? '→' : ' ';
              return `${marker} ${lineNum}: ${line}`;
            })
          });
        }
      }
      
      return JSON.stringify({
        searchTerm,
        totalLines: lines.length,
        matchesFound: results.length,
        results
      }, null, 2);
    } catch (error) {
      return JSON.stringify({ error: `Failed to search page source: ${error}` });
    }
  }

  private readPageSource(startLine?: number, endLine?: number): string {
    try {
      // Get the raw HTML source
      const htmlSource = document.documentElement.outerHTML;
      const lines = htmlSource.split('\n');
      
      const start = startLine ? Math.max(1, startLine) - 1 : 0;
      const end = endLine ? Math.min(lines.length, endLine) : Math.min(lines.length, start + 50);
      
      const selectedLines = lines.slice(start, end);
      const numberedLines = selectedLines.map((line, idx) => {
        const lineNum = start + idx + 1;
        return `${lineNum}: ${line}`;
      });
      
      return JSON.stringify({
        totalLines: lines.length,
        startLine: start + 1,
        endLine: end,
        linesShown: selectedLines.length,
        source: numberedLines.join('\n')
      }, null, 2);
    } catch (error) {
      return JSON.stringify({ error: `Failed to read page source: ${error}` });
    }
  }
}

export const toolExecutor = new ToolExecutor();
