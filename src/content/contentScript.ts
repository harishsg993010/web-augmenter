import {
  MessageFromPopup,
  MessageFromBackground,
  MessageToContent,
  PageContext,
  CustomFeature
} from '../shared/types.js';
import { MESSAGE_TYPES } from '../shared/constants.js';
import { domSnapshotGenerator } from '../shared/domSnapshot.js';
import { persistence } from '../shared/persistence.js';
import { patchInjector } from './injectPatches.js';
import { toolExecutor } from './toolExecutor.js';

class ContentScript {
  private isReady = false;
  private autoAppliedFeatures: Set<string> = new Set();
  private extensionContextValid = true;

  constructor() {
    this.init();
  }

  private isExtensionContextValid(): boolean {
    // Check if chrome extension context is still valid
    try {
      // This will throw if extension context is invalidated
      if (!chrome?.runtime?.id) {
        this.extensionContextValid = false;
        return false;
      }
      return true;
    } catch (error) {
      this.extensionContextValid = false;
      return false;
    }
  }

  private async init(): Promise<void> {
    try {
      // Wait for DOM to be ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.onDOMReady());
      } else {
        this.onDOMReady();
      }

      this.setupMessageListeners();
      this.setupUtilityLibrary();

    } catch (error) {
      console.error('Web Augmenter: Failed to initialize content script:', error);
    }
  }

  private onDOMReady(): void {
    this.isReady = true;
    console.log('Web Augmenter: Content script ready');

    // Auto-apply features for this site
    this.autoApplyFeatures();

    // Set up mutation observer for dynamic content
    this.setupMutationObserver();
  }

  private setupMessageListeners(): void {
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender)
        .then(response => {
          if (response) {
            sendResponse(response);
          }
        })
        .catch(error => {
          console.error('Web Augmenter: Error handling message:', error);
          sendResponse({
            type: MESSAGE_TYPES.ERROR,
            error: error.message || 'Unknown error'
          });
        });

      // Return true for async response
      return true;
    });

    // Listen for messages from popup via window events
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;

      if (event.data.type === 'WEB_AUGMENTER_EXECUTE') {
        this.handleExecuteInstruction(event.data.userInstruction, event.data.includeScreenshot);
      }
    });
  }

  private async handleMessage(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
    try {
      switch (message.type) {
        case 'PING':
          // Respond to ping to confirm content script is loaded
          return { type: 'PONG' };

        case MESSAGE_TYPES.EXECUTE_INSTRUCTION:
          return await this.handleExecuteInstruction(message.userInstruction, message.includeScreenshot);

        case MESSAGE_TYPES.INJECT_PATCHES:
          return await this.handleInjectPatches(message as MessageToContent);

        case 'GET_PAGE_INFO':
          return this.handleGetPageInfo();

        case 'REMOVE_ALL_PATCHES':
          return this.handleRemoveAllPatches();

        case 'CONTEXT_MENU_CLICKED':
          return this.handleContextMenuClicked();

        case 'STORAGE_CHANGED':
          return this.handleStorageChanged(message.changes);

        case 'APPLY_CUSTOM_FEATURE':
          return await this.handleApplyCustomFeature(message.featureId);

        case MESSAGE_TYPES.EXECUTE_TOOL:
          return await this.handleExecuteTool(message.toolName, message.toolInput);

        default:
          console.warn('Web Augmenter: Unknown message type:', message.type);
          return undefined;
      }
    } catch (error) {
      console.error('Web Augmenter: Message handler error:', error);
      throw error;
    }
  }

  private async handleExecuteInstruction(userInstruction: string, includeScreenshot: boolean): Promise<any> {
    try {
      if (!this.isReady) {
        throw new Error('Content script not ready');
      }

      console.log('Web Augmenter: Executing instruction:', userInstruction);

      // Generate DOM snapshot
      const domSummary = domSnapshotGenerator.generate();

      const pageContext: PageContext = {
        domSummary,
        url: window.location.href,
        hostname: window.location.hostname,
        userInstruction
      };

      // Send to background script with screenshot flag
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PAGE_CONTEXT_READY,
        pageContext,
        includeScreenshot
      });

      if (response.type === MESSAGE_TYPES.ERROR) {
        throw new Error(response.error);
      }

      // Return success response to popup (important: prevents "message channel closed" error)
      return {
        type: 'INSTRUCTION_RECEIVED',
        success: true
      };

    } catch (error) {
      console.error('Web Augmenter: Failed to execute instruction:', error);
      // Return error response instead of throwing (prevents message channel errors)
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async handleInjectPatches(message: MessageToContent): Promise<void> {
    try {
      await patchInjector.injectPatches(message.patches);

      // Show detailed success notification
      const hasCSS = message.patches.css && message.patches.css.length > 0;
      const hasScript = message.patches.script && message.patches.script.length > 0;
      
      let details = '';
      if (hasCSS && hasScript) {
        details = ' (CSS + JS)';
      } else if (hasCSS) {
        details = ' (CSS only)';
      } else if (hasScript) {
        details = ' (JS only)';
      } else {
        details = ' (No changes generated)';
      }

      this.showNotification(
        `✓ Applied: ${message.patches.high_level_goal}${details}`,
        hasCSS || hasScript ? 'success' : 'error'
      );

      // Log details for debugging
      console.log('Web Augmenter: Patch details', {
        goal: message.patches.high_level_goal,
        hasCSS,
        hasScript,
        cssLength: message.patches.css?.length || 0,
        scriptLength: message.patches.script?.length || 0
      });

    } catch (error) {
      console.error('Web Augmenter: Failed to inject patches:', error);
      this.showNotification('Failed to apply changes', 'error');
      throw error;
    }
  }

  private handleGetPageInfo(): any {
    return {
      type: 'PAGE_INFO_RESPONSE',
      pageInfo: {
        url: window.location.href,
        hostname: window.location.hostname,
        title: document.title,
        hasActivePatches: patchInjector.hasActivePatches(),
        autoAppliedFeatures: Array.from(this.autoAppliedFeatures)
      }
    };
  }

  private handleRemoveAllPatches(): void {
    patchInjector.removeAllInjectedElements();
    this.autoAppliedFeatures.clear();
    this.showNotification('All Web Augmenter features removed', 'info');
  }

  private handleContextMenuClicked(): void {
    // Signal to popup that context menu was clicked
    window.postMessage({
      type: 'WEB_AUGMENTER_CONTEXT_MENU',
      url: window.location.href
    }, '*');
  }

  private async handleStorageChanged(changes: any): Promise<void> {
    // Re-apply auto-features if custom features changed
    if (changes.customFeatures) {
      this.autoApplyFeatures();
    }
  }

  private async handleApplyCustomFeature(featureId: string): Promise<void> {
    try {
      const features = await persistence.getAllCustomFeatures();
      const feature = features.find(f => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      await patchInjector.injectPatches({
        high_level_goal: feature.name,
        plan: [`Apply saved feature: ${feature.name}`],
        script: feature.script,
        css: feature.css,
        notes_for_extension: `Applied custom feature: ${feature.name}`
      });

      this.autoAppliedFeatures.add(featureId);
      this.showNotification(`Applied: ${feature.name}`, 'success');

    } catch (error) {
      console.error('Web Augmenter: Failed to apply custom feature:', error);
      this.showNotification(`Failed to apply feature`, 'error');
      throw error;
    }
  }

  private async autoApplyFeatures(): Promise<void> {
    try {
      // Check if extension context is still valid (not invalidated by reload)
      if (!this.isExtensionContextValid()) {
        console.log('Web Augmenter: Extension context invalidated, skipping auto-apply. Please refresh the page.');
        return;
      }

      // Check if site is disabled
      const isDisabled = await persistence.isSiteDisabled(window.location.hostname);
      if (isDisabled) {
        console.log('Web Augmenter: Site disabled, skipping auto-apply');
        return;
      }

      // Get features that should auto-apply
      const features = await persistence.getFeaturesForSite(window.location.href);

      for (const feature of features) {
        if (this.autoAppliedFeatures.has(feature.id)) {
          continue; // Already applied
        }

        try {
          await patchInjector.injectPatches({
            high_level_goal: feature.name,
            plan: [`Auto-apply: ${feature.name}`],
            script: feature.script,
            css: feature.css,
            notes_for_extension: `Auto-applied feature: ${feature.name}`
          });

          this.autoAppliedFeatures.add(feature.id);
          console.log(`Web Augmenter: Auto-applied feature: ${feature.name}`);

        } catch (error) {
          console.error(`Web Augmenter: Failed to auto-apply feature ${feature.name}:`, error);
        }
      }

      if (features.length > 0) {
        this.showNotification(
          `Auto-applied ${features.length} feature(s)`,
          'info'
        );
      }

    } catch (error) {
      // Check if error is due to invalidated extension context
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Extension context invalidated')) {
        console.log('Web Augmenter: Extension was reloaded. Please refresh the page to use the extension.');
        this.extensionContextValid = false;
        return;
      }
      console.error('Web Augmenter: Failed to auto-apply features:', error);
    }
  }

  private setupMutationObserver(): void {
    // Watch for dynamic content changes
    const observer = new MutationObserver((mutations) => {
      let hasSignificantChanges = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Check if added nodes are significant (not just text or small elements)
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (element.tagName && !element.hasAttribute('data-web-augmenter')) {
                hasSignificantChanges = true;
                break;
              }
            }
          }
        }

        if (hasSignificantChanges) break;
      }

      if (hasSignificantChanges) {
        // Debounce re-application
        this.debounceReapply();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  private reapplyTimeout: number | null = null;

  private debounceReapply(): void {
    if (this.reapplyTimeout) {
      clearTimeout(this.reapplyTimeout);
    }

    this.reapplyTimeout = setTimeout(() => {
      // Re-apply auto features for dynamic content
      this.autoApplyFeatures();
      this.reapplyTimeout = null;
    }, 1000) as any;
  }

  private setupUtilityLibrary(): void {
    // Setup utility library directly in the content script context instead of injecting scripts
    // This avoids CSP issues while still providing utilities for generated scripts
    (window as any).WebAugmenterUtils = {
      observeAddedNodes: function(callback: (node: Element) => void) {
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
              mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  callback(node as Element);
                }
              });
            }
          });
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return observer;
      },

      hideElements: function(selector: string) {
        document.querySelectorAll(selector).forEach(el => {
          (el as HTMLElement).style.display = 'none';
        });
      },

      showElements: function(selector: string) {
        document.querySelectorAll(selector).forEach(el => {
          (el as HTMLElement).style.display = '';
        });
      },

      findMainContent: function() {
        const candidates = [
          document.querySelector('main'),
          document.querySelector('[role="main"]'),
          document.querySelector('article'),
          document.querySelector('.main-content'),
          document.querySelector('#main-content'),
          document.querySelector('.content')
        ];

        return candidates.find(el => el && (el as HTMLElement).offsetHeight > 100) || document.body;
      },

      createFloatingButton: function(text: string, onClick: () => void, position = { top: '20px', right: '20px' }) {
        const button = document.createElement('div');
        button.textContent = text;
        button.style.cssText = `
          position: fixed;
          top: ${position.top};
          right: ${position.right};
          background: #007cba;
          color: white;
          padding: 10px 15px;
          border-radius: 5px;
          cursor: pointer;
          z-index: 10000;
          font-family: Arial, sans-serif;
          font-size: 14px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.2);
          transition: all 0.3s ease;
          user-select: none;
        `;

        button.addEventListener('mouseenter', () => {
          button.style.background = '#005a8b';
        });

        button.addEventListener('mouseleave', () => {
          button.style.background = '#007cba';
        });

        button.addEventListener('click', onClick);
        document.body.appendChild(button);
        return button;
      }
    };
  }

  private async handleExecuteTool(toolName: string, toolInput: any): Promise<any> {
    try {
      console.log(`Web Augmenter: Executing tool: ${toolName}`, toolInput);
      const result = await toolExecutor.executeTool(toolName, toolInput);
      
      return {
        type: MESSAGE_TYPES.TOOL_RESULT,
        result
      };
    } catch (error) {
      console.error('Web Augmenter: Tool execution error:', error);
      return {
        type: MESSAGE_TYPES.TOOL_RESULT,
        result: JSON.stringify({ error: `Tool execution failed: ${error}` })
      };
    }
  }

  private showNotification(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      z-index: 10001;
      font-family: Arial, sans-serif;
      font-size: 14px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      max-width: 400px;
      text-align: center;
    `;

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
      try {
        notification.remove();
      } catch (e) {
        // Element might have been removed already
      }
    }, 3000);
  }
}

// Initialize content script
new ContentScript();