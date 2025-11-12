import { DOMSnapshot, DOMElementInfo } from './types.js';
import { DOM_SNAPSHOT_CONFIG } from './constants.js';

export class DOMSnapshotGenerator {
  generate(): DOMSnapshot {
    const url = window.location.href;
    const hostname = window.location.hostname;
    const title = document.title;

    const elements = this.collectImportantElements();
    const fullHTML = this.captureFullHTML();

    return {
      url,
      hostname,
      title,
      elements,
      fullHTML
    };
  }

  private captureFullHTML(): string | undefined {
    if (!DOM_SNAPSHOT_CONFIG.INCLUDE_FULL_HTML) {
      return undefined;
    }

    try {
      // Get the complete HTML
      let html = document.documentElement.outerHTML;

      // Clean up the HTML
      html = this.cleanHTML(html);

      // Truncate if too long
      if (html.length > DOM_SNAPSHOT_CONFIG.MAX_HTML_LENGTH) {
        console.warn(`HTML snapshot truncated from ${html.length} to ${DOM_SNAPSHOT_CONFIG.MAX_HTML_LENGTH} characters`);
        html = html.substring(0, DOM_SNAPSHOT_CONFIG.MAX_HTML_LENGTH) + '\n<!-- ... HTML truncated ... -->';
      }

      return html;
    } catch (error) {
      console.error('Failed to capture full HTML:', error);
      return undefined;
    }
  }

  private cleanHTML(html: string): string {
    // Remove script tags content (keep structure but remove code)
    html = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '<script>/* script removed */</script>');
    
    // Remove inline event handlers
    html = html.replace(/\s+on\w+="[^"]*"/gi, '');
    html = html.replace(/\s+on\w+='[^']*'/gi, '');
    
