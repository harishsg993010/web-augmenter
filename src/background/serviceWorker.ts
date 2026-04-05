import {
  MessageFromContent,
  MessageFromBackground,
  MessageToContent,
  WebFeatureResponse,
  PageContext,
  CustomFeature
} from '../shared/types.js';
import { MESSAGE_TYPES } from '../shared/constants.js';
import { llmClient } from '../shared/llmClient.js';
import { screenshotCapture } from '../shared/screenshot.js';
import { persistence } from '../shared/persistence.js';

class BackgroundService {
  private userScriptsAvailable: boolean = false;

  constructor() {
    this.checkUserScriptsAvailability();
    this.setupMessageListeners();
    this.setupSidePanel();
    this.setupStorageListener();
  }

  private async checkUserScriptsAvailability(): Promise<void> {
    try {
      // Check if userScripts API is available (Chrome 120+)
      if (typeof chrome.userScripts !== 'undefined') {
        await chrome.userScripts.getScripts();
        this.userScriptsAvailable = true;
        console.log('Web Augmenter: userScripts API available');
      }
    } catch (error) {
      this.userScriptsAvailable = false;
      console.log('Web Augmenter: userScripts API not available, using fallback methods');
    }
  }

  private setupMessageListeners(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender)
        .then(response => {
          if (response) {
            sendResponse(response);
          }
        })
        .catch(error => {
          console.error('Error handling message:', error);
          sendResponse({
            type: MESSAGE_TYPES.ERROR,
            error: error.message || 'Unknown error'
          });
        });

