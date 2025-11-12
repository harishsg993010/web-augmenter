import { CustomFeature } from '../shared/types.js';
import { FEATURE_SCOPE_TYPES } from '../shared/constants.js';

interface PopupElements {
  currentSite: HTMLElement;
  toggleSite: HTMLElement;
  siteStatus: HTMLElement;
  instruction: HTMLTextAreaElement;
  includeScreenshot: HTMLInputElement;
  saveAsFeature: HTMLInputElement;
  executeBtn: HTMLButtonElement;
  executeText: HTMLElement;
  executeSpinner: HTMLElement;
  status: HTMLElement;
  featureSaveSection: HTMLElement;
  featureName: HTMLInputElement;
  featureScope: HTMLSelectElement;
  urlPattern: HTMLInputElement;
  featureDescription: HTMLTextAreaElement;
  saveFeatureBtn: HTMLButtonElement;
  cancelSaveBtn: HTMLButtonElement;
  featuresList: HTMLElement;
  featuresLoading: HTMLElement;
  noFeatures: HTMLElement;
  refreshFeatures: HTMLButtonElement;
  removeAllBtn: HTMLButtonElement;
  screenshotBtn: HTMLButtonElement;
  settingsToggle: HTMLElement;
  settingsContent: HTMLElement;
  apiKey: HTMLInputElement;
  screenshotDefault: HTMLInputElement;
  saveSettingsBtn: HTMLButtonElement;
  exportBtn: HTMLButtonElement;
  importBtn: HTMLButtonElement;
  importFile: HTMLInputElement;
}

class PopupUI {
  private elements: PopupElements;
  private currentHostname: string = '';
  private lastResponse: any = null;
  private isLoading: boolean = false;

  constructor() {
    this.elements = this.getElements();
    this.init();
  }

  private getElements(): PopupElements {
    const get = (id: string) => {
      const element = document.getElementById(id);
      if (!element) {
        throw new Error(`Element with id "${id}" not found`);
      }
      return element;
    };

    return {
      currentSite: get('currentSite'),
      toggleSite: get('toggleSite'),
      siteStatus: get('siteStatus'),
      instruction: get('instruction') as HTMLTextAreaElement,
      includeScreenshot: get('includeScreenshot') as HTMLInputElement,
      saveAsFeature: get('saveAsFeature') as HTMLInputElement,
      executeBtn: get('executeBtn') as HTMLButtonElement,
      executeText: get('executeText'),
      executeSpinner: get('executeSpinner'),
      status: get('status'),
      featureSaveSection: get('featureSaveSection'),
      featureName: get('featureName') as HTMLInputElement,
      featureScope: get('featureScope') as HTMLSelectElement,
      urlPattern: get('urlPattern') as HTMLInputElement,
      featureDescription: get('featureDescription') as HTMLTextAreaElement,
      saveFeatureBtn: get('saveFeatureBtn') as HTMLButtonElement,
      cancelSaveBtn: get('cancelSaveBtn') as HTMLButtonElement,
      featuresList: get('featuresList'),
      featuresLoading: get('featuresLoading'),
      noFeatures: get('noFeatures'),
      refreshFeatures: get('refreshFeatures') as HTMLButtonElement,
      removeAllBtn: get('removeAllBtn') as HTMLButtonElement,
      screenshotBtn: get('screenshotBtn') as HTMLButtonElement,
      settingsToggle: get('settingsToggle'),
      settingsContent: get('settingsContent'),
      apiKey: get('apiKey') as HTMLInputElement,
      screenshotDefault: get('screenshotDefault') as HTMLInputElement,
      saveSettingsBtn: get('saveSettingsBtn') as HTMLButtonElement,
      exportBtn: get('exportBtn') as HTMLButtonElement,
      importBtn: get('importBtn') as HTMLButtonElement,
      importFile: get('importFile') as HTMLInputElement
    };
  }

  private async init(): Promise<void> {
    try {
      await this.loadCurrentTab();
      await this.loadSettings();
      await this.loadCustomFeatures();
      this.setupEventListeners();
      this.updateUIState();
    } catch (error) {
      console.error('Failed to initialize popup:', error);
      this.showStatus('Failed to initialize extension', 'error');
    }
  }

