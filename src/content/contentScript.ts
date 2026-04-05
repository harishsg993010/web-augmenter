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
  private visualEditingMode: boolean = false;
  private visualModeOverlay: HTMLElement | null = null;
  private visualModeIndicator: HTMLElement | null = null;
  private isAugmenting: boolean = false;
  private isDragging: boolean = false;
  private draggedElement: HTMLElement | null = null;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private dragElementStartX: number = 0;
  private dragElementStartY: number = 0;
  private dragGhost: HTMLElement | null = null;
  private uiGenerationMode: boolean = false;
  private uiLocationBox: HTMLElement | null = null;
  private uiDrawing: boolean = false;
  private uiDrawStartX: number = 0;
  private uiDrawStartY: number = 0;

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
      this.setupKeyboardShortcuts();

    } catch (error) {
      console.error('Web Augmenter: Failed to initialize content script:', error);
    }
  }

  private setupKeyboardShortcuts(): void {
    // Keyboard shortcuts removed — modes are activated via the side panel
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
          sendResponse(response ?? null);
        })
        .catch(error => {
          console.error('Web Augmenter: Error handling message:', error);
          sendResponse({
            type: MESSAGE_TYPES.ERROR,
            error: error.message || 'Unknown error'
          });
        });

      // Return true to keep the message channel open for the async sendResponse call
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

        case 'REAPPLY_AUTO_FEATURES':
          patchInjector.removeAllInjectedElements();
          this.autoAppliedFeatures.clear();
          await this.autoApplyFeatures();
          return;

        case 'CONTEXT_MENU_CLICKED':
          return this.handleContextMenuClicked();

        case 'ADD_ELEMENT_TO_AUGMENTER':
          return this.handleAddElementToAugmenter(message.selectionText);

        case 'TOGGLE_VISUAL_EDITING_MODE':
          return this.toggleVisualEditingMode();

        case 'ENABLE_VISUAL_EDITING_MODE':
          if (!this.visualEditingMode) this.toggleVisualEditingMode();
          return;

        case 'DISABLE_VISUAL_EDITING_MODE':
          this.disableVisualEditingMode();
          return;

        case 'TOGGLE_UI_GENERATION_MODE':
          return this.toggleUIGenerationMode();

        case 'ENABLE_UI_GENERATION_MODE':
          if (!this.uiGenerationMode) this.toggleUIGenerationMode();
          return;

        case 'DISABLE_UI_GENERATION_MODE':
          this.disableUIGenerationMode();
          return;

        case 'SIDE_PANEL_CLOSED':
          this.disableVisualEditingMode();
          this.disableUIGenerationMode();
          return;

        case 'EXECUTE_ELEMENT_INSTRUCTION':
          return await this.handleExecuteElementInstruction(message.instruction, message.selector, message.elementInfo);

        case 'GENERATE_UI_FROM_PANEL':
          return await this.handleGenerateUIFromPanel(message.instruction, message.location);

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
      let domSummary = domSnapshotGenerator.generate();
      
      // Truncate if too large (estimate ~4 chars per token)
      const MAX_TOKENS = 180000; // Leave buffer for response
      const estimatedTokens = JSON.stringify(domSummary).length / 4;
      
      if (estimatedTokens > MAX_TOKENS) {
        console.warn(`DOM snapshot too large (${Math.round(estimatedTokens)} tokens), truncating...`);
        
        // Aggressively truncate fullHTML
        if (domSummary.fullHTML) {
          const maxHtmlChars = 50000; // ~12.5k tokens
          if (domSummary.fullHTML.length > maxHtmlChars) {
            domSummary.fullHTML = domSummary.fullHTML.substring(0, maxHtmlChars) + '\n<!-- ... HTML truncated due to size ... -->';
          }
        }
        
        // Reduce elements if still too large
        const newEstimate = JSON.stringify(domSummary).length / 4;
        if (newEstimate > MAX_TOKENS) {
          const maxElements = Math.floor(domSummary.elements.length * (MAX_TOKENS / newEstimate));
          domSummary.elements = domSummary.elements.slice(0, Math.max(100, maxElements));
          console.warn(`Reduced elements to ${domSummary.elements.length}`);
        }
      }

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

      const hasChanges = !!(message.patches.css?.length || message.patches.script?.length);
      chrome.runtime.sendMessage({
        type: 'PATCHES_APPLIED',
        goal: message.patches.high_level_goal,
        hasChanges
      }).catch(() => {});

    } catch (error) {
      console.error('Web Augmenter: Failed to inject patches:', error);
      chrome.runtime.sendMessage({
        type: 'PATCHES_FAILED',
        error: error instanceof Error ? error.message : 'Failed to apply changes'
      }).catch(() => {});
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
    // Remove previous highlight only if it's the same type or we're selecting (blue)
    if (this.highlightOverlay) {
      const isCurrentHover = this.highlightOverlay.style.borderColor === 'rgb(255, 152, 0)';
      // If we're hovering and there's a blue selection, don't remove it
      if (isHover && !isCurrentHover) {
        return; // Keep the blue selection, don't show orange hover
      }
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

  private showInlineElementDialog(elementId: string, elementInfo: ElementInfo, element: Element): void {
    // Create an inline dialog near the element
    const rect = element.getBoundingClientRect();
    const dialog = document.createElement('div');
    dialog.id = 'web-augmenter-inline-dialog';
    
    // Calculate position (try to show below element, or above if not enough space)
    const showBelow = rect.bottom + 200 < window.innerHeight;
    const top = showBelow ? rect.bottom + 10 : rect.top - 210;
    const left = Math.min(Math.max(rect.left, 10), window.innerWidth - 410);
    
    dialog.style.cssText = `
      position: fixed;
      top: ${top}px;
      left: ${left}px;
      background: white;
      padding: 16px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      z-index: 1000002;
      width: 400px;
      font-family: Arial, sans-serif;
      animation: slideIn 0.2s ease-out;
    `;
    
    // Add animation keyframes
    if (!document.getElementById('web-augmenter-animations')) {
      const style = document.createElement('style');
      style.id = 'web-augmenter-animations';
      style.textContent = `
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `;
      document.head.appendChild(style);
    }
    
    dialog.innerHTML = `
      <div style="margin-bottom: 12px;">
        <div style="font-size: 14px; font-weight: 600; color: #333; margin-bottom: 8px;">✨ Edit this element</div>
        <div style="font-size: 11px; color: #888; font-family: monospace;">${elementInfo.tagName}${elementInfo.id ? '#' + elementInfo.id : ''}</div>
      </div>
      <textarea 
        id="augmenter-instruction" 
        placeholder="What would you like to change?\n\ne.g., Change color to blue, Hide this, Make bigger..." 
        style="width: 100%; height: 90px; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 13px; resize: none; box-sizing: border-box; font-family: Arial, sans-serif; outline: none; transition: border-color 0.2s;"
        onfocus="this.style.borderColor='#007cba'"
        onblur="this.style.borderColor='#e0e0e0'"
      ></textarea>
      <div style="margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end;">
        <button id="augmenter-cancel" style="padding: 8px 16px; background: #f5f5f5; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; color: #666; transition: background 0.2s;"
          onmouseover="this.style.background='#e0e0e0'"
          onmouseout="this.style.background='#f5f5f5'">Cancel</button>
        <button id="augmenter-submit" style="padding: 8px 16px; background: #007cba; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; transition: background 0.2s;"
          onmouseover="this.style.background='#005a8b'"
          onmouseout="this.style.background='#007cba'">✨ Apply</button>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Focus on textarea
    const textarea = dialog.querySelector('#augmenter-instruction') as HTMLTextAreaElement;
    textarea?.focus();
    
    // Handle cancel
    dialog.querySelector('#augmenter-cancel')?.addEventListener('click', () => {
      dialog.remove();
      // Remove blue highlight when canceling
      if (this.highlightOverlay) {
        this.highlightOverlay.remove();
        this.highlightOverlay = null;
      }
    });
    
    // Handle submit
    dialog.querySelector('#augmenter-submit')?.addEventListener('click', async () => {
      const instruction = textarea.value.trim();
      if (!instruction) {
        textarea.style.borderColor = '#f44336';
        textarea.placeholder = 'Please enter an instruction!';
        setTimeout(() => {
          textarea.style.borderColor = '#e0e0e0';
        }, 2000);
        return;
      }
      
      // Disable the button and show loading state
      const submitBtn = dialog.querySelector('#augmenter-submit') as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.6';
        submitBtn.style.cursor = 'not-allowed';
        submitBtn.innerHTML = '⏳ Applying...';
      }
      
      this.isAugmenting = true;
      dialog.remove();
      
      try {
        await this.augmentElement(elementId, instruction);
      } finally {
        this.isAugmenting = false;
        
        // Remove blue highlight after augmentation
        if (this.highlightOverlay) {
          this.highlightOverlay.remove();
          this.highlightOverlay = null;
        }
      }
    });
    
    // Handle Enter key to submit
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dialog.querySelector<HTMLButtonElement>('#augmenter-submit')?.click();
      }
    });
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
      // Remove blue highlight when canceling
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
      
      // Remove blue highlight after augmentation
      if (this.highlightOverlay) {
        this.highlightOverlay.remove();
        this.highlightOverlay = null;
      }
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

  private async handleExecuteElementInstruction(instruction: string, selector: string, elementInfo: any): Promise<void> {
    try {
      this.showNotification('Processing element change...', 'info');
      const detailedInstruction = `
Modify the following element:
- Selector: ${selector}
- Tag: ${elementInfo.tagName}
- Current text: ${elementInfo.innerText}

User instruction: ${instruction}

Please generate CSS and/or JavaScript to ${instruction}. Target the element using the selector: ${selector}`;
      await this.handleExecuteInstruction(detailedInstruction, false);

      if (this.highlightOverlay) {
        this.highlightOverlay.remove();
        this.highlightOverlay = null;
      }
    } catch (error) {
      chrome.runtime.sendMessage({
        type: 'PATCHES_FAILED',
        error: error instanceof Error ? error.message : 'Failed to apply changes'
      }).catch(() => {});
    }
  }

  private async handleGenerateUIFromPanel(instruction: string, location: { x: number; y: number; width: number; height: number }): Promise<void> {
    try {
      await this.generateUIAtLocation(instruction, location);
    } catch (error) {
      chrome.runtime.sendMessage({
        type: 'PATCHES_FAILED',
        error: error instanceof Error ? error.message : 'Failed to generate UI'
      }).catch(() => {});
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

  private toggleVisualEditingMode(): void {
    this.visualEditingMode = !this.visualEditingMode;
    
    if (this.visualEditingMode) {
      this.enableVisualEditingMode();
    } else {
      this.disableVisualEditingMode();
    }
  }

  private enableVisualEditingMode(): void {
    // Create semi-transparent overlay
    this.visualModeOverlay = document.createElement('div');
    this.visualModeOverlay.id = 'web-augmenter-visual-mode-overlay';
    this.visualModeOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 999997;
      pointer-events: none;
      background: transparent;
      box-shadow: inset 0 0 0 3px #6366f1;
    `;
    document.body.appendChild(this.visualModeOverlay);

    // Add click listener to all elements
    document.addEventListener('click', this.handleVisualModeClick, true);
    document.addEventListener('mouseover', this.handleVisualModeHover, true);
    document.addEventListener('mouseout', this.handleVisualModeOut, true);
    document.addEventListener('mousedown', this.handleVisualModeDragStart, true);
    document.addEventListener('mousemove', this.handleVisualModeDragMove, true);
    document.addEventListener('mouseup', this.handleVisualModeDragEnd, true);
  }

  private teardownVisualClickLayer(): void {
    this.visualEditingMode = false;

    if (this.visualModeOverlay) {
      this.visualModeOverlay.remove();
      this.visualModeOverlay = null;
    }

    document.removeEventListener('click', this.handleVisualModeClick, true);
    document.removeEventListener('mouseover', this.handleVisualModeHover, true);
    document.removeEventListener('mouseout', this.handleVisualModeOut, true);
    document.removeEventListener('mousedown', this.handleVisualModeDragStart, true);
    document.removeEventListener('mousemove', this.handleVisualModeDragMove, true);
    document.removeEventListener('mouseup', this.handleVisualModeDragEnd, true);
  }

  private disableVisualEditingMode(): void {
    this.teardownVisualClickLayer();
    this.isAugmenting = false;

    if (this.highlightOverlay) {
      this.highlightOverlay.remove();
      this.highlightOverlay = null;
    }

    const inlineDialog = document.getElementById('web-augmenter-inline-dialog');
    if (inlineDialog) inlineDialog.remove();
  }

  private handleVisualModeClick = (e: MouseEvent): void => {
    const target = e.target as Element;
    
    // Ignore clicks on our own UI and dialogs
    if (target.id?.startsWith('web-augmenter-') ||
        target.closest('#web-augmenter-inline-dialog') ||
        target.closest('div[style*="position: fixed"][style*="transform: translate(-50%, -50%)"]')) {
      return;
    }
    
    // Don't allow selecting new elements while augmenting
    if (this.isAugmenting) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // Close any existing inline dialog
    const existingDialog = document.getElementById('web-augmenter-inline-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }
    
    // Select this element for augmentation
    const elementId = `element_${Date.now()}`;
    const elementInfo = this.extractElementInfo(target);
    this.savedElements.set(elementId, elementInfo);
    
    // Tear down click layer so user can't select another element
    this.teardownVisualClickLayer();

    // Highlight element and notify the side panel
    this.highlightElement(target, false);
    chrome.runtime.sendMessage({
      type: 'ELEMENT_SELECTED',
      selector: elementInfo.selector,
      elementInfo
    });
  };

  private handleVisualModeHover = (e: MouseEvent): void => {
    const target = e.target as Element;
    
    // Ignore our own UI
    if (target.id?.startsWith('web-augmenter-') || 
        target.closest('#web-augmenter-visual-indicator') ||
        target.closest('#web-augmenter-inline-dialog')) {
      return;
    }
    
    // Don't show hover highlights while augmenting
    if (this.isAugmenting) {
      return;
    }
    
    // Highlight element on hover
    this.highlightElement(target, true);
  };

  private handleVisualModeOut = (e: MouseEvent): void => {
    // Remove highlight when mouse leaves, but only if it's orange (hover)
    if (this.highlightOverlay && this.highlightOverlay.id === 'web-augmenter-highlight') {
      const isHoverHighlight = this.highlightOverlay.style.borderColor === 'rgb(255, 152, 0)';
      if (isHoverHighlight) {
        this.highlightOverlay.remove();
        this.highlightOverlay = null;
      }
    }
  };

  private handleVisualModeDragStart = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    
    // Ignore our own UI
    if (target.id?.startsWith('web-augmenter-') || 
        target.closest('#web-augmenter-visual-indicator') ||
        target.closest('#web-augmenter-inline-dialog')) {
      return;
    }
    
    // Don't drag while augmenting
    if (this.isAugmenting) {
      return;
    }
    
    // Check if Alt key is pressed (drag mode)
    if (!e.altKey) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    this.isDragging = true;
    this.draggedElement = target;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    
    // Get current position
    const rect = target.getBoundingClientRect();
    this.dragElementStartX = rect.left;
    this.dragElementStartY = rect.top;
    
    // Make element draggable
    const computedStyle = window.getComputedStyle(target);
    if (computedStyle.position === 'static') {
      target.style.position = 'relative';
    }
    
    // Create ghost element for visual feedback
    this.dragGhost = document.createElement('div');
    this.dragGhost.id = 'web-augmenter-drag-ghost';
    this.dragGhost.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 3px dashed #667eea;
      background: rgba(102, 126, 234, 0.1);
      pointer-events: none;
      z-index: 1000000;
      cursor: move;
    `;
    document.body.appendChild(this.dragGhost);
    
    // Change cursor
    document.body.style.cursor = 'move';
    
    // Highlight the element being dragged
    this.highlightElement(target, false);
  };

  private handleVisualModeDragMove = (e: MouseEvent): void => {
    if (!this.isDragging || !this.draggedElement || !this.dragGhost) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const deltaX = e.clientX - this.dragStartX;
    const deltaY = e.clientY - this.dragStartY;
    
    // Update ghost position
    this.dragGhost.style.left = `${this.dragElementStartX + deltaX}px`;
    this.dragGhost.style.top = `${this.dragElementStartY + deltaY}px`;
  };

  private handleVisualModeDragEnd = async (e: MouseEvent): Promise<void> => {
    if (!this.isDragging || !this.draggedElement) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const deltaX = e.clientX - this.dragStartX;
    const deltaY = e.clientY - this.dragStartY;
    
    // Apply position change to element
    const currentLeft = parseFloat(this.draggedElement.style.left || '0');
    const currentTop = parseFloat(this.draggedElement.style.top || '0');
    
    const newLeft = currentLeft + deltaX;
    const newTop = currentTop + deltaY;
    
    this.draggedElement.style.left = `${newLeft}px`;
    this.draggedElement.style.top = `${newTop}px`;
    
    // Save the position as a persistent feature
    await this.saveElementPosition(this.draggedElement, newLeft, newTop);
    
    // Clean up
    if (this.dragGhost) {
      this.dragGhost.remove();
      this.dragGhost = null;
    }
    
    document.body.style.cursor = '';
    
    this.isDragging = false;
    this.draggedElement = null;
    
    this.showNotification('✅ Element position saved and will persist on page reload!', 'success');
  };

  private async saveElementPosition(element: HTMLElement, left: number, top: number): Promise<void> {
    try {
      // Generate a unique and stable selector for the element
      const selector = this.generateStableSelector(element);
      
      if (!selector) {
        console.warn('Could not generate stable selector for element');
        return;
      }
      
      // Get current position style to preserve it
      const computedStyle = window.getComputedStyle(element);
      const currentPosition = computedStyle.position;
      
      // Generate CSS to persist the position
      const css = `
/* Element position saved from visual editing mode */
${selector} {
  position: ${currentPosition === 'static' ? 'relative' : currentPosition} !important;
  left: ${left}px !important;
  top: ${top}px !important;
}`;
      
      // Create a custom feature for this position
      const featureId = `position_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const feature: CustomFeature = {
        id: featureId,
        name: `Element Position: ${selector.substring(0, 50)}`,
        scope: {
          type: 'hostname',
          value: window.location.hostname
        },
        script: '', // No script needed, just CSS
        css: css,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        autoApply: true,
        description: `Saved position for element at (${Math.round(left)}px, ${Math.round(top)}px)`,
        tags: ['visual-editing', 'position']
      };
      
      // Save the feature
      await persistence.saveCustomFeature(feature);
      
      console.log('Element position saved:', { selector, left, top });
    } catch (error) {
      console.error('Failed to save element position:', error);
      this.showNotification('Failed to save position', 'error');
    }
  }

  private generateStableSelector(element: HTMLElement): string | null {
    // Try ID first (most stable)
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }
    
    // Try unique class combination
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        const classSelector = '.' + classes.map(c => CSS.escape(c)).join('.');
        // Check if it's unique enough
        const matches = document.querySelectorAll(classSelector);
        if (matches.length === 1) {
          return classSelector;
        }
      }
    }
    
    // Try data attributes
    for (const attr of element.attributes) {
      if (attr.name.startsWith('data-') && attr.value) {
        const selector = `[${attr.name}="${CSS.escape(attr.value)}"]`;
        const matches = document.querySelectorAll(selector);
        if (matches.length === 1) {
          return selector;
        }
      }
    }
    
    // Fall back to nth-child with parent context
    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(element);
      const tagName = element.tagName.toLowerCase();
      
      // Get parent selector
      let parentSelector = '';
      if (parent.id) {
        parentSelector = `#${CSS.escape(parent.id)}`;
      } else if (parent.className && typeof parent.className === 'string') {
        const parentClasses = parent.className.trim().split(/\s+/).filter(c => c);
        if (parentClasses.length > 0) {
          parentSelector = '.' + parentClasses.map(c => CSS.escape(c)).join('.');
        }
      } else {
        parentSelector = parent.tagName.toLowerCase();
      }
      
      return `${parentSelector} > ${tagName}:nth-child(${index + 1})`;
    }
    
    return null;
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private showNotification(_message: string, _type: 'success' | 'error' | 'info' = 'info'): void {
    // Page-side notifications removed — all status lives in the side panel
  }

  // UI Generation Mode Methods
  private toggleUIGenerationMode(): void {
    this.uiGenerationMode = !this.uiGenerationMode;
    
    if (this.uiGenerationMode) {
      this.enableUIGenerationMode();
    } else {
      this.disableUIGenerationMode();
    }
  }

  private enableUIGenerationMode(): void {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'web-augmenter-ui-gen-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 999998;
      cursor: crosshair;
      background: transparent;
      box-shadow: inset 0 0 0 3px #6366f1;
    `;
    document.body.appendChild(overlay);

    // Add event listeners
    overlay.addEventListener('mousedown', this.handleUIDrawStart);
    document.addEventListener('mousemove', this.handleUIDrawMove);
    document.addEventListener('mouseup', this.handleUIDrawEnd);
  }

  private disableUIGenerationMode(): void {
    this.teardownUIDrawLayer();

    if (this.uiLocationBox) {
      this.uiLocationBox.remove();
      this.uiLocationBox = null;
    }
  }

  private teardownUIDrawLayer(): void {
    const overlay = document.getElementById('web-augmenter-ui-gen-overlay');
    if (overlay) overlay.remove();

    const indicator = document.getElementById('web-augmenter-ui-gen-indicator');
    if (indicator) indicator.remove();

    document.removeEventListener('mousemove', this.handleUIDrawMove);
    document.removeEventListener('mouseup', this.handleUIDrawEnd);

    this.uiGenerationMode = false;
  }

  private handleUIDrawStart = (e: MouseEvent): void => {
    this.uiDrawing = true;
    this.uiDrawStartX = e.clientX;
    this.uiDrawStartY = e.clientY;
    
    // Create selection box
    this.uiLocationBox = document.createElement('div');
    this.uiLocationBox.style.cssText = `
      position: fixed;
      border: 3px dashed #667eea;
      background: rgba(102, 126, 234, 0.1);
      z-index: 999999;
      pointer-events: none;
    `;
    document.body.appendChild(this.uiLocationBox);
  };

  private handleUIDrawMove = (e: MouseEvent): void => {
    if (!this.uiDrawing || !this.uiLocationBox) return;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const left = Math.min(this.uiDrawStartX, currentX);
    const top = Math.min(this.uiDrawStartY, currentY);
    const width = Math.abs(currentX - this.uiDrawStartX);
    const height = Math.abs(currentY - this.uiDrawStartY);
    
    this.uiLocationBox.style.left = `${left}px`;
    this.uiLocationBox.style.top = `${top}px`;
    this.uiLocationBox.style.width = `${width}px`;
    this.uiLocationBox.style.height = `${height}px`;
  };

  private handleUIDrawEnd = async (e: MouseEvent): Promise<void> => {
    if (!this.uiDrawing || !this.uiLocationBox) return;
    
    this.uiDrawing = false;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const left = Math.min(this.uiDrawStartX, currentX);
    const top = Math.min(this.uiDrawStartY, currentY);
    const width = Math.abs(currentX - this.uiDrawStartX);
    const height = Math.abs(currentY - this.uiDrawStartY);
    
    // Minimum size check
    if (width < 50 || height < 50) {
      this.showNotification('Area too small. Please draw a larger rectangle.', 'error');
      if (this.uiLocationBox) {
        this.uiLocationBox.remove();
        this.uiLocationBox = null;
      }
      return;
    }
    
    // Tear down the draw layer so user can't draw again, but keep the box visible
    this.teardownUIDrawLayer();

    // Notify the side panel with the drawn region
    chrome.runtime.sendMessage({
      type: 'REGION_DRAWN',
      location: { x: left, y: top, width, height }
    });
  };

  private showUIGenerationDialog(location: { x: number; y: number; width: number; height: number }): void {
    const dialog = document.createElement('div');
    dialog.id = 'web-augmenter-ui-gen-dialog';
    dialog.style.cssText = `
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 25px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      z-index: 1000002;
      min-width: 400px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    
    dialog.innerHTML = `
      <h3 style="margin: 0 0 15px 0; color: #333;">Generate Custom UI</h3>
      <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">
        Location: (${Math.round(location.x)}, ${Math.round(location.y)}) • Size: ${Math.round(location.width)}×${Math.round(location.height)}px
      </p>
      <textarea id="ui-gen-instruction" placeholder="Describe the UI you want to create...
      
Examples:
• Create a floating notes widget
• Add a timer with start/stop buttons
• Make a todo list with checkboxes
• Build a calculator
• Create a color picker tool" 
        style="width: 100%; height: 120px; padding: 10px; border: 2px solid #ddd; border-radius: 8px; 
               font-family: inherit; font-size: 14px; resize: vertical; box-sizing: border-box;"></textarea>
      <div style="display: flex; gap: 10px; margin-top: 15px;">
        <button id="ui-gen-create" style="flex: 1; padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px;">
          ✨ Generate UI
        </button>
        <button id="ui-gen-cancel" style="padding: 12px 20px; background: #f5f5f5; color: #666; border: none; 
                border-radius: 8px; cursor: pointer; font-size: 14px;">
          Cancel
        </button>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    const textarea = dialog.querySelector('#ui-gen-instruction') as HTMLTextAreaElement;
    textarea.focus();
    
    dialog.querySelector('#ui-gen-create')?.addEventListener('click', async () => {
      const instruction = textarea.value.trim();
      if (!instruction) {
        this.showNotification('Please describe the UI you want to create', 'error');
        return;
      }
      
      dialog.remove();
      await this.generateUIAtLocation(instruction, location);
    });
    
    dialog.querySelector('#ui-gen-cancel')?.addEventListener('click', () => {
      dialog.remove();
      if (this.uiLocationBox) {
        this.uiLocationBox.remove();
        this.uiLocationBox = null;
      }
    });
  }

  private async generateUIAtLocation(instruction: string, location: { x: number; y: number; width: number; height: number }): Promise<void> {
    try {
      this.showNotification('🤖 Generating UI...', 'info');
      
      // Send message to background script to generate UI
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_UI',
        instruction,
        location,
        pageContext: {
          url: window.location.href,
          hostname: window.location.hostname,
          domSummary: domSnapshotGenerator.generate()
        }
      });
      
      if (response.error) {
        throw new Error(response.error);
      }
      
      // Inject the generated UI
      if (response.response) {
        await patchInjector.injectPatches(response.response);
        this.showNotification('✅ UI generated and saved!', 'success');
        
        // Clean up
        if (this.uiLocationBox) {
          this.uiLocationBox.remove();
          this.uiLocationBox = null;
        }
        
        // Disable UI generation mode
        this.disableUIGenerationMode();
      }
    } catch (error) {
      console.error('UI generation failed:', error);
      throw error;
    }
  }
}

// Initialize content script
new ContentScript();