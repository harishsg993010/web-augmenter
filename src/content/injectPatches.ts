import { WebFeatureResponse } from '../shared/types.js';

export class PatchInjector {
  private injectedElements: Set<string> = new Set();

  async injectPatches(response: WebFeatureResponse): Promise<void> {
    try {
      // Generate unique identifiers
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 9);
      const cssId = `web-augmenter-css-${timestamp}-${randomId}`;
      const scriptId = `web-augmenter-script-${timestamp}-${randomId}`;

      // Inject CSS first (CSS works fine with CSP)
      if (response.css) {
        await this.injectCSS(response.css, cssId);
      }

      // For scripts, request background script to inject via chrome.scripting API
      // This bypasses CSP restrictions
      if (response.script) {
        await this.requestScriptInjection(response.script, scriptId);
      }

      console.log('Web Augmenter: Patches injected successfully', {
        goal: response.high_level_goal,
        plan: response.plan,
        notes: response.notes_for_extension,
        cssLength: response.css?.length || 0,
        scriptLength: response.script?.length || 0,
        css: response.css,
        script: response.script
      });

    } catch (error) {
      console.error('Web Augmenter: Failed to inject patches:', error);
      throw error;
    }
  }

  private async requestScriptInjection(script: string, id: string): Promise<void> {
    try {
      // Ask background script to inject via chrome.scripting API
      // Tries direct MAIN world execution first, falls back to CSP bypass if needed
      const response = await chrome.runtime.sendMessage({
        type: 'INJECT_SCRIPT_VIA_API',
        script,
        id
      });

      if (response?.success) {
        const methodNames: Record<string, string> = {
          'userScripts': 'userScripts API (CSP-exempt)',
          'direct': 'direct MAIN world',
          'csp-bypass': 'CSP bypass pattern'
        };
        const method = methodNames[response.method] || response.method;
        console.log(`Web Augmenter: Script injected via ${method}`, { 
          id, 
          scriptLength: script.length,
          method: response.method 
        });
        this.injectedElements.add(id);
      } else {
        throw new Error(response?.error || 'Failed to inject script');
      }
    } catch (error) {
      console.error('Web Augmenter: Failed to request script injection:', error);
      throw error;
    }
  }

  private async injectCSS(css: string, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Remove any existing style with the same content hash
        const cssHash = this.hashString(css);
        this.removeExistingStyles(cssHash);

        // Create new style element
        const styleElement = document.createElement('style');
        styleElement.id = id;
        styleElement.setAttribute('data-web-augmenter', 'true');
        styleElement.setAttribute('data-css-hash', cssHash);
        styleElement.textContent = css;

        // Add to head
        const head = document.head || document.getElementsByTagName('head')[0];
        head.appendChild(styleElement);

        this.injectedElements.add(id);
        console.log('Web Augmenter: CSS injected', { id, cssLength: css.length, cssPreview: css.substring(0, 200) });
        resolve();

      } catch (error) {
        reject(new Error(`Failed to inject CSS: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    });
  }


  private removeExistingStyles(cssHash: string): void {
    const existingStyles = document.querySelectorAll(`style[data-css-hash="${cssHash}"]`);
    existingStyles.forEach(style => {
      try {
        style.remove();
        if (style.id) {
          this.injectedElements.delete(style.id);
        }
      } catch (e) {
        console.warn('Could not remove existing style:', e);
      }
    });
  }

  removeAllInjectedElements(): void {
    this.injectedElements.forEach(id => {
      try {
        const element = document.getElementById(id);
        if (element) {
          element.remove();
        }
      } catch (e) {
        console.warn(`Could not remove element ${id}:`, e);
      }
    });

    // Also remove any remaining web-augmenter elements
    const webAugmenterElements = document.querySelectorAll('[data-web-augmenter="true"]');
    webAugmenterElements.forEach(element => {
      try {
        element.remove();
      } catch (e) {
        console.warn('Could not remove web-augmenter element:', e);
      }
    });

    this.injectedElements.clear();
  }

  private hashString(str: string): string {
    let hash = 0;
    if (str.length === 0) return hash.toString();

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    return Math.abs(hash).toString(36);
  }

  getInjectedElementsCount(): number {
    return this.injectedElements.size;
  }

  hasActivePatches(): boolean {
    return this.injectedElements.size > 0 ||
           document.querySelectorAll('[data-web-augmenter="true"]').length > 0;
  }
}

export const patchInjector = new PatchInjector();