  private async loadCurrentTab(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (tab?.url) {
        const url = new URL(tab.url);
        this.currentHostname = url.hostname;
        this.elements.currentSite.textContent = this.currentHostname;

        // Check if site is disabled
        const response = await chrome.runtime.sendMessage({
          type: 'GET_SITE_STATUS',
          hostname: this.currentHostname
        });

        if (response && response.type === 'SITE_STATUS_RESPONSE') {
          this.updateSiteStatus(response.disabled);
        }
      } else {
        this.elements.currentSite.textContent = 'Unknown site';
      }
    } catch (error) {
      console.error('Failed to load current tab:', error);
      this.elements.currentSite.textContent = 'Error loading site';
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['globalSettings']);
      const settings = result.globalSettings || {};

      this.elements.apiKey.value = settings.apiKey || '';
      this.elements.screenshotDefault.checked = settings.includeScreenshotByDefault !== false;
      this.elements.includeScreenshot.checked = settings.includeScreenshotByDefault !== false;
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  private async loadCustomFeatures(): Promise<void> {
    try {
      this.elements.featuresLoading.classList.remove('hidden');
      this.elements.noFeatures.classList.add('hidden');

      const response = await chrome.runtime.sendMessage({
        type: 'GET_CUSTOM_FEATURES'
      });

      if (response && response.type === 'CUSTOM_FEATURES_RESPONSE') {
        this.renderCustomFeatures(response.features);
      } else {
        throw new Error(response?.error || 'Failed to load features');
      }
    } catch (error) {
      console.error('Failed to load custom features:', error);
      this.showStatus('Failed to load custom features', 'error');
    } finally {
      this.elements.featuresLoading.classList.add('hidden');
    }
  }

  private renderCustomFeatures(features: CustomFeature[]): void {
    const container = this.elements.featuresList;

    // Clear existing features (keep loading/no items indicators)
    const existingFeatures = container.querySelectorAll('.feature-item');
    existingFeatures.forEach(item => item.remove());

    if (features.length === 0) {
      this.elements.noFeatures.classList.remove('hidden');
      return;
    }

    this.elements.noFeatures.classList.add('hidden');

    features.forEach(feature => {
      const featureElement = this.createFeatureElement(feature);
      container.appendChild(featureElement);
    });
  }

  private createFeatureElement(feature: CustomFeature): HTMLElement {
    const div = document.createElement('div');
    div.className = 'feature-item';
    div.innerHTML = `
      <div class="feature-header">
        <span class="feature-name">${this.escapeHtml(feature.name)}</span>
        <span class="feature-scope">${this.getScopeDisplayName(feature.scope)}</span>
      </div>
      ${feature.description ? `<div class="feature-description">${this.escapeHtml(feature.description)}</div>` : ''}
      <div class="feature-actions">
        <button class="feature-btn apply-btn" data-feature-id="${feature.id}">Apply Now</button>
        <div class="auto-apply-toggle">
          <input type="checkbox" id="auto-${feature.id}" ${feature.autoApply ? 'checked' : ''}>
          <label for="auto-${feature.id}">Auto</label>
        </div>
        <button class="feature-btn danger delete-btn" data-feature-id="${feature.id}">Delete</button>
      </div>
    `;

    // Add event listeners
    const applyBtn = div.querySelector('.apply-btn') as HTMLButtonElement;
    const deleteBtn = div.querySelector('.delete-btn') as HTMLButtonElement;
    const autoToggle = div.querySelector(`#auto-${feature.id}`) as HTMLInputElement;

    applyBtn.addEventListener('click', () => this.applyCustomFeature(feature.id));
    deleteBtn.addEventListener('click', () => this.deleteCustomFeature(feature.id));
    autoToggle.addEventListener('change', () => this.toggleAutoApply(feature.id, autoToggle.checked));

    return div;
  }