    // Remove style tags content (keep structure)
    html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, '<style>/* styles removed */</style>');
    
    // Remove inline styles (optional - comment out if you want to keep them)
    // html = html.replace(/\s+style="[^"]*"/gi, '');
    
    // Remove comments
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    
    return html;
  }

  private collectImportantElements(): DOMElementInfo[] {
    const elements: DOMElementInfo[] = [];
    let count = 0;

    // Start with important semantic elements
    const importantSelectors = [
      'header', 'nav', 'main', 'article', 'section', 'aside', 'footer',
      '[role="banner"]', '[role="navigation"]', '[role="main"]',
      '[role="complementary"]', '[role="contentinfo"]',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'button', 'input', 'select', 'textarea',
      'video', 'audio', 'canvas', 'iframe',
      '[data-testid]', '[aria-label]'
    ];

    // Collect important elements first
    for (const selector of importantSelectors) {
      if (count >= DOM_SNAPSHOT_CONFIG.MAX_ELEMENTS) break;

      const foundElements = document.querySelectorAll(selector);
      for (const element of foundElements) {
        if (count >= DOM_SNAPSHOT_CONFIG.MAX_ELEMENTS) break;

        const info = this.extractElementInfo(element as HTMLElement);
        if (info && this.shouldIncludeElement(element as HTMLElement)) {
          elements.push(info);
          count++;
        }
      }
    }

    // Then collect other visible elements
    if (count < DOM_SNAPSHOT_CONFIG.MAX_ELEMENTS) {
      const allElements = document.querySelectorAll('*');
      for (const element of allElements) {
        if (count >= DOM_SNAPSHOT_CONFIG.MAX_ELEMENTS) break;

        if (!this.isAlreadyIncluded(element as HTMLElement, elements)) {
          const info = this.extractElementInfo(element as HTMLElement);
          if (info && this.shouldIncludeElement(element as HTMLElement)) {
            elements.push(info);
            count++;
          }
        }
      }
    }

    return elements;
  }

  private extractElementInfo(element: HTMLElement): DOMElementInfo | null {
    const tagName = element.tagName.toLowerCase();

    // Skip script, style, and other non-content elements
    if (['script', 'style', 'noscript', 'meta', 'link'].includes(tagName)) {
      return null;
    }

    const info: DOMElementInfo = {
      tagName
    };

    // Add ID if present
    if (element.id) {
      info.id = element.id;
    }

    // Add class names (limit to most relevant ones)
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim();
      if (classes) {
        info.className = classes;
      }
    }

    // Add ARIA and semantic attributes
    if (element.getAttribute('role')) {
      info.role = element.getAttribute('role')!;
    }

    if (element.getAttribute('aria-label')) {
      info.ariaLabel = element.getAttribute('aria-label')!;
    }

    // Add text content (trimmed)
    const text = this.getElementText(element);
    if (text) {
      info.innerText = text;
    }

    // Generate a simple selector
    info.selector = this.generateSelector(element);

    return info;
  }

  private getElementText(element: HTMLElement): string | undefined {
    // For form inputs, get the value or placeholder
    if (element instanceof HTMLInputElement) {
      return element.value || element.placeholder || undefined;
    }

    if (element instanceof HTMLTextAreaElement) {
      return element.value || element.placeholder || undefined;
    }

    // For other elements, get text content but avoid nested elements
    let text = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || '';
      }
    }

    text = text.trim();
    if (text.length === 0) return undefined;

    // Truncate long text
    if (text.length > DOM_SNAPSHOT_CONFIG.MAX_TEXT_LENGTH) {
      return text.substring(0, DOM_SNAPSHOT_CONFIG.MAX_TEXT_LENGTH) + '...';
    }

    return text;
  }

  private generateSelector(element: HTMLElement): string {
    // Try ID first
    if (element.id && this.isValidCSSIdentifier(element.id)) {
      return `#${this.escapeCSSIdentifier(element.id)}`;
    }

    // Try unique class combinations
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/)
        .filter(cls => cls && this.isValidCSSIdentifier(cls));

      if (classes.length > 0) {
        const escapedClasses = classes.map(cls => this.escapeCSSIdentifier(cls));
        const classSelector = `.${escapedClasses.join('.')}`;

        // Check if it's unique enough (not too many matches)
        try {
          const matches = document.querySelectorAll(classSelector);
          if (matches.length <= 5) {
            return classSelector;
          }
        } catch (e) {
          // Invalid selector, continue to next method
          console.warn('Invalid class selector generated:', classSelector, e);
        }
      }
    }

    // Try role attribute
    if (element.getAttribute('role')) {
      return `[role="${element.getAttribute('role')}"]`;
    }

    // Try data attributes
    for (const attr of element.attributes) {
      if (attr.name.startsWith('data-') && attr.value) {
        const selector = `[${attr.name}="${this.escapeCSSValue(attr.value)}"]`;
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length <= 3) {
            return selector;
          }
        } catch (e) {
          // Invalid selector, continue to next attribute
          continue;
        }
      }
    }

    // Fall back to tag name with index
    const tagName = element.tagName.toLowerCase();
    const siblings = Array.from(element.parentElement?.children || []).filter(
      el => el.tagName.toLowerCase() === tagName
    );

    if (siblings.length === 1) {
      return tagName;
    }

    const index = siblings.indexOf(element);
    return `${tagName}:nth-of-type(${index + 1})`;
  }

  private shouldIncludeElement(element: HTMLElement): boolean {
    // Skip if element is hidden (if configured to do so)
    if (DOM_SNAPSHOT_CONFIG.SKIP_HIDDEN_ELEMENTS) {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0') {
        return false;
      }

      // Skip if element has no dimensions
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return false;
      }
    }

    // Skip if it's likely a tracking or analytics element
    // Convert className to string (handles SVGAnimatedString and DOMTokenList)
    const classNameStr = typeof element.className === 'string'
      ? element.className
      : element.className?.toString() || '';
    const id = element.id || '';
    const suspiciousTerms = ['analytics', 'tracking', 'gtm', 'facebook', 'twitter', 'pixel'];

    for (const term of suspiciousTerms) {
      if (classNameStr.includes(term) || id.includes(term)) {
        return false;
      }
    }

    return true;
  }

  private isAlreadyIncluded(element: HTMLElement, elements: DOMElementInfo[]): boolean {
    const selector = this.generateSelector(element);
    return elements.some(info => info.selector === selector);
  }

  /**
   * Check if a string is a valid CSS identifier (can be used in class/ID selectors)
   * CSS identifiers cannot contain spaces or most special characters
   */
  private isValidCSSIdentifier(identifier: string): boolean {
    if (!identifier || identifier.length === 0) {
      return false;
    }

    // CSS identifiers can only contain: a-z A-Z 0-9 _ - and non-ASCII characters
    // They cannot start with a digit (unless escaped)
    // For simplicity, we'll reject identifiers with special characters that need escaping
    const invalidChars = /[^\w\-]/;
    return !invalidChars.test(identifier);
  }

  /**
   * Escape CSS identifiers for use in selectors
   * This handles special characters that need escaping in CSS
   */
  private escapeCSSIdentifier(identifier: string): string {
    // Use CSS.escape if available (modern browsers)
    if (typeof CSS !== 'undefined' && CSS.escape) {
      return CSS.escape(identifier);
    }

    // Fallback: manual escaping
    return identifier.replace(/[!"#$%&'()*+,.\/:;<=>?@\[\\\]^`{|}~]/g, '\\$&');
  }

  /**
   * Escape attribute values for use in CSS selectors
   */
  private escapeCSSValue(value: string): string {
    // Escape quotes and backslashes in attribute values
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}

export const domSnapshotGenerator = new DOMSnapshotGenerator();