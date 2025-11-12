export interface CustomFeature {
  id: string;
  name: string;
  scope: {
    type: "hostname" | "domain" | "urlPattern" | "global";
    value: string;
  };
  script: string;
  css: string;
  createdAt: number;
  updatedAt: number;
  autoApply?: boolean;
  description?: string;
  tags?: string[];
}

export interface WebFeatureResponse {
  high_level_goal: string;
  plan: string[];
  script: string;
  css: string;
  notes_for_extension: string;
}

export interface DOMSnapshot {
  url: string;
  hostname: string;
  title: string;
  elements: DOMElementInfo[];
}

export interface DOMElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  role?: string;
  ariaLabel?: string;
  innerText?: string;
  selector?: string;
}

export interface PageContext {
  domSummary: DOMSnapshot;
  url: string;
  hostname: string;
  userInstruction: string;
  screenshotBase64?: string;
}

export interface LLMRequest {
  systemPrompt: string;
  userInstruction: string;
  pageContext: PageContext;
  screenshotBase64?: string;
}

export interface SiteSettings {
  [hostname: string]: {
    disabledFeatures: boolean;
    autoApplyFeatures: string[];
    darkMode?: boolean;
  };
}

export interface MessageFromPopup {
  type: 'EXECUTE_INSTRUCTION';
  userInstruction: string;
  includeScreenshot: boolean;
}

export interface MessageFromContent {
  type: 'PAGE_CONTEXT_READY';
  pageContext: PageContext;
  includeScreenshot?: boolean;
}

export interface MessageFromBackground {
  type: 'FEATURE_RESPONSE' | 'ERROR';
  response?: WebFeatureResponse;
  error?: string;
}

export interface MessageToContent {
  type: 'INJECT_PATCHES';
  patches: {
    script: string;
    css: string;
    high_level_goal: string;
    plan: string[];
    notes_for_extension: string;
  };
}

export interface StorageData {
  customFeatures: { [id: string]: CustomFeature };
  siteSettings: SiteSettings;
  globalSettings: {
    includeScreenshotByDefault: boolean;
    apiKey?: string;
  };
}