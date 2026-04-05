import { CustomFeature } from '../shared/types.js';
import { FEATURE_SCOPE_TYPES } from '../shared/constants.js';

type Mode = 'prompt' | 'inspect' | 'draw';

interface SelectedElement {
  selector: string;
  elementInfo: any;
}

interface DrawnRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

class PopupUI {
  private currentHostname: string = '';
  private currentUrl: string = '';
  private isLoading: boolean = false;
  private activeMode: Mode = 'prompt';
  private selectedElement: SelectedElement | null = null;
  private drawnRegion: DrawnRegion | null = null;

  constructor() {
    this.init();
  }

  private get<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    return el as T;
  }

  private async init(): Promise<void> {
    try {
      await this.loadCurrentTab();
      await this.loadSettings();
      await this.loadCustomFeatures();
      this.setupEventListeners();
      this.setupMessageListener();
    } catch (error) {
      console.error('Failed to initialize popup:', error);
    }
  }

  // ---- Tab ----

  private async loadCurrentTab(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab?.url) {
        this.currentUrl = tab.url;
        this.currentHostname = new URL(tab.url).hostname;
      }
    } catch {
      // hostname stays empty
    }
  }

  // ---- Settings ----

  private async loadSettings(): Promise<void> {
    const result = await chrome.storage.local.get(['globalSettings']);
    const settings = result.globalSettings || {};
    this.setApiKeyUI(!!(settings.apiKey));
  }

  private setApiKeyUI(hasKey: boolean): void {
    const btn = this.get('apiKeyBtn');
    btn.classList.toggle('has-key', hasKey);
    this.get('apiKeyIconLocked').classList.toggle('hidden', !hasKey);
    this.get('apiKeyIconUnlocked').classList.toggle('hidden', hasKey);
    this.get('apiDialogNoKey').classList.toggle('hidden', hasKey);
    this.get('apiDialogHasKey').classList.toggle('hidden', !hasKey);
    if (!hasKey) this.get<HTMLInputElement>('apiKey').value = '';
  }

  private openApiKeyDialog(): void {
    this.get('apiKeyDialog').classList.remove('hidden');
    if (!this.get('apiDialogNoKey').classList.contains('hidden')) {
      setTimeout(() => this.get<HTMLInputElement>('apiKey').focus(), 50);
    }
  }

  private closeApiKeyDialog(): void {
    this.get('apiKeyDialog').classList.add('hidden');
  }

  private async saveApiKey(): Promise<void> {
    const key = this.get<HTMLInputElement>('apiKey').value.trim();
    if (!key) return;
    const result = await chrome.storage.local.get(['globalSettings']);
    const settings = { ...(result.globalSettings || {}), apiKey: key };
    await chrome.runtime.sendMessage({ type: 'UPDATE_GLOBAL_SETTINGS', settings });
    this.setApiKeyUI(true);
    this.closeApiKeyDialog();
  }

  private async removeApiKey(): Promise<void> {
    const result = await chrome.storage.local.get(['globalSettings']);
    const settings = { ...(result.globalSettings || {}) };
    delete settings.apiKey;
    await chrome.storage.local.set({ globalSettings: settings });
    this.setApiKeyUI(false);
    this.closeApiKeyDialog();
  }

  // ---- Mode switching ----

  private readonly modeDescriptions: Record<Mode, string> = {
    prompt: 'Describe what you want to change on the page',
    inspect: 'Click any element on the page to select it',
    draw: 'Draw a rectangle on the page to define a region',
  };

  private readonly modePlaceholders: Record<Mode, string> = {
    prompt: "e.g. 'Hide the sidebar', 'Make text larger'",
    inspect: 'Select an element, then describe the change',
    draw: 'Draw a region, then describe the UI',
  };

  private enableMsgType(mode: 'inspect' | 'draw'): string {
    return mode === 'inspect' ? 'ENABLE_VISUAL_EDITING_MODE' : 'ENABLE_UI_GENERATION_MODE';
  }

  private disableMsgType(mode: 'inspect' | 'draw'): string {
    return mode === 'inspect' ? 'DISABLE_VISUAL_EDITING_MODE' : 'DISABLE_UI_GENERATION_MODE';
  }

  private async sendToActiveTab(type: string): Promise<void> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab?.id && tab.url && this.isValidWebPage(tab.url)) {
      await this.ensureContentScriptLoaded(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type });
    }
  }

  private async switchMode(mode: Mode): Promise<void> {
    const prevMode = this.activeMode;
    this.activeMode = mode;
    this.clearContext(false);

    (['prompt', 'inspect', 'draw'] as Mode[]).forEach(m => {
      this.get(`mode${m.charAt(0).toUpperCase() + m.slice(1)}`).classList.toggle('active', m === mode);
    });

    this.get<HTMLTextAreaElement>('instruction').placeholder = this.modePlaceholders[mode];
    this.updateModeHint();

    try {
      // Deactivate previous page mode
      if (prevMode !== mode && (prevMode === 'inspect' || prevMode === 'draw')) {
        await this.sendToActiveTab(this.disableMsgType(prevMode));
      }

      // Activate new page mode
      if (mode === 'inspect' || mode === 'draw') {
        await this.sendToActiveTab(this.enableMsgType(mode));
      }
    } catch (error) {
      console.error('Failed to toggle mode on page:', error);
    }
  }

  // ---- Context tag ----

  private readonly modeHintText: Partial<Record<Mode, string>> = {
    inspect: 'Click an element on the page',
    draw: 'Draw a rectangle on the page',
  };

  private updateModeHint(): void {
    const hint = this.get('modeHint');
    const hasContext = !this.get('contextTag').classList.contains('hidden');
    const msg = this.modeHintText[this.activeMode];
    if (msg && !hasContext) {
      hint.textContent = msg;
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
    }

    // Highlight the active tab with filled indigo when a page mode is active
    (['inspect', 'draw'] as Mode[]).forEach(m => {
      const tab = this.get(`mode${m.charAt(0).toUpperCase() + m.slice(1)}`);
      tab.classList.toggle('mode-active-page', m === this.activeMode);
    });
  }

  private setContext(text: string, element: SelectedElement | null, region: DrawnRegion | null): void {
    this.selectedElement = element;
    this.drawnRegion = region;
    this.get('contextTagText').textContent = text;
    this.get('contextTag').classList.remove('hidden');
    this.get<HTMLTextAreaElement>('instruction').focus();
    this.updateModeHint();
  }

  private clearContext(deactivatePage: boolean = true): void {
    this.selectedElement = null;
    this.drawnRegion = null;
    this.get('contextTag').classList.add('hidden');
    this.get('contextTagText').textContent = '';
    this.updateModeHint();

    if (deactivatePage && (this.activeMode === 'inspect' || this.activeMode === 'draw')) {
      this.sendToActiveTab(this.disableMsgType(this.activeMode)).catch(() => {});
    }
  }

  // ---- Message listener (from content script) ----

  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'ELEMENT_SELECTED') {
        const info = message.elementInfo;
        const label = [info.tagName, info.id ? `#${info.id}` : '', info.className ? `.${info.className.split(' ')[0]}` : '']
          .filter(Boolean).join('');
        this.setContext(`${label} selected`, { selector: message.selector, elementInfo: info }, null);
      } else if (message.type === 'REGION_DRAWN') {
        const { x, y, width, height } = message.location;
        this.setContext(`${Math.round(width)}×${Math.round(height)} region`, null, message.location);
      } else if (message.type === 'PATCHES_APPLIED') {
        this.setLoading(false);
        this.loadCustomFeatures();
      } else if (message.type === 'PATCHES_FAILED') {
        this.setLoading(false);
        this.showStatus(message.error || 'Failed to apply', 'error');
      }
    });
  }

  // ---- Execute instruction ----

  private async executeInstruction(): Promise<void> {
    const instruction = this.get<HTMLTextAreaElement>('instruction').value.trim();
    if (!instruction) return;

    const result = await chrome.storage.local.get(['globalSettings']);
    if (!result.globalSettings?.apiKey) {
      this.openApiKeyDialog();
      return;
    }

    if (this.isLoading) return;

    try {
      this.setLoading(true);

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id || !tab.url) throw new Error('No active tab found');
      if (!this.isValidWebPage(tab.url)) throw new Error('Web Augmenter cannot run on this page.');

      await this.ensureContentScriptLoaded(tab.id);

      if (this.selectedElement) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'EXECUTE_ELEMENT_INSTRUCTION',
          instruction,
          selector: this.selectedElement.selector,
          elementInfo: this.selectedElement.elementInfo
        });
      } else if (this.drawnRegion) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'GENERATE_UI_FROM_PANEL',
          instruction,
          location: this.drawnRegion
        });
      } else {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXECUTE_INSTRUCTION',
          userInstruction: instruction,
          includeScreenshot: true
        });
        if (response?.type === 'ERROR') {
          throw new Error(response.error);
        }
      }

      // Reset to prompt mode and clear input — loading resolved by PATCHES_APPLIED / PATCHES_FAILED
      await this.switchMode('prompt');
      const ta = this.get<HTMLTextAreaElement>('instruction');
      ta.value = '';
      ta.style.height = 'auto';
      this.updateSendBtn(ta);

    } catch (error) {
      this.showStatus(error instanceof Error ? error.message : 'Unknown error', 'error');
      this.setLoading(false);
    }
  }

  // ---- Custom features ----

  private async loadCustomFeatures(): Promise<void> {
    this.get('featuresLoading').classList.remove('hidden');
    this.get('noFeatures').classList.add('hidden');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_CUSTOM_FEATURES' });
      if (response?.type === 'CUSTOM_FEATURES_RESPONSE') {
        this.renderCustomFeatures(response.features);
      }
    } catch (error) {
      console.error('Failed to load custom features:', error);
    } finally {
      this.get('featuresLoading').classList.add('hidden');
    }
  }

  private featureMatchesSite(feature: CustomFeature): boolean {
    const { type, value } = feature.scope;
    if (type === FEATURE_SCOPE_TYPES.GLOBAL) return true;
    if (type === FEATURE_SCOPE_TYPES.HOSTNAME) return value === this.currentHostname;
    if (type === FEATURE_SCOPE_TYPES.DOMAIN) {
      const domain = this.currentHostname.split('.').slice(-2).join('.');
      return value === domain || this.currentHostname.endsWith('.' + value);
    }
    if (type === FEATURE_SCOPE_TYPES.URL_PATTERN) {
      try { return new RegExp(value).test(this.currentUrl); } catch { return false; }
    }
    return false;
  }

  private renderCustomFeatures(features: CustomFeature[]): void {
    const container = this.get('featuresList');
    container.querySelectorAll('.feature-item').forEach(el => el.remove());

    const siteFeatures = features.filter(f => this.featureMatchesSite(f));

    if (siteFeatures.length === 0) {
      this.get('noFeatures').classList.remove('hidden');
      return;
    }
    this.get('noFeatures').classList.add('hidden');
    siteFeatures.forEach(f => container.appendChild(this.createFeatureElement(f)));
  }

  private createFeatureElement(feature: CustomFeature): HTMLElement {
    const enabled = feature.autoApply !== false;
    const div = document.createElement('div');
    div.className = `feature-item${enabled ? ' enabled' : ''}`;
    div.innerHTML = `
      <button class="feature-toggle${enabled ? ' on' : ''}">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <polyline points="2,6 5,9 10,3" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="feature-name">${this.escapeHtml(feature.name)}</span>
      <button class="feature-delete" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <polyline points="3,6 21,6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M8 6V4h8v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="5" y="6" width="14" height="15" rx="2" stroke="currentColor" stroke-width="2"/>
          <line x1="10" y1="11" x2="10" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <line x1="14" y1="11" x2="14" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    const toggle = div.querySelector('.feature-toggle') as HTMLButtonElement;
    toggle.addEventListener('click', () => {
      const isOn = toggle.classList.toggle('on');
      div.classList.toggle('enabled', isOn);
      this.toggleAutoApply(feature.id, isOn);
    });

    div.querySelector('.feature-delete')!.addEventListener('click', () => this.deleteCustomFeature(feature.id));

    return div;
  }

  private async deleteCustomFeature(featureId: string): Promise<void> {
    if (!confirm('Delete this feature?')) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DELETE_CUSTOM_FEATURE', featureId });
      if (response?.type === 'FEATURE_DELETED') {
        await this.loadCustomFeatures();
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
      }
    } catch {
      // extension context invalidated — nothing to show
    }
  }

  private async toggleAutoApply(featureId: string, enabled: boolean): Promise<void> {
    await chrome.runtime.sendMessage({
      type: 'TOGGLE_FEATURE_AUTO_APPLY',
      featureId,
      hostname: this.currentHostname,
      enabled
    });
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
  }

  // ---- Event listeners ----

  private setupEventListeners(): void {
    // Mode cards
    this.get('modePrompt').addEventListener('click', () => this.switchMode('prompt'));
    this.get('modeInspect').addEventListener('click', () => this.switchMode('inspect'));
    this.get('modeDraw').addEventListener('click', () => this.switchMode('draw'));

    // Bottom input bar
    this.get('executeBtn').addEventListener('click', () => this.executeInstruction());
    const textarea = this.get<HTMLTextAreaElement>('instruction');
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.executeInstruction();
      }
    });
    textarea.addEventListener('input', () => {
      this.autoGrow(textarea);
      this.updateSendBtn(textarea);
    });
    this.updateSendBtn(textarea);

    // Context tag clear
    this.get('contextTagClear').addEventListener('click', () => {
      if (this.activeMode !== 'prompt') {
        this.switchMode('prompt'); // handles deactivation
      } else {
        this.clearContext();
      }
    });


    // API key dialog
    this.get('apiKeyBtn').addEventListener('click', () => this.openApiKeyDialog());
    this.get('apiKeyDialog').addEventListener('click', (e) => {
      if (e.target === this.get('apiKeyDialog')) this.closeApiKeyDialog();
    });
    this.get('apiKeyDialogClose').addEventListener('click', () => this.closeApiKeyDialog());
    this.get('apiKeyDialogCancelRemove').addEventListener('click', () => this.closeApiKeyDialog());
    this.get('apiKeySaveBtn').addEventListener('click', () => this.saveApiKey());
    this.get('removeApiKeyBtn').addEventListener('click', () => this.removeApiKey());
    this.get<HTMLInputElement>('apiKey').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveApiKey();
    });
  }

  // ---- Helpers ----

  private updateSendBtn(ta: HTMLTextAreaElement): void {
    const btn = this.get<HTMLButtonElement>('executeBtn');
    if (!this.isLoading) btn.disabled = !ta.value.trim();
  }

  private autoGrow(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }

  private setLoading(loading: boolean): void {
    this.isLoading = loading;
    const btn = this.get<HTMLButtonElement>('executeBtn');
    btn.disabled = loading;
    this.get('executeText').classList.toggle('hidden', loading);
    this.get('executeSpinner').classList.toggle('hidden', !loading);
  }

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private showStatus(message: string, type: 'success' | 'error' | 'info'): void {
    const inputBar = this.get('inputBar');
    document.documentElement.style.setProperty('--input-bar-height', inputBar.offsetHeight + 'px');
    const toast = this.get('toast');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    const delay = type === 'error' ? 5000 : 3000;
    this.toastTimer = setTimeout(() => toast.classList.remove('show'), delay);
  }

  private isValidWebPage(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
  }

  private async ensureContentScriptLoaded(tabId: number): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/contentScript.js'] });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private getScopeDisplayName(scope: CustomFeature['scope']): string {
    switch (scope.type) {
      case FEATURE_SCOPE_TYPES.HOSTNAME: return scope.value;
      case FEATURE_SCOPE_TYPES.DOMAIN: return `*.${scope.value}`;
      case FEATURE_SCOPE_TYPES.GLOBAL: return 'All sites';
      case FEATURE_SCOPE_TYPES.URL_PATTERN: return 'Pattern';
      default: return scope.type;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PopupUI());
} else {
  new PopupUI();
}
