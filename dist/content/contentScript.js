"use strict";
(() => {
  // src/shared/constants.ts
  var STORAGE_KEYS = {
    CUSTOM_FEATURES: "customFeatures",
    SITE_SETTINGS: "siteSettings",
    GLOBAL_SETTINGS: "globalSettings"
  };
  var MESSAGE_TYPES = {
    EXECUTE_INSTRUCTION: "EXECUTE_INSTRUCTION",
    PAGE_CONTEXT_READY: "PAGE_CONTEXT_READY",
    FEATURE_RESPONSE: "FEATURE_RESPONSE",
    INJECT_PATCHES: "INJECT_PATCHES",
    ERROR: "ERROR"
  };
  var DOM_SNAPSHOT_CONFIG = {
    MAX_ELEMENTS: 200,
    MAX_TEXT_LENGTH: 100,
    SKIP_HIDDEN_ELEMENTS: true,
    IMPORTANT_TAGS: ["header", "nav", "main", "article", "section", "aside", "footer", "button", "input", "select", "textarea", "video", "canvas"]
  };
  var FEATURE_SCOPE_TYPES = {
    HOSTNAME: "hostname",
    DOMAIN: "domain",
    URL_PATTERN: "urlPattern",
    GLOBAL: "global"
  };

  // src/shared/domSnapshot.ts
  var DOMSnapshotGenerator = class {
    generate() {
      const url = window.location.href;
      const hostname = window.location.hostname;
      const title = document.title;
      const elements = this.collectImportantElements();
      return {
        url,
        hostname,
        title,
        elements
      };
    }
    collectImportantElements() {
      const elements = [];
      let count = 0;
      const importantSelectors = [
        "header",
        "nav",
        "main",
        "article",
        "section",
        "aside",
        "footer",
        '[role="banner"]',
        '[role="navigation"]',
        '[role="main"]',
        '[role="complementary"]',
        '[role="contentinfo"]',
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "button",
        "input",
        "select",
        "textarea",
        "video",
        "audio",
        "canvas",
        "iframe",
        "[data-testid]",
        "[aria-label]"
      ];
      for (const selector of importantSelectors) {
        if (count >= DOM_SNAPSHOT_CONFIG.MAX_ELEMENTS) break;
        const foundElements = document.querySelectorAll(selector);
        for (const element of foundElements) {
          if (count >= DOM_SNAPSHOT_CONFIG.MAX_ELEMENTS) break;
          const info = this.extractElementInfo(element);
          if (info && this.shouldIncludeElement(element)) {
            elements.push(info);
            count++;
          }
        }
      }
      if (count < DOM_SNAPSHOT_CONFIG.MAX_ELEMENTS) {
        const allElements = document.querySelectorAll("*");
        for (const element of allElements) {
          if (count >= DOM_SNAPSHOT_CONFIG.MAX_ELEMENTS) break;
          if (!this.isAlreadyIncluded(element, elements)) {
            const info = this.extractElementInfo(element);
            if (info && this.shouldIncludeElement(element)) {
              elements.push(info);
              count++;
            }
          }
        }
      }
      return elements;
    }
    extractElementInfo(element) {
      const tagName = element.tagName.toLowerCase();
      if (["script", "style", "noscript", "meta", "link"].includes(tagName)) {
        return null;
      }
      const info = {
        tagName
      };
      if (element.id) {
        info.id = element.id;
      }
      if (element.className && typeof element.className === "string") {
        const classes = element.className.trim();
        if (classes) {
          info.className = classes;
        }
      }
      if (element.getAttribute("role")) {
        info.role = element.getAttribute("role");
      }
      if (element.getAttribute("aria-label")) {
        info.ariaLabel = element.getAttribute("aria-label");
      }
      const text = this.getElementText(element);
      if (text) {
        info.innerText = text;
      }
      info.selector = this.generateSelector(element);
      return info;
    }
    getElementText(element) {
      if (element instanceof HTMLInputElement) {
        return element.value || element.placeholder || void 0;
      }
      if (element instanceof HTMLTextAreaElement) {
        return element.value || element.placeholder || void 0;
      }
      let text = "";
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent || "";
        }
      }
      text = text.trim();
      if (text.length === 0) return void 0;
      if (text.length > DOM_SNAPSHOT_CONFIG.MAX_TEXT_LENGTH) {
        return text.substring(0, DOM_SNAPSHOT_CONFIG.MAX_TEXT_LENGTH) + "...";
      }
      return text;
    }
    generateSelector(element) {
      if (element.id && this.isValidCSSIdentifier(element.id)) {
        return `#${this.escapeCSSIdentifier(element.id)}`;
      }
      if (element.className && typeof element.className === "string") {
        const classes = element.className.trim().split(/\s+/).filter((cls) => cls && this.isValidCSSIdentifier(cls));
        if (classes.length > 0) {
          const escapedClasses = classes.map((cls) => this.escapeCSSIdentifier(cls));
          const classSelector = `.${escapedClasses.join(".")}`;
          try {
            const matches = document.querySelectorAll(classSelector);
            if (matches.length <= 5) {
              return classSelector;
            }
          } catch (e) {
            console.warn("Invalid class selector generated:", classSelector, e);
          }
        }
      }
      if (element.getAttribute("role")) {
        return `[role="${element.getAttribute("role")}"]`;
      }
      for (const attr of element.attributes) {
        if (attr.name.startsWith("data-") && attr.value) {
          const selector = `[${attr.name}="${this.escapeCSSValue(attr.value)}"]`;
          try {
            const matches = document.querySelectorAll(selector);
            if (matches.length <= 3) {
              return selector;
            }
          } catch (e) {
            continue;
          }
        }
      }
      const tagName = element.tagName.toLowerCase();
      const siblings = Array.from(element.parentElement?.children || []).filter(
        (el) => el.tagName.toLowerCase() === tagName
      );
      if (siblings.length === 1) {
        return tagName;
      }
      const index = siblings.indexOf(element);
      return `${tagName}:nth-of-type(${index + 1})`;
    }
    shouldIncludeElement(element) {
      if (DOM_SNAPSHOT_CONFIG.SKIP_HIDDEN_ELEMENTS) {
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return false;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          return false;
        }
      }
      const classNameStr = typeof element.className === "string" ? element.className : element.className?.toString() || "";
      const id = element.id || "";
      const suspiciousTerms = ["analytics", "tracking", "gtm", "facebook", "twitter", "pixel"];
      for (const term of suspiciousTerms) {
        if (classNameStr.includes(term) || id.includes(term)) {
          return false;
        }
      }
      return true;
    }
    isAlreadyIncluded(element, elements) {
      const selector = this.generateSelector(element);
      return elements.some((info) => info.selector === selector);
    }
    /**
     * Check if a string is a valid CSS identifier (can be used in class/ID selectors)
     * CSS identifiers cannot contain spaces or most special characters
     */
    isValidCSSIdentifier(identifier) {
      if (!identifier || identifier.length === 0) {
        return false;
      }
      const invalidChars = /[^\w\-]/;
      return !invalidChars.test(identifier);
    }
    /**
     * Escape CSS identifiers for use in selectors
     * This handles special characters that need escaping in CSS
     */
    escapeCSSIdentifier(identifier) {
      if (typeof CSS !== "undefined" && CSS.escape) {
        return CSS.escape(identifier);
      }
      return identifier.replace(/[!"#$%&'()*+,.\/:;<=>?@\[\\\]^`{|}~]/g, "\\$&");
    }
    /**
     * Escape attribute values for use in CSS selectors
     */
    escapeCSSValue(value) {
      return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }
  };
  var domSnapshotGenerator = new DOMSnapshotGenerator();

  // src/shared/persistence.ts
  var PersistenceManager = class {
    async getStorageData() {
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.CUSTOM_FEATURES,
        STORAGE_KEYS.SITE_SETTINGS,
        STORAGE_KEYS.GLOBAL_SETTINGS
      ]);
      return {
        customFeatures: result[STORAGE_KEYS.CUSTOM_FEATURES] || {},
        siteSettings: result[STORAGE_KEYS.SITE_SETTINGS] || {},
        globalSettings: result[STORAGE_KEYS.GLOBAL_SETTINGS] || {
          includeScreenshotByDefault: true
        }
      };
    }
    async saveCustomFeature(feature) {
      const data = await this.getStorageData();
      data.customFeatures[feature.id] = feature;
      await chrome.storage.local.set({
        [STORAGE_KEYS.CUSTOM_FEATURES]: data.customFeatures
      });
    }
    async updateCustomFeature(featureId, updates) {
      const data = await this.getStorageData();
      if (!data.customFeatures[featureId]) {
        throw new Error(`Feature with ID ${featureId} not found`);
      }
      data.customFeatures[featureId] = {
        ...data.customFeatures[featureId],
        ...updates,
        updatedAt: Date.now()
      };
      await chrome.storage.local.set({
        [STORAGE_KEYS.CUSTOM_FEATURES]: data.customFeatures
      });
    }
    async deleteCustomFeature(featureId) {
      const data = await this.getStorageData();
      delete data.customFeatures[featureId];
      await chrome.storage.local.set({
        [STORAGE_KEYS.CUSTOM_FEATURES]: data.customFeatures
      });
      const siteSettings = data.siteSettings;
      for (const hostname in siteSettings) {
        siteSettings[hostname].autoApplyFeatures = siteSettings[hostname].autoApplyFeatures.filter((id) => id !== featureId);
      }
      await chrome.storage.local.set({
        [STORAGE_KEYS.SITE_SETTINGS]: siteSettings
      });
    }
    async getFeaturesForSite(url) {
      const hostname = new URL(url).hostname;
      const domain = this.extractDomain(hostname);
      const data = await this.getStorageData();
      const allFeatures = Object.values(data.customFeatures);
      const siteSettings = data.siteSettings[hostname];
      if (siteSettings?.disabledFeatures) {
        return [];
      }
      return allFeatures.filter((feature) => {
        if (!feature.autoApply && !siteSettings?.autoApplyFeatures?.includes(feature.id)) {
          return false;
        }
        switch (feature.scope.type) {
          case FEATURE_SCOPE_TYPES.GLOBAL:
            return true;
          case FEATURE_SCOPE_TYPES.HOSTNAME:
            return hostname === feature.scope.value;
          case FEATURE_SCOPE_TYPES.DOMAIN:
            return domain === feature.scope.value;
          case FEATURE_SCOPE_TYPES.URL_PATTERN:
            try {
              const regex = new RegExp(feature.scope.value);
              return regex.test(url);
            } catch (e) {
              console.warn(`Invalid URL pattern for feature ${feature.id}:`, e);
              return false;
            }
          default:
            return false;
        }
      });
    }
    async setAutoApply(featureId, hostname, enabled) {
      const data = await this.getStorageData();
      if (!data.siteSettings[hostname]) {
        data.siteSettings[hostname] = {
          disabledFeatures: false,
          autoApplyFeatures: []
        };
      }
      const currentFeatures = data.siteSettings[hostname].autoApplyFeatures;
      if (enabled) {
        if (!currentFeatures.includes(featureId)) {
          currentFeatures.push(featureId);
        }
      } else {
        const index = currentFeatures.indexOf(featureId);
        if (index > -1) {
          currentFeatures.splice(index, 1);
        }
      }
      await chrome.storage.local.set({
        [STORAGE_KEYS.SITE_SETTINGS]: data.siteSettings
      });
    }
    async setSiteDisabled(hostname, disabled) {
      const data = await this.getStorageData();
      if (!data.siteSettings[hostname]) {
        data.siteSettings[hostname] = {
          disabledFeatures: false,
          autoApplyFeatures: []
        };
      }
      data.siteSettings[hostname].disabledFeatures = disabled;
      await chrome.storage.local.set({
        [STORAGE_KEYS.SITE_SETTINGS]: data.siteSettings
      });
    }
    async isSiteDisabled(hostname) {
      const data = await this.getStorageData();
      return data.siteSettings[hostname]?.disabledFeatures || false;
    }
    async getAllCustomFeatures() {
      const data = await this.getStorageData();
      return Object.values(data.customFeatures);
    }
    async updateGlobalSettings(settings) {
      const data = await this.getStorageData();
      data.globalSettings = {
        ...data.globalSettings,
        ...settings
      };
      await chrome.storage.local.set({
        [STORAGE_KEYS.GLOBAL_SETTINGS]: data.globalSettings
      });
    }
    generateFeatureId() {
      return `feature_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    extractDomain(hostname) {
      const parts = hostname.split(".");
      if (parts.length <= 2) {
        return hostname;
      }
      return parts.slice(-2).join(".");
    }
    async exportData() {
      return this.getStorageData();
    }
    async importData(data) {
      const updates = {};
      if (data.customFeatures) {
        updates[STORAGE_KEYS.CUSTOM_FEATURES] = data.customFeatures;
      }
      if (data.siteSettings) {
        updates[STORAGE_KEYS.SITE_SETTINGS] = data.siteSettings;
      }
      if (data.globalSettings) {
        updates[STORAGE_KEYS.GLOBAL_SETTINGS] = data.globalSettings;
      }
      await chrome.storage.local.set(updates);
    }
  };
  var persistence = new PersistenceManager();

  // src/content/injectPatches.ts
  var PatchInjector = class {
    constructor() {
      this.injectedElements = /* @__PURE__ */ new Set();
    }
    async injectPatches(response) {
      try {
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 9);
        const cssId = `web-augmenter-css-${timestamp}-${randomId}`;
        const scriptId = `web-augmenter-script-${timestamp}-${randomId}`;
        if (response.css) {
          await this.injectCSS(response.css, cssId);
        }
        if (response.script) {
          await this.requestScriptInjection(response.script, scriptId);
        }
        console.log("Web Augmenter: Patches injected successfully", {
          goal: response.high_level_goal,
          plan: response.plan,
          notes: response.notes_for_extension,
          cssLength: response.css?.length || 0,
          scriptLength: response.script?.length || 0,
          css: response.css,
          script: response.script
        });
      } catch (error) {
        console.error("Web Augmenter: Failed to inject patches:", error);
        throw error;
      }
    }
    async requestScriptInjection(script, id) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "INJECT_SCRIPT_VIA_API",
          script,
          id
        });
        if (response?.success) {
          const methodNames = {
            "userScripts": "userScripts API (CSP-exempt)",
            "direct": "direct MAIN world",
            "csp-bypass": "CSP bypass pattern"
          };
          const method = methodNames[response.method] || response.method;
          console.log(`Web Augmenter: Script injected via ${method}`, {
            id,
            scriptLength: script.length,
            method: response.method
          });
          this.injectedElements.add(id);
        } else {
          throw new Error(response?.error || "Failed to inject script");
        }
      } catch (error) {
        console.error("Web Augmenter: Failed to request script injection:", error);
        throw error;
      }
    }
    async injectCSS(css, id) {
      return new Promise((resolve, reject) => {
        try {
          const cssHash = this.hashString(css);
          this.removeExistingStyles(cssHash);
          const styleElement = document.createElement("style");
          styleElement.id = id;
          styleElement.setAttribute("data-web-augmenter", "true");
          styleElement.setAttribute("data-css-hash", cssHash);
          styleElement.textContent = css;
          const head = document.head || document.getElementsByTagName("head")[0];
          head.appendChild(styleElement);
          this.injectedElements.add(id);
          console.log("Web Augmenter: CSS injected", { id, cssLength: css.length, cssPreview: css.substring(0, 200) });
          resolve();
        } catch (error) {
          reject(new Error(`Failed to inject CSS: ${error instanceof Error ? error.message : "Unknown error"}`));
        }
      });
    }
    removeExistingStyles(cssHash) {
      const existingStyles = document.querySelectorAll(`style[data-css-hash="${cssHash}"]`);
      existingStyles.forEach((style) => {
        try {
          style.remove();
          if (style.id) {
            this.injectedElements.delete(style.id);
          }
        } catch (e) {
          console.warn("Could not remove existing style:", e);
        }
      });
    }
    removeAllInjectedElements() {
      this.injectedElements.forEach((id) => {
        try {
          const element = document.getElementById(id);
          if (element) {
            element.remove();
          }
        } catch (e) {
          console.warn(`Could not remove element ${id}:`, e);
        }
      });
      const webAugmenterElements = document.querySelectorAll('[data-web-augmenter="true"]');
      webAugmenterElements.forEach((element) => {
        try {
          element.remove();
        } catch (e) {
          console.warn("Could not remove web-augmenter element:", e);
        }
      });
      this.injectedElements.clear();
    }
    hashString(str) {
      let hash = 0;
      if (str.length === 0) return hash.toString();
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(36);
    }
    getInjectedElementsCount() {
      return this.injectedElements.size;
    }
    hasActivePatches() {
      return this.injectedElements.size > 0 || document.querySelectorAll('[data-web-augmenter="true"]').length > 0;
    }
  };
  var patchInjector = new PatchInjector();

  // src/content/contentScript.ts
  var ContentScript = class {
    constructor() {
      this.isReady = false;
      this.autoAppliedFeatures = /* @__PURE__ */ new Set();
      this.extensionContextValid = true;
      this.reapplyTimeout = null;
      this.init();
    }
    isExtensionContextValid() {
      try {
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
    async init() {
      try {
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", () => this.onDOMReady());
        } else {
          this.onDOMReady();
        }
        this.setupMessageListeners();
        this.setupUtilityLibrary();
      } catch (error) {
        console.error("Web Augmenter: Failed to initialize content script:", error);
      }
    }
    onDOMReady() {
      this.isReady = true;
      console.log("Web Augmenter: Content script ready");
      this.autoApplyFeatures();
      this.setupMutationObserver();
    }
    setupMessageListeners() {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleMessage(message, sender).then((response) => {
          if (response) {
            sendResponse(response);
          }
        }).catch((error) => {
          console.error("Web Augmenter: Error handling message:", error);
          sendResponse({
            type: MESSAGE_TYPES.ERROR,
            error: error.message || "Unknown error"
          });
        });
        return true;
      });
      window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        if (event.data.type === "WEB_AUGMENTER_EXECUTE") {
          this.handleExecuteInstruction(event.data.userInstruction, event.data.includeScreenshot);
        }
      });
    }
    async handleMessage(message, sender) {
      try {
        switch (message.type) {
          case "PING":
            return { type: "PONG" };
          case MESSAGE_TYPES.EXECUTE_INSTRUCTION:
            return await this.handleExecuteInstruction(message.userInstruction, message.includeScreenshot);
          case MESSAGE_TYPES.INJECT_PATCHES:
            return await this.handleInjectPatches(message);
          case "GET_PAGE_INFO":
            return this.handleGetPageInfo();
          case "REMOVE_ALL_PATCHES":
            return this.handleRemoveAllPatches();
          case "CONTEXT_MENU_CLICKED":
            return this.handleContextMenuClicked();
          case "STORAGE_CHANGED":
            return this.handleStorageChanged(message.changes);
          case "APPLY_CUSTOM_FEATURE":
            return await this.handleApplyCustomFeature(message.featureId);
          default:
            console.warn("Web Augmenter: Unknown message type:", message.type);
            return void 0;
        }
      } catch (error) {
        console.error("Web Augmenter: Message handler error:", error);
        throw error;
      }
    }
    async handleExecuteInstruction(userInstruction, includeScreenshot) {
      try {
        if (!this.isReady) {
          throw new Error("Content script not ready");
        }
        console.log("Web Augmenter: Executing instruction:", userInstruction);
        const domSummary = domSnapshotGenerator.generate();
        const pageContext = {
          domSummary,
          url: window.location.href,
          hostname: window.location.hostname,
          userInstruction
        };
        const response = await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.PAGE_CONTEXT_READY,
          pageContext,
          includeScreenshot
        });
        if (response.type === MESSAGE_TYPES.ERROR) {
          throw new Error(response.error);
        }
        return {
          type: "INSTRUCTION_RECEIVED",
          success: true
        };
      } catch (error) {
        console.error("Web Augmenter: Failed to execute instruction:", error);
        return {
          type: MESSAGE_TYPES.ERROR,
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
    async handleInjectPatches(message) {
      try {
        await patchInjector.injectPatches(message.patches);
        const hasCSS = message.patches.css && message.patches.css.length > 0;
        const hasScript = message.patches.script && message.patches.script.length > 0;
        let details = "";
        if (hasCSS && hasScript) {
          details = " (CSS + JS)";
        } else if (hasCSS) {
          details = " (CSS only)";
        } else if (hasScript) {
          details = " (JS only)";
        } else {
          details = " (No changes generated)";
        }
        this.showNotification(
          `\u2713 Applied: ${message.patches.high_level_goal}${details}`,
          hasCSS || hasScript ? "success" : "error"
        );
        console.log("Web Augmenter: Patch details", {
          goal: message.patches.high_level_goal,
          hasCSS,
          hasScript,
          cssLength: message.patches.css?.length || 0,
          scriptLength: message.patches.script?.length || 0
        });
      } catch (error) {
        console.error("Web Augmenter: Failed to inject patches:", error);
        this.showNotification("Failed to apply changes", "error");
        throw error;
      }
    }
    handleGetPageInfo() {
      return {
        type: "PAGE_INFO_RESPONSE",
        pageInfo: {
          url: window.location.href,
          hostname: window.location.hostname,
          title: document.title,
          hasActivePatches: patchInjector.hasActivePatches(),
          autoAppliedFeatures: Array.from(this.autoAppliedFeatures)
        }
      };
    }
    handleRemoveAllPatches() {
      patchInjector.removeAllInjectedElements();
      this.autoAppliedFeatures.clear();
      this.showNotification("All Web Augmenter features removed", "info");
    }
    handleContextMenuClicked() {
      window.postMessage({
        type: "WEB_AUGMENTER_CONTEXT_MENU",
        url: window.location.href
      }, "*");
    }
    async handleStorageChanged(changes) {
      if (changes.customFeatures) {
        this.autoApplyFeatures();
      }
    }
    async handleApplyCustomFeature(featureId) {
      try {
        const features = await persistence.getAllCustomFeatures();
        const feature = features.find((f) => f.id === featureId);
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
        this.showNotification(`Applied: ${feature.name}`, "success");
      } catch (error) {
        console.error("Web Augmenter: Failed to apply custom feature:", error);
        this.showNotification(`Failed to apply feature`, "error");
        throw error;
      }
    }
    async autoApplyFeatures() {
      try {
        if (!this.isExtensionContextValid()) {
          console.log("Web Augmenter: Extension context invalidated, skipping auto-apply. Please refresh the page.");
          return;
        }
        const isDisabled = await persistence.isSiteDisabled(window.location.hostname);
        if (isDisabled) {
          console.log("Web Augmenter: Site disabled, skipping auto-apply");
          return;
        }
        const features = await persistence.getFeaturesForSite(window.location.href);
        for (const feature of features) {
          if (this.autoAppliedFeatures.has(feature.id)) {
            continue;
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
            "info"
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("Extension context invalidated")) {
          console.log("Web Augmenter: Extension was reloaded. Please refresh the page to use the extension.");
          this.extensionContextValid = false;
          return;
        }
        console.error("Web Augmenter: Failed to auto-apply features:", error);
      }
    }
    setupMutationObserver() {
      const observer = new MutationObserver((mutations) => {
        let hasSignificantChanges = false;
        for (const mutation of mutations) {
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                if (element.tagName && !element.hasAttribute("data-web-augmenter")) {
                  hasSignificantChanges = true;
                  break;
                }
              }
            }
          }
          if (hasSignificantChanges) break;
        }
        if (hasSignificantChanges) {
          this.debounceReapply();
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
    debounceReapply() {
      if (this.reapplyTimeout) {
        clearTimeout(this.reapplyTimeout);
      }
      this.reapplyTimeout = setTimeout(() => {
        this.autoApplyFeatures();
        this.reapplyTimeout = null;
      }, 1e3);
    }
    setupUtilityLibrary() {
      window.WebAugmenterUtils = {
        observeAddedNodes: function(callback) {
          const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
              if (mutation.type === "childList") {
                mutation.addedNodes.forEach((node) => {
                  if (node.nodeType === Node.ELEMENT_NODE) {
                    callback(node);
                  }
                });
              }
            });
          });
          observer.observe(document.body, { childList: true, subtree: true });
          return observer;
        },
        hideElements: function(selector) {
          document.querySelectorAll(selector).forEach((el) => {
            el.style.display = "none";
          });
        },
        showElements: function(selector) {
          document.querySelectorAll(selector).forEach((el) => {
            el.style.display = "";
          });
        },
        findMainContent: function() {
          const candidates = [
            document.querySelector("main"),
            document.querySelector('[role="main"]'),
            document.querySelector("article"),
            document.querySelector(".main-content"),
            document.querySelector("#main-content"),
            document.querySelector(".content")
          ];
          return candidates.find((el) => el && el.offsetHeight > 100) || document.body;
        },
        createFloatingButton: function(text, onClick, position = { top: "20px", right: "20px" }) {
          const button = document.createElement("div");
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
          button.addEventListener("mouseenter", () => {
            button.style.background = "#005a8b";
          });
          button.addEventListener("mouseleave", () => {
            button.style.background = "#007cba";
          });
          button.addEventListener("click", onClick);
          document.body.appendChild(button);
          return button;
        }
      };
    }
    showNotification(message, type = "info") {
      const notification = document.createElement("div");
      notification.textContent = message;
      notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === "success" ? "#4CAF50" : type === "error" ? "#f44336" : "#2196F3"};
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
      setTimeout(() => {
        try {
          notification.remove();
        } catch (e) {
        }
      }, 3e3);
    }
  };
  new ContentScript();
})();
//# sourceMappingURL=contentScript.js.map
