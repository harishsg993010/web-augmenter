import {
  MessageFromPopup,
  MessageFromBackground,
  MessageToContent,
  PageContext,
  CustomFeature,
  ElementInfo
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
  private selectedElement: Element | null = null;
  private highlightOverlay: HTMLElement | null = null;
  private savedElements: Map<string, ElementInfo> = new Map();
  private isPickerActive: boolean = false;
  private isDrawing: boolean = false;
  private drawStartX: number = 0;
  private drawStartY: number = 0;
  private selectionBox: HTMLElement | null = null;

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

    // Set up element tracking for context menu
    this.setupElementTracking();
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

        case 'ADD_ELEMENT_TO_AUGMENTER':
          return this.handleAddElementToAugmenter(message.selectionText);

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

  private async handleAddElementToAugmenter(selectionText?: string): Promise<void> {
    try {
      // Activate visual picker mode
      this.activateElementPicker(selectionText);
      
    } catch (error) {
      console.error('Web Augmenter: Failed to add element:', error);
      this.showNotification('Failed to add element', 'error');
    }
  }

  private activateElementPicker(selectionText?: string): void {
    this.isPickerActive = true;
    this.showNotification('📦 Draw a box around the element to select it. Press ESC to cancel.', 'info');
    
    // Create overlay to indicate picker mode
    const pickerOverlay = document.createElement('div');
    pickerOverlay.id = 'web-augmenter-picker-overlay';
    pickerOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 999998;
      cursor: crosshair;
      background: rgba(0, 0, 0, 0.01);
    `;
    
    // Mouse move handler - draw box
    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (this.isDrawing) {
        // Update selection box
        this.updateSelectionBox(e.clientX, e.clientY);
      }
    };
    
    // Mouse down handler - start drawing box
    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      this.isDrawing = true;
      this.drawStartX = e.clientX;
      this.drawStartY = e.clientY;
      
      // Create selection box
      this.selectionBox = document.createElement('div');
      this.selectionBox.id = 'web-augmenter-selection-box';
      this.selectionBox.style.cssText = `
        position: fixed;
        border: 2px dashed #007cba;
        background: rgba(0, 124, 186, 0.1);
        pointer-events: none;
        z-index: 999999;
      `;
      document.body.appendChild(this.selectionBox);
    };
    
    // Mouse up handler - finish drawing and select element
    const handleMouseUp = (e: MouseEvent) => {
      if (this.isDrawing) {
        e.preventDefault();
        e.stopPropagation();
        
        this.isDrawing = false;
        
        // Find element that best fits the drawn box
        const selectedElement = this.findElementInBox(
          Math.min(this.drawStartX, e.clientX),
          Math.min(this.drawStartY, e.clientY),
          Math.abs(e.clientX - this.drawStartX),
          Math.abs(e.clientY - this.drawStartY)
        );
        
        // Clean up selection box
        if (this.selectionBox) {
          this.selectionBox.remove();
          this.selectionBox = null;
        }
        
        if (selectedElement) {
          this.deactivateElementPicker(pickerOverlay, handleMouseMove, handleMouseDown, handleMouseUp, handleKeyDown);
          this.selectElementForAugmentation(selectedElement, selectionText);
        }
      }
    };
    
    
    // Keyboard handler - ESC to cancel
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.deactivateElementPicker(pickerOverlay, handleMouseMove, handleMouseDown, handleMouseUp, handleKeyDown);
        this.showNotification('Element picker cancelled', 'info');
      }
    };
    
    // Add event listeners
    pickerOverlay.addEventListener('mousemove', handleMouseMove);
    pickerOverlay.addEventListener('mousedown', handleMouseDown);
    pickerOverlay.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    
    document.body.appendChild(pickerOverlay);
  }

  private deactivateElementPicker(
    overlay: HTMLElement,
    mouseMoveHandler: (e: MouseEvent) => void,
    mouseDownHandler: (e: MouseEvent) => void,
    mouseUpHandler: (e: MouseEvent) => void,
    keyDownHandler: (e: KeyboardEvent) => void
  ): void {
    this.isPickerActive = false;
    this.isDrawing = false;
    
    overlay.removeEventListener('mousemove', mouseMoveHandler);
    overlay.removeEventListener('mousedown', mouseDownHandler);
    overlay.removeEventListener('mouseup', mouseUpHandler);
    document.removeEventListener('keydown', keyDownHandler);
    overlay.remove();
    
    if (this.highlightOverlay) {
      this.highlightOverlay.remove();
      this.highlightOverlay = null;
    }
    
    if (this.selectionBox) {
      this.selectionBox.remove();
      this.selectionBox = null;
    }
  }

  private updateSelectionBox(currentX: number, currentY: number): void {
    if (!this.selectionBox) return;
    
    const left = Math.min(this.drawStartX, currentX);
    const top = Math.min(this.drawStartY, currentY);
    const width = Math.abs(currentX - this.drawStartX);
    const height = Math.abs(currentY - this.drawStartY);
    
    this.selectionBox.style.left = `${left}px`;
    this.selectionBox.style.top = `${top}px`;
    this.selectionBox.style.width = `${width}px`;
    this.selectionBox.style.height = `${height}px`;
  }

  private findElementInBox(boxLeft: number, boxTop: number, boxWidth: number, boxHeight: number): Element | null {
    const boxRight = boxLeft + boxWidth;
    const boxBottom = boxTop + boxHeight;
    const boxCenterX = boxLeft + boxWidth / 2;
    const boxCenterY = boxTop + boxHeight / 2;
    
    // Get all elements at the center point
    const centerElements = document.elementsFromPoint(boxCenterX, boxCenterY);
    
    // Filter out our own overlays
    const validElements = centerElements.filter(el => 
      !el.id.startsWith('web-augmenter-')
    );
    
    if (validElements.length === 0) return null;
    
    // Find the element that best fits the drawn box
    let bestElement: Element | null = null;
    let bestScore = Infinity;
    
    for (const element of validElements) {
      const rect = element.getBoundingClientRect();
      
      // Calculate how well this element fits the drawn box
      const overlapLeft = Math.max(boxLeft, rect.left);
      const overlapTop = Math.max(boxTop, rect.top);
      const overlapRight = Math.min(boxRight, rect.right);
      const overlapBottom = Math.min(boxBottom, rect.bottom);
      
      const overlapWidth = Math.max(0, overlapRight - overlapLeft);
      const overlapHeight = Math.max(0, overlapBottom - overlapTop);
      const overlapArea = overlapWidth * overlapHeight;
      
      const elementArea = rect.width * rect.height;
      const boxArea = boxWidth * boxHeight;
      
      // Score based on overlap percentage and size difference
      const overlapRatio = overlapArea / Math.min(elementArea, boxArea);
      const sizeDiff = Math.abs(elementArea - boxArea) / boxArea;
      
      // Prefer elements with high overlap and similar size to the drawn box
      const score = (1 - overlapRatio) + sizeDiff;
      
      if (score < bestScore && overlapRatio > 0.3) {
        bestScore = score;
        bestElement = element;
      }
    }
    
    return bestElement;
  }

  private selectElementForAugmentation(element: Element, selectionText?: string): void {
    // Generate unique ID for this element
    const elementId = `element_${Date.now()}`;
    
    // Extract element information
    const elementInfo = this.extractElementInfo(element, selectionText);
    
    // Store element info
    this.savedElements.set(elementId, elementInfo);
    
    // Highlight the element
    this.highlightElement(element, false);
    
    // Show dialog to ask user what they want to do with this element
    this.showElementDialog(elementId, elementInfo);
  }

  private getTargetElement(): Element | null {
    // Try to get element from last right-click position
    if (this.selectedElement) {
      return this.selectedElement;
    }
    
    // Fallback: get element from selection
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      return container.nodeType === Node.ELEMENT_NODE 
        ? container as Element 
        : container.parentElement;
    }
    
    return null;
  }

  private extractElementInfo(element: Element, selectionText?: string): ElementInfo {
    const rect = element.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(element);
    
    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || undefined,
      className: element.className || undefined,
      innerText: selectionText || element.textContent?.substring(0, 200) || '',
      innerHTML: element.innerHTML.substring(0, 500),
      selector: this.generateSelector(element),
      attributes: this.getElementAttributes(element),
      styles: {
        display: computedStyle.display,
        position: computedStyle.position,
        width: computedStyle.width,
        height: computedStyle.height,
        backgroundColor: computedStyle.backgroundColor,
        color: computedStyle.color,
        fontSize: computedStyle.fontSize
      },
      position: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      }
    };
  }

  private generateSelector(element: Element): string {
    // Generate a unique CSS selector for the element
    if (element.id) {
      return `#${element.id}`;
    }
    
    const path: string[] = [];
    let current: Element | null = element;
    
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      
      if (current.className) {
        const classes = current.className.split(' ').filter(c => c.trim());
        if (classes.length > 0) {
          selector += '.' + classes.join('.');
        }
      }
      
      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current!.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      
      path.unshift(selector);
      current = current.parentElement;
    }
    
    return path.join(' > ');
  }

  private getElementAttributes(element: Element): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }

  private highlightElement(element: Element, isHover: boolean = false): void {
    // Remove previous highlight
    if (this.highlightOverlay) {
      this.highlightOverlay.remove();
    }
    
    const rect = element.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.id = 'web-augmenter-highlight';
    
    const color = isHover ? '#ff9800' : '#007cba';
    const bgOpacity = isHover ? '0.05' : '0.1';
    
    overlay.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 3px solid ${color};
      background: rgba(${isHover ? '255, 152, 0' : '0, 124, 186'}, ${bgOpacity});
      pointer-events: none;
      z-index: 999999;
      box-shadow: 0 0 10px rgba(${isHover ? '255, 152, 0' : '0, 124, 186'}, 0.5);
      transition: all 0.1s ease;
    `;
    
    // Add element info label
    const label = document.createElement('div');
    label.style.cssText = `
      position: absolute;
      top: -25px;
      left: 0;
      background: ${color};
      color: white;
      padding: 4px 8px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 12px;
      white-space: nowrap;
      pointer-events: none;
    `;
    label.textContent = `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}${element.className ? '.' + element.className.split(' ')[0] : ''}`;
    overlay.appendChild(label);
    
    document.body.appendChild(overlay);
    this.highlightOverlay = overlay;
    
    // Auto-remove after 5 seconds for non-hover highlights
    if (!isHover) {
      setTimeout(() => {
        if (this.highlightOverlay === overlay) {
          overlay.remove();
          this.highlightOverlay = null;
        }
      }, 5000);
    }
  }

  private showElementDialog(elementId: string, elementInfo: ElementInfo): void {
    // Create a dialog asking what to do with the element
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      z-index: 1000000;
      max-width: 500px;
      font-family: Arial, sans-serif;
    `;
    
    dialog.innerHTML = `
      <h3 style="margin: 0 0 20px 0; color: #333; text-align: center;">✨ What would you like to do?</h3>
      <textarea 
        id="augmenter-instruction" 
        placeholder="Describe what you want to change...\n\nExamples:\n• Change the color to blue\n• Hide this element\n• Make the text bigger\n• Add a border\n• Change the background" 
        style="width: 100%; height: 120px; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-size: 14px; resize: vertical; box-sizing: border-box; font-family: Arial, sans-serif;"
      ></textarea>
      <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: flex-end;">
        <button id="augmenter-cancel" style="padding: 10px 20px; background: #f0f0f0; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;">Cancel</button>
        <button id="augmenter-submit" style="padding: 10px 20px; background: #007cba; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;">✨ Augment</button>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Focus on textarea
    const textarea = dialog.querySelector('#augmenter-instruction') as HTMLTextAreaElement;
    textarea?.focus();
    
    // Handle cancel
    dialog.querySelector('#augmenter-cancel')?.addEventListener('click', () => {
      dialog.remove();
      if (this.highlightOverlay) {
        this.highlightOverlay.remove();
        this.highlightOverlay = null;
      }
    });
    
    // Handle submit
    dialog.querySelector('#augmenter-submit')?.addEventListener('click', async () => {
      const instruction = textarea.value.trim();
      if (!instruction) {
        this.showNotification('Please enter an instruction', 'error');
        return;
      }
      
      dialog.remove();
      await this.augmentElement(elementId, instruction);
    });
  }

  private async augmentElement(elementId: string, instruction: string): Promise<void> {
    try {
      const elementInfo = this.savedElements.get(elementId);
      if (!elementInfo) {
        throw new Error('Element not found');
      }
      
      this.showNotification('Processing your request...', 'info');
      
      // Create a detailed instruction for the LLM
      const detailedInstruction = `
Modify the following element:
- Selector: ${elementInfo.selector}
- Tag: ${elementInfo.tagName}
- Current text: ${elementInfo.innerText}

User instruction: ${instruction}

Please generate CSS and/or JavaScript to ${instruction}. Target the element using the selector: ${elementInfo.selector}`;
      
      // Send to augmenter
      await this.handleExecuteInstruction(detailedInstruction, false);
      
      // Clean up
      if (this.highlightOverlay) {
        this.highlightOverlay.remove();
        this.highlightOverlay = null;
      }
      
    } catch (error) {
      console.error('Web Augmenter: Failed to augment element:', error);
      this.showNotification('Failed to augment element', 'error');
    }
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

  private setupElementTracking(): void {
    // Track the element under cursor when context menu is opened
    document.addEventListener('contextmenu', (event) => {
      const target = event.target as Element;
      if (target && target.nodeType === Node.ELEMENT_NODE) {
        this.selectedElement = target;
        
        // Clear after 2 seconds if not used
        setTimeout(() => {
          this.selectedElement = null;
        }, 2000);
      }
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