  private setupEventListeners(): void {
    // Main execute button
    this.elements.executeBtn.addEventListener('click', () => this.executeInstruction());

    // Save as feature checkbox
    this.elements.saveAsFeature.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.elements.featureSaveSection.classList.toggle('hidden', !checked);
    });

    // Feature scope change
    this.elements.featureScope.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.elements.urlPattern.classList.toggle('hidden', value !== 'urlPattern');
    });

    // Feature save buttons
    this.elements.saveFeatureBtn.addEventListener('click', () => this.saveCustomFeature());
    this.elements.cancelSaveBtn.addEventListener('click', () => this.cancelFeatureSave());

    // Site toggle
    this.elements.toggleSite.addEventListener('click', () => this.toggleSiteDisabled());

    // Quick actions
    this.elements.refreshFeatures.addEventListener('click', () => this.loadCustomFeatures());
    this.elements.removeAllBtn.addEventListener('click', () => this.removeAllFeatures());
    this.elements.screenshotBtn.addEventListener('click', () => this.testScreenshot());

    // Settings toggle
    this.elements.settingsToggle.addEventListener('click', () => this.toggleSettings());

    // Settings actions
    this.elements.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
    this.elements.exportBtn.addEventListener('click', () => this.exportData());
    this.elements.importBtn.addEventListener('click', () => this.elements.importFile.click());
    this.elements.importFile.addEventListener('change', (e) => this.importData(e));

    // Enter key in instruction textarea
    this.elements.instruction.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.executeInstruction();
      }
    });

    // Help and feedback links
    document.getElementById('helpLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/anthropics/claude-code/issues' });
    });

    document.getElementById('feedbackLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/anthropics/claude-code/issues' });
    });
  }

  private async executeInstruction(): Promise<void> {
    const instruction = this.elements.instruction.value.trim();

    if (!instruction) {
      this.showStatus('Please enter an instruction', 'error');
      return;
    }

    if (this.isLoading) {
      return;
    }

    try {
      this.setLoading(true);
      this.showStatus('Analyzing page and generating changes...', 'info');

      // Get active tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (!tab?.id || !tab.url) {
        throw new Error('No active tab found');
      }

      // Check if the page is a valid web page
      if (!this.isValidWebPage(tab.url)) {
        throw new Error('Web Augmenter cannot run on this page. Please try on a regular web page (http:// or https://).');
      }

      // Ensure content script is loaded
      await this.ensureContentScriptLoaded(tab.id);

      // Send message to content script
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXECUTE_INSTRUCTION',
        userInstruction: instruction,
        includeScreenshot: this.elements.includeScreenshot.checked
      });

      if (response && response.type === 'INSTRUCTION_RECEIVED') {
        // Instruction was successfully received and is being processed
        this.showStatus('Processing your request...', 'info');

        // The actual result will be injected by the background script
        // No need to do anything else here
      } else if (response && response.type === 'ERROR') {
        throw new Error(response.error);
      }

    } catch (error) {
      console.error('Failed to execute instruction:', error);
      this.showStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      this.setLoading(false);
    }
  }

  private isValidWebPage(url: string): boolean {
    // Check if URL is a regular web page (not chrome://, file://, etc.)
    return url.startsWith('http://') || url.startsWith('https://');
  }

  private async ensureContentScriptLoaded(tabId: number): Promise<void> {
    try {
      // Try to ping the content script to see if it's loaded
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    } catch (error) {
      // Content script not loaded, inject it programmatically
      console.log('Content script not loaded, injecting...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/contentScript.js']
        });

        // Wait a bit for the content script to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (injectError) {
        throw new Error('Failed to load content script. Please refresh the page and try again.');
      }
    }
  }

  private async saveCustomFeature(): Promise<void> {
    if (!this.lastResponse) {
      this.showStatus('No feature to save', 'error');
      return;
    }

    const name = this.elements.featureName.value.trim();
    if (!name) {
      this.showStatus('Please enter a feature name', 'error');
      return;
    }

    const scope = this.elements.featureScope.value;
    const urlPattern = this.elements.urlPattern.value.trim();

    if (scope === 'urlPattern' && !urlPattern) {
      this.showStatus('Please enter a URL pattern', 'error');
      return;
    }

    try {
      const feature: CustomFeature = {
        id: `feature_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        name,
        scope: {
          type: scope as any,
          value: scope === 'urlPattern' ? urlPattern :
                scope === 'domain' ? this.extractDomain(this.currentHostname) :
                scope === 'hostname' ? this.currentHostname : ''
        },
        script: this.lastResponse.script,
        css: this.lastResponse.css,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        description: this.elements.featureDescription.value.trim() || undefined
      };

      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_CUSTOM_FEATURE',
        feature
      });

      if (response && response.type === 'FEATURE_SAVED') {
        this.showStatus(`Feature "${name}" saved successfully`, 'success');
        this.cancelFeatureSave();
        await this.loadCustomFeatures();
      } else {
        throw new Error(response?.error || 'Failed to save feature');
      }

    } catch (error) {
      console.error('Failed to save feature:', error);
      this.showStatus(`Failed to save feature: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  private cancelFeatureSave(): void {
    this.elements.saveAsFeature.checked = false;
    this.elements.featureSaveSection.classList.add('hidden');
    this.elements.featureName.value = '';
    this.elements.featureDescription.value = '';
    this.elements.featureScope.value = 'hostname';
    this.elements.urlPattern.value = '';
    this.elements.urlPattern.classList.add('hidden');
  }

  private async applyCustomFeature(featureId: string): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (!tab?.id || !tab.url) {
        throw new Error('No active tab found');
      }

      if (!this.isValidWebPage(tab.url)) {
        throw new Error('Cannot apply features on this page');
      }

      // Ensure content script is loaded
      await this.ensureContentScriptLoaded(tab.id);

      await chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_CUSTOM_FEATURE',
        featureId
      });

      this.showStatus('Custom feature applied', 'success');

    } catch (error) {
      console.error('Failed to apply custom feature:', error);
      this.showStatus('Failed to apply custom feature', 'error');
    }
  }

  private async deleteCustomFeature(featureId: string): Promise<void> {
    if (!confirm('Are you sure you want to delete this custom feature?')) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_CUSTOM_FEATURE',
        featureId
      });

      if (response && response.type === 'FEATURE_DELETED') {
        this.showStatus('Feature deleted', 'success');
        await this.loadCustomFeatures();
      } else {
        throw new Error(response?.error || 'Failed to delete feature');
      }

    } catch (error) {
      console.error('Failed to delete feature:', error);
      this.showStatus('Failed to delete feature', 'error');
    }
  }

  private async toggleAutoApply(featureId: string, enabled: boolean): Promise<void> {
    try {
      await chrome.runtime.sendMessage({
        type: 'TOGGLE_FEATURE_AUTO_APPLY',
        featureId,
        hostname: this.currentHostname,
        enabled
      });

    } catch (error) {
      console.error('Failed to toggle auto-apply:', error);
    }
  }

  private async toggleSiteDisabled(): Promise<void> {
    try {
      const currentlyDisabled = this.elements.siteStatus.classList.contains('disabled');
      const newDisabled = !currentlyDisabled;

      const response = await chrome.runtime.sendMessage({
        type: 'TOGGLE_SITE_DISABLED',
        hostname: this.currentHostname,
        disabled: newDisabled
      });

      if (response && response.type === 'SITE_DISABLED_TOGGLED') {
        this.updateSiteStatus(newDisabled);
        this.showStatus(
          newDisabled ? 'Web Augmenter disabled for this site' : 'Web Augmenter enabled for this site',
          'info'
        );
      }

    } catch (error) {
      console.error('Failed to toggle site status:', error);
      this.showStatus('Failed to toggle site status', 'error');
    }
  }

  private async removeAllFeatures(): Promise<void> {
    if (!confirm('Are you sure you want to remove all Web Augmenter features from this page?')) {
      return;
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (!tab?.id || !tab.url) {
        throw new Error('No active tab found');
      }

      if (!this.isValidWebPage(tab.url)) {
        throw new Error('Cannot remove features on this page');
      }

      // Ensure content script is loaded
      await this.ensureContentScriptLoaded(tab.id);

      await chrome.tabs.sendMessage(tab.id, {
        type: 'REMOVE_ALL_PATCHES'
      });

      this.showStatus('All features removed from this page', 'success');

    } catch (error) {
      console.error('Failed to remove features:', error);
      this.showStatus('Failed to remove features', 'error');
    }
  }

  private async testScreenshot(): Promise<void> {
    try {
      this.showStatus('Capturing screenshot...', 'info');

      const response = await chrome.runtime.sendMessage({
        type: 'GET_SCREENSHOT',
        options: { format: 'png' }
      });

      if (response && response.type === 'SCREENSHOT_RESPONSE' && response.screenshot) {
        this.showStatus('Screenshot captured successfully', 'success');
      } else {
        throw new Error('No screenshot returned');
      }

    } catch (error) {
      console.error('Screenshot test failed:', error);
      this.showStatus(`Screenshot failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  private toggleSettings(): void {
    const isHidden = this.elements.settingsContent.classList.contains('hidden');
    this.elements.settingsContent.classList.toggle('hidden', !isHidden);

    const expandIcon = this.elements.settingsToggle.querySelector('.expand-icon');
    expandIcon?.classList.toggle('expanded', isHidden);
  }

  private async saveSettings(): Promise<void> {
    try {
      const settings = {
        apiKey: this.elements.apiKey.value.trim() || undefined,
        includeScreenshotByDefault: this.elements.screenshotDefault.checked
      };

      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_GLOBAL_SETTINGS',
        settings
      });

      if (response && response.type === 'SETTINGS_UPDATED') {
        this.showStatus('Settings saved', 'success');
      } else {
        throw new Error(response?.error || 'Failed to save settings');
      }

    } catch (error) {
      console.error('Failed to save settings:', error);
      this.showStatus('Failed to save settings', 'error');
    }
  }

  private async exportData(): Promise<void> {
    try {
      const result = await chrome.storage.local.get();

      const dataStr = JSON.stringify(result, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `web-augmenter-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();

      URL.revokeObjectURL(url);
      this.showStatus('Data exported', 'success');

    } catch (error) {
      console.error('Failed to export data:', error);
      this.showStatus('Failed to export data', 'error');
    }
  }

  private async importData(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.customFeatures || data.siteSettings || data.globalSettings) {
        await chrome.storage.local.set(data);
        this.showStatus('Data imported successfully', 'success');
        await this.loadSettings();
        await this.loadCustomFeatures();
      } else {
        throw new Error('Invalid import file format');
      }

    } catch (error) {
      console.error('Failed to import data:', error);
      this.showStatus('Failed to import data', 'error');
    } finally {
      // Clear file input
      this.elements.importFile.value = '';
    }
  }

  private setLoading(loading: boolean): void {
    this.isLoading = loading;
    this.elements.executeBtn.disabled = loading;
    this.elements.executeText.classList.toggle('hidden', loading);
    this.elements.executeSpinner.classList.toggle('hidden', !loading);
  }

  private showStatus(message: string, type: 'success' | 'error' | 'info'): void {
    this.elements.status.textContent = message;
    this.elements.status.className = `status ${type}`;
    this.elements.status.classList.remove('hidden');

    // Auto-hide after delay
    setTimeout(() => {
      this.elements.status.classList.add('hidden');
    }, type === 'error' ? 5000 : 3000);
  }

  private updateSiteStatus(disabled: boolean): void {
    this.elements.siteStatus.className = disabled ? 'disabled' : 'enabled';
    this.elements.toggleSite.title = disabled ?
      'Web Augmenter is disabled for this site. Click to enable.' :
      'Web Augmenter is enabled for this site. Click to disable.';
  }

  private updateUIState(): void {
    // Update include screenshot based on default setting
    // (This is already handled in loadSettings)
  }

  private getScopeDisplayName(scope: CustomFeature['scope']): string {
    switch (scope.type) {
      case FEATURE_SCOPE_TYPES.HOSTNAME:
        return scope.value;
      case FEATURE_SCOPE_TYPES.DOMAIN:
        return `*.${scope.value}`;
      case FEATURE_SCOPE_TYPES.GLOBAL:
        return 'All sites';
      case FEATURE_SCOPE_TYPES.URL_PATTERN:
        return 'Pattern';
      default:
        return scope.type;
    }
  }

  private extractDomain(hostname: string): string {
    const parts = hostname.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : hostname;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize popup when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PopupUI());
} else {
  new PopupUI();
}