      // Return true to indicate async response
      return true;
    });
  }

  private async handleMessage(
    message: any,
    sender: chrome.runtime.MessageSender
  ): Promise<MessageFromBackground | void> {
    try {
      switch (message.type) {
        case MESSAGE_TYPES.PAGE_CONTEXT_READY:
          return await this.handlePageContext(message as MessageFromContent, sender);

        case 'GET_SCREENSHOT':
          return await this.handleGetScreenshot(message);

        case 'SAVE_CUSTOM_FEATURE':
          return await this.handleSaveCustomFeature(message);

        case 'GET_CUSTOM_FEATURES':
          return await this.handleGetCustomFeatures(message);

        case 'DELETE_CUSTOM_FEATURE':
          return await this.handleDeleteCustomFeature(message);

        case 'TOGGLE_FEATURE_AUTO_APPLY':
          return await this.handleToggleFeatureAutoApply(message);

        case 'UPDATE_GLOBAL_SETTINGS':
          return await this.handleUpdateGlobalSettings(message);

        case 'GET_SITE_STATUS':
          return await this.handleGetSiteStatus(message);

        case 'TOGGLE_SITE_DISABLED':
          return await this.handleToggleSiteDisabled(message);

        case 'INJECT_SCRIPT_VIA_API':
          return await this.handleInjectScriptViaAPI(message, sender);

        case 'GENERATE_UI':
          return await this.handleGenerateUI(message, sender);

        default:
          console.warn('Unknown message type:', message.type);
          return undefined;
      }
    } catch (error) {
      console.error('Error in message handler:', error);
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async handlePageContext(
    message: MessageFromContent,
    sender: chrome.runtime.MessageSender
  ): Promise<MessageFromBackground> {
    try {
      const { pageContext } = message;

      // Get screenshot if requested
      let screenshotBase64: string | undefined;
      if (message.includeScreenshot) {
        screenshotBase64 = await screenshotCapture.captureWithRetry() || undefined;
      }

      // Update LLM client config if needed
      await this.updateLLMClientConfig();

      // Call the LLM with tabId for tool execution
      const response = await llmClient.callWebFeatureBuilder({
        systemPrompt: '', // This is handled in the llmClient
        userInstruction: pageContext.userInstruction,
        pageContext,
        screenshotBase64
      }, sender.tab?.id);

      // Auto-save the generated feature for this hostname
      await this.saveGeneratedFeature(pageContext, response);

      // Send patches to content script for injection
      // Content script uses blob URLs to bypass CSP restrictions
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: MESSAGE_TYPES.INJECT_PATCHES,
          patches: response
        } as MessageToContent);
      }

      return {
        type: MESSAGE_TYPES.FEATURE_RESPONSE,
        response
      };

    } catch (error) {
      console.error('Error processing page context:', error);
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Failed to process request'
      };
    }
  }

  private async handleGenerateUI(
    message: any,
    sender: chrome.runtime.MessageSender
  ): Promise<any> {
    try {
      const { instruction, location, pageContext } = message;

      console.log('Generating UI at location:', location);

      // Update LLM client config with latest API key
      await this.updateLLMClientConfig();

      // Get screenshot for better context
      let screenshotBase64: string | undefined;
      try {
        screenshotBase64 = await screenshotCapture.captureWithRetry() || undefined;
      } catch (error) {
        console.warn('Screenshot capture failed, continuing without it:', error);
      }

      // Call LLM to generate UI
      const response = await llmClient.generateUIAtLocation(
        instruction,
        location,
        pageContext,
        screenshotBase64
      );

      // Save as a custom feature
      const feature: CustomFeature = {
        id: `ui_gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: `Custom UI: ${instruction.substring(0, 50)}`,
        scope: {
          type: 'hostname',
          value: pageContext.hostname
        },
        script: response.script,
        css: response.css,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        autoApply: true,
        description: `Generated UI at (${Math.round(location.x)}, ${Math.round(location.y)})`,
        tags: ['ui-generation', 'custom-ui']
      };

      await persistence.saveCustomFeature(feature);

      // Inject immediately
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: MESSAGE_TYPES.INJECT_PATCHES,
          patches: response
        } as MessageToContent);
      }

      return {
        type: 'UI_GENERATED',
        response,
        feature
      };

    } catch (error) {
      console.error('Error generating UI:', error);
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Failed to generate UI'
      };
    }
  }

  private async handleGetScreenshot(message: any): Promise<any> {
    try {
      const screenshot = await screenshotCapture.captureWithRetry(message.options || {});
      return {
        type: 'SCREENSHOT_RESPONSE',
        screenshot
      };
    } catch (error) {
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Screenshot failed'
      };
    }
  }

  private async handleSaveCustomFeature(message: any): Promise<any> {
    try {
      const feature = message.feature;
      await persistence.saveCustomFeature(feature);

      return {
        type: 'FEATURE_SAVED',
        feature
      };
    } catch (error) {
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Failed to save feature'
      };
    }
  }

  private async handleGetCustomFeatures(message: any): Promise<any> {
    try {
      const features = await persistence.getAllCustomFeatures();

      return {
        type: 'CUSTOM_FEATURES_RESPONSE',
        features
      };
    } catch (error) {
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Failed to get features'
      };
    }
  }

  private async saveGeneratedFeature(pageContext: any, response: any): Promise<void> {
    try {
      const hostname = pageContext.hostname;
      const featureId = `auto_${hostname}_${Date.now()}`;
      
      // Create a custom feature from the generated response
      const customFeature = {
        id: featureId,
        name: response.high_level_goal || 'Auto-generated feature',
        scope: {
          type: 'hostname' as const,
          value: hostname
        },
        script: response.script || '',
        css: response.css || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        autoApply: true,
        tags: ['auto-generated']
      };

      // Save the feature
      await persistence.saveCustomFeature(customFeature);
      
      // Enable auto-apply for this feature on this hostname
      await persistence.setAutoApply(featureId, hostname, true);
      
      console.log(`Web Augmenter: Auto-saved feature "${customFeature.name}" for ${hostname}`);
    } catch (error) {
      console.error('Web Augmenter: Failed to auto-save feature:', error);
      // Don't throw - we don't want to break the flow if save fails
    }
  }

  private async handleDeleteCustomFeature(message: any): Promise<any> {
    try {
      await persistence.deleteCustomFeature(message.featureId);

      return {
        type: 'FEATURE_DELETED',
        featureId: message.featureId
      };
    } catch (error) {
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Failed to delete feature'
      };
    }
  }

  private async handleToggleFeatureAutoApply(message: any): Promise<any> {
    try {
      const { featureId, hostname, enabled } = message;
      await persistence.setAutoApply(featureId, hostname, enabled);

      return {
        type: 'AUTO_APPLY_TOGGLED',
        featureId,
        hostname,
        enabled
      };
    } catch (error) {
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Failed to toggle auto-apply'
      };
    }
  }

  private async handleUpdateGlobalSettings(message: any): Promise<any> {
    try {
      await persistence.updateGlobalSettings(message.settings);

      return {
        type: 'SETTINGS_UPDATED',
        settings: message.settings
      };
    } catch (error) {
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Failed to update settings'
      };
    }
  }

  private async handleGetSiteStatus(message: any): Promise<any> {
    try {
      const { hostname } = message;
      const disabled = await persistence.isSiteDisabled(hostname);
      const features = await persistence.getFeaturesForSite(`https://${hostname}`);

      return {
        type: 'SITE_STATUS_RESPONSE',
        hostname,
        disabled,
        appliedFeatures: features
      };
    } catch (error) {
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Failed to get site status'
      };
    }
  }

  private async handleToggleSiteDisabled(message: any): Promise<any> {
    try {
      const { hostname, disabled } = message;
      await persistence.setSiteDisabled(hostname, disabled);

      return {
        type: 'SITE_DISABLED_TOGGLED',
        hostname,
        disabled
      };
    } catch (error) {
      return {
        type: MESSAGE_TYPES.ERROR,
        error: error instanceof Error ? error.message : 'Failed to toggle site'
      };
    }
  }

  private async handleInjectScriptViaAPI(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
    try {
      const { script, id } = message;
      
      if (!sender.tab?.id) {
        throw new Error('No tab ID available');
      }

      const tabId = sender.tab.id;

      // Use chrome.userScripts API (Chrome 120+)
      // USER_SCRIPT world is CSP-exempt by design!
      if (!this.userScriptsAvailable) {
        throw new Error('userScripts API not available. Enable "Developer mode" (Chrome <138) or "Allow User Scripts" toggle (Chrome 138+)');
      }

      try {
        await (chrome.userScripts as any).execute({
          target: { tabId },
          world: 'USER_SCRIPT',
          js: [{ code: script }],
          injectImmediately: true
        });

        console.log('Web Augmenter: Script injected via userScripts API (CSP-exempt)', { id });
        return {
          success: true,
          id,
          method: 'userScripts'
        };
      } catch (userScriptError) {
        console.error('Web Augmenter: userScripts API failed:', userScriptError);
        throw userScriptError;
      }
    } catch (error) {
      console.error('Web Augmenter: Script injection failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async updateLLMClientConfig(): Promise<void> {
    try {
      const data = await persistence.getStorageData();
      const settings = data.globalSettings;

      if (settings.apiKey) {
        llmClient.updateConfig({
          apiKey: settings.apiKey
        });
      }
    } catch (error) {
      console.warn('Failed to update LLM client config:', error);
    }
  }

  private setupSidePanel(): void {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        await chrome.sidePanel.close({ windowId: activeInfo.windowId });
      } catch {
        // Panel may already be closed
      }
    });
  }

  private setupStorageListener(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        // Broadcast storage changes to content scripts
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, {
                type: 'STORAGE_CHANGED',
                changes
              }).catch(() => {
                // Ignore errors for tabs that don't have content scripts
              });
            }
          });
        });
      }
    });
  }
}

// Initialize the background service
new BackgroundService();

// Handle extension lifecycle
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Web Augmenter installed');

    // Initialize default settings
    persistence.updateGlobalSettings({
      includeScreenshotByDefault: true
    }).catch(console.error);
  }
});

// Keep service worker alive
chrome.runtime.onMessage.addListener(() => {
  // This listener helps keep the service worker alive
  return false;
});