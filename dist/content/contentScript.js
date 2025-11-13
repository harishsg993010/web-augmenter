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
    ERROR: "ERROR",
    EXECUTE_TOOL: "EXECUTE_TOOL",
    TOOL_RESULT: "TOOL_RESULT"
  };
  var DOM_SNAPSHOT_CONFIG = {
    MAX_ELEMENTS: 500,
    // Reduced to avoid token limits
    MAX_TEXT_LENGTH: 100,
    // Reduced for token efficiency
    SKIP_HIDDEN_ELEMENTS: true,
    // Skip hidden elements to reduce size
    INCLUDE_FULL_HTML: false,
    // Disabled by default - use tools instead
    MAX_HTML_LENGTH: 2e4,
    // Max characters for HTML snapshot (20KB) - much smaller
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
      const fullHTML = this.captureFullHTML();
      return {
        url,
        hostname,
        title,
        elements,
        fullHTML
      };
    }
    captureFullHTML() {
      if (!DOM_SNAPSHOT_CONFIG.INCLUDE_FULL_HTML) {
        return void 0;
      }
      try {
        let html = document.documentElement.outerHTML;
        html = this.cleanHTML(html);
        if (html.length > DOM_SNAPSHOT_CONFIG.MAX_HTML_LENGTH) {
          console.warn(`HTML snapshot truncated from ${html.length} to ${DOM_SNAPSHOT_CONFIG.MAX_HTML_LENGTH} characters`);
          html = html.substring(0, DOM_SNAPSHOT_CONFIG.MAX_HTML_LENGTH) + "\n<!-- ... HTML truncated ... -->";
        }
        return html;
      } catch (error) {
        console.error("Failed to capture full HTML:", error);
        return void 0;
      }
    }
    cleanHTML(html) {
      html = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, "<script>/* script removed */<\/script>");
      html = html.replace(/\s+on\w+="[^"]*"/gi, "");
      html = html.replace(/\s+on\w+='[^']*'/gi, "");
      html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "<style>/* styles removed */</style>");
      html = html.replace(/<!--[\s\S]*?-->/g, "");
      return html;
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

  // src/content/toolExecutor.ts
  var ToolExecutor = class {
    async executeTool(toolName, toolInput) {
      try {
        switch (toolName) {
          case "search_dom":
            return this.searchDOM(toolInput.selector);
          case "read_element":
            return this.readElement(toolInput.selector, toolInput.includeHTML);
          case "get_page_structure":
            return this.getPageStructure(toolInput.maxDepth, toolInput.rootSelector);
          case "search_page_source":
            return this.searchPageSource(toolInput.searchTerm, toolInput.maxResults);
          case "read_page_source":
            return this.readPageSource(toolInput.startLine, toolInput.endLine);
          default:
            return JSON.stringify({ error: `Unknown tool: ${toolName}` });
        }
      } catch (error) {
        return JSON.stringify({ error: `Tool execution failed: ${error}` });
      }
    }
    searchDOM(selector) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) {
          return JSON.stringify({
            found: 0,
            message: `No elements found matching selector: ${selector}`
          });
        }
        const results = Array.from(elements).slice(0, 20).map((el, idx) => {
          const element = el;
          return {
            index: idx,
            tagName: element.tagName.toLowerCase(),
            id: element.id || void 0,
            className: element.className || void 0,
            textContent: element.textContent?.trim().substring(0, 100) || void 0,
            attributes: Array.from(element.attributes).reduce((acc, attr) => {
              acc[attr.name] = attr.value;
              return acc;
            }, {})
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
    readElement(selector, includeHTML) {
      try {
        const element = document.querySelector(selector);
        if (!element) {
          return JSON.stringify({ error: `Element not found: ${selector}` });
        }
        const computedStyle = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const result = {
          tagName: element.tagName.toLowerCase(),
          id: element.id || void 0,
          className: element.className || void 0,
          textContent: element.textContent?.trim() || void 0,
          attributes: Array.from(element.attributes).reduce((acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          }, {}),
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
          result.innerHTML = element.innerHTML.substring(0, 5e3);
        }
        return JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({ error: `Failed to read element: ${error}` });
      }
    }
    getPageStructure(maxDepth, rootSelector) {
      try {
        const root = rootSelector ? document.querySelector(rootSelector) : document.body;
        if (!root) {
          return JSON.stringify({ error: "Root element not found" });
        }
        const depth = maxDepth || 3;
        const buildTree = (element, currentDepth) => {
          if (currentDepth > depth) return null;
          const el = element;
          const node = {
            tag: el.tagName.toLowerCase(),
            id: el.id || void 0,
            class: el.className || void 0,
            children: []
          };
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
    searchPageSource(searchTerm, maxResults) {
      try {
        const htmlSource = document.documentElement.outerHTML;
        const lines = htmlSource.split("\n");
        const limit = maxResults || 20;
        const results = [];
        const searchRegex = new RegExp(searchTerm, "gi");
        for (let i = 0; i < lines.length && results.length < limit; i++) {
          if (searchRegex.test(lines[i])) {
            const contextStart = Math.max(0, i - 2);
            const contextEnd = Math.min(lines.length, i + 3);
            const context = lines.slice(contextStart, contextEnd);
            results.push({
              lineNumber: i + 1,
              line: lines[i].trim(),
              context: context.map((line, idx) => {
                const lineNum = contextStart + idx + 1;
                const marker = lineNum === i + 1 ? "\u2192" : " ";
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
    readPageSource(startLine, endLine) {
      try {
        const htmlSource = document.documentElement.outerHTML;
        const lines = htmlSource.split("\n");
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
          source: numberedLines.join("\n")
        }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: `Failed to read page source: ${error}` });
      }
    }
  };
  var toolExecutor = new ToolExecutor();

  // src/content/contentScript.ts
  var ContentScript = class {
    constructor() {
      this.isReady = false;
      this.autoAppliedFeatures = /* @__PURE__ */ new Set();
      this.extensionContextValid = true;
      this.selectedElement = null;
      this.highlightOverlay = null;
      this.savedElements = /* @__PURE__ */ new Map();
      this.isPickerActive = false;
      this.isDrawing = false;
      this.drawStartX = 0;
      this.drawStartY = 0;
      this.selectionBox = null;
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
      this.setupElementTracking();
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
          case "ADD_ELEMENT_TO_AUGMENTER":
            return this.handleAddElementToAugmenter(message.selectionText);
          case "STORAGE_CHANGED":
            return this.handleStorageChanged(message.changes);
          case "APPLY_CUSTOM_FEATURE":
            return await this.handleApplyCustomFeature(message.featureId);
          case MESSAGE_TYPES.EXECUTE_TOOL:
            return await this.handleExecuteTool(message.toolName, message.toolInput);
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
    async handleAddElementToAugmenter(selectionText) {
      try {
        this.activateElementPicker(selectionText);
      } catch (error) {
        console.error("Web Augmenter: Failed to add element:", error);
        this.showNotification("Failed to add element", "error");
      }
    }
    activateElementPicker(selectionText) {
      this.isPickerActive = true;
      this.showNotification("\u{1F4E6} Draw a box around the element to select it. Press ESC to cancel.", "info");
      const pickerOverlay = document.createElement("div");
      pickerOverlay.id = "web-augmenter-picker-overlay";
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
      const handleMouseMove = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.isDrawing) {
          this.updateSelectionBox(e.clientX, e.clientY);
        }
      };
      const handleMouseDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.isDrawing = true;
        this.drawStartX = e.clientX;
        this.drawStartY = e.clientY;
        this.selectionBox = document.createElement("div");
        this.selectionBox.id = "web-augmenter-selection-box";
        this.selectionBox.style.cssText = `
        position: fixed;
        border: 2px dashed #007cba;
        background: rgba(0, 124, 186, 0.1);
        pointer-events: none;
        z-index: 999999;
      `;
        document.body.appendChild(this.selectionBox);
      };
      const handleMouseUp = (e) => {
        if (this.isDrawing) {
          e.preventDefault();
          e.stopPropagation();
          this.isDrawing = false;
          const selectedElement = this.findElementInBox(
            Math.min(this.drawStartX, e.clientX),
            Math.min(this.drawStartY, e.clientY),
            Math.abs(e.clientX - this.drawStartX),
            Math.abs(e.clientY - this.drawStartY)
          );
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
      const handleKeyDown = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          this.deactivateElementPicker(pickerOverlay, handleMouseMove, handleMouseDown, handleMouseUp, handleKeyDown);
          this.showNotification("Element picker cancelled", "info");
        }
      };
      pickerOverlay.addEventListener("mousemove", handleMouseMove);
      pickerOverlay.addEventListener("mousedown", handleMouseDown);
      pickerOverlay.addEventListener("mouseup", handleMouseUp);
      document.addEventListener("keydown", handleKeyDown);
      document.body.appendChild(pickerOverlay);
    }
    deactivateElementPicker(overlay, mouseMoveHandler, mouseDownHandler, mouseUpHandler, keyDownHandler) {
      this.isPickerActive = false;
      this.isDrawing = false;
      overlay.removeEventListener("mousemove", mouseMoveHandler);
      overlay.removeEventListener("mousedown", mouseDownHandler);
      overlay.removeEventListener("mouseup", mouseUpHandler);
      document.removeEventListener("keydown", keyDownHandler);
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
    updateSelectionBox(currentX, currentY) {
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
    findElementInBox(boxLeft, boxTop, boxWidth, boxHeight) {
      const boxRight = boxLeft + boxWidth;
      const boxBottom = boxTop + boxHeight;
      const boxCenterX = boxLeft + boxWidth / 2;
      const boxCenterY = boxTop + boxHeight / 2;
      const centerElements = document.elementsFromPoint(boxCenterX, boxCenterY);
      const validElements = centerElements.filter(
        (el) => !el.id.startsWith("web-augmenter-")
      );
      if (validElements.length === 0) return null;
      let bestElement = null;
      let bestScore = Infinity;
      for (const element of validElements) {
        const rect = element.getBoundingClientRect();
        const overlapLeft = Math.max(boxLeft, rect.left);
        const overlapTop = Math.max(boxTop, rect.top);
        const overlapRight = Math.min(boxRight, rect.right);
        const overlapBottom = Math.min(boxBottom, rect.bottom);
        const overlapWidth = Math.max(0, overlapRight - overlapLeft);
        const overlapHeight = Math.max(0, overlapBottom - overlapTop);
        const overlapArea = overlapWidth * overlapHeight;
        const elementArea = rect.width * rect.height;
        const boxArea = boxWidth * boxHeight;
        const overlapRatio = overlapArea / Math.min(elementArea, boxArea);
        const sizeDiff = Math.abs(elementArea - boxArea) / boxArea;
        const score = 1 - overlapRatio + sizeDiff;
        if (score < bestScore && overlapRatio > 0.3) {
          bestScore = score;
          bestElement = element;
        }
      }
      return bestElement;
    }
    selectElementForAugmentation(element, selectionText) {
      const elementId = `element_${Date.now()}`;
      const elementInfo = this.extractElementInfo(element, selectionText);
      this.savedElements.set(elementId, elementInfo);
      this.highlightElement(element, false);
      this.showElementDialog(elementId, elementInfo);
    }
    getTargetElement() {
      if (this.selectedElement) {
        return this.selectedElement;
      }
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        return container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
      }
      return null;
    }
    extractElementInfo(element, selectionText) {
      const rect = element.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(element);
      return {
        tagName: element.tagName.toLowerCase(),
        id: element.id || void 0,
        className: element.className || void 0,
        innerText: selectionText || element.textContent?.substring(0, 200) || "",
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
    generateSelector(element) {
      if (element.id) {
        return `#${element.id}`;
      }
      const path = [];
      let current = element;
      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        if (current.className) {
          const classes = current.className.split(" ").filter((c) => c.trim());
          if (classes.length > 0) {
            selector += "." + classes.join(".");
          }
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((s) => s.tagName === current.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }
        path.unshift(selector);
        current = current.parentElement;
      }
      return path.join(" > ");
    }
    getElementAttributes(element) {
      const attrs = {};
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        attrs[attr.name] = attr.value;
      }
      return attrs;
    }
    highlightElement(element, isHover = false) {
      if (this.highlightOverlay) {
        this.highlightOverlay.remove();
      }
      const rect = element.getBoundingClientRect();
      const overlay = document.createElement("div");
      overlay.id = "web-augmenter-highlight";
      const color = isHover ? "#ff9800" : "#007cba";
      const bgOpacity = isHover ? "0.05" : "0.1";
      overlay.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 3px solid ${color};
      background: rgba(${isHover ? "255, 152, 0" : "0, 124, 186"}, ${bgOpacity});
      pointer-events: none;
      z-index: 999999;
      box-shadow: 0 0 10px rgba(${isHover ? "255, 152, 0" : "0, 124, 186"}, 0.5);
      transition: all 0.1s ease;
    `;
      const label = document.createElement("div");
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
      label.textContent = `${element.tagName.toLowerCase()}${element.id ? "#" + element.id : ""}${element.className ? "." + element.className.split(" ")[0] : ""}`;
      overlay.appendChild(label);
      document.body.appendChild(overlay);
      this.highlightOverlay = overlay;
      if (!isHover) {
        setTimeout(() => {
          if (this.highlightOverlay === overlay) {
            overlay.remove();
            this.highlightOverlay = null;
          }
        }, 5e3);
      }
    }
    showElementDialog(elementId, elementInfo) {
      const dialog = document.createElement("div");
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
      <h3 style="margin: 0 0 20px 0; color: #333; text-align: center;">\u2728 What would you like to do?</h3>
      <textarea 
        id="augmenter-instruction" 
        placeholder="Describe what you want to change...

Examples:
\u2022 Change the color to blue
\u2022 Hide this element
\u2022 Make the text bigger
\u2022 Add a border
\u2022 Change the background" 
        style="width: 100%; height: 120px; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-size: 14px; resize: vertical; box-sizing: border-box; font-family: Arial, sans-serif;"
      ></textarea>
      <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: flex-end;">
        <button id="augmenter-cancel" style="padding: 10px 20px; background: #f0f0f0; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;">Cancel</button>
        <button id="augmenter-submit" style="padding: 10px 20px; background: #007cba; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;">\u2728 Augment</button>
      </div>
    `;
      document.body.appendChild(dialog);
      const textarea = dialog.querySelector("#augmenter-instruction");
      textarea?.focus();
      dialog.querySelector("#augmenter-cancel")?.addEventListener("click", () => {
        dialog.remove();
        if (this.highlightOverlay) {
          this.highlightOverlay.remove();
          this.highlightOverlay = null;
        }
      });
      dialog.querySelector("#augmenter-submit")?.addEventListener("click", async () => {
        const instruction = textarea.value.trim();
        if (!instruction) {
          this.showNotification("Please enter an instruction", "error");
          return;
        }
        dialog.remove();
        await this.augmentElement(elementId, instruction);
      });
    }
    async augmentElement(elementId, instruction) {
      try {
        const elementInfo = this.savedElements.get(elementId);
        if (!elementInfo) {
          throw new Error("Element not found");
        }
        this.showNotification("Processing your request...", "info");
        const detailedInstruction = `
Modify the following element:
- Selector: ${elementInfo.selector}
- Tag: ${elementInfo.tagName}
- Current text: ${elementInfo.innerText}

User instruction: ${instruction}

Please generate CSS and/or JavaScript to ${instruction}. Target the element using the selector: ${elementInfo.selector}`;
        await this.handleExecuteInstruction(detailedInstruction, false);
        if (this.highlightOverlay) {
          this.highlightOverlay.remove();
          this.highlightOverlay = null;
        }
      } catch (error) {
        console.error("Web Augmenter: Failed to augment element:", error);
        this.showNotification("Failed to augment element", "error");
      }
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
    setupElementTracking() {
      document.addEventListener("contextmenu", (event) => {
        const target = event.target;
        if (target && target.nodeType === Node.ELEMENT_NODE) {
          this.selectedElement = target;
          setTimeout(() => {
            this.selectedElement = null;
          }, 2e3);
        }
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
    async handleExecuteTool(toolName, toolInput) {
      try {
        console.log(`Web Augmenter: Executing tool: ${toolName}`, toolInput);
        const result = await toolExecutor.executeTool(toolName, toolInput);
        return {
          type: MESSAGE_TYPES.TOOL_RESULT,
          result
        };
      } catch (error) {
        console.error("Web Augmenter: Tool execution error:", error);
        return {
          type: MESSAGE_TYPES.TOOL_RESULT,
          result: JSON.stringify({ error: `Tool execution failed: ${error}` })
        };
      }
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
