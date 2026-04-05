import { CustomFeature, SiteSettings, StorageData } from './types.js';
import { STORAGE_KEYS, FEATURE_SCOPE_TYPES } from './constants.js';

class PersistenceManager {
  async getStorageData(): Promise<StorageData> {
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

  async saveCustomFeature(feature: CustomFeature): Promise<void> {
    const data = await this.getStorageData();
    data.customFeatures[feature.id] = feature;

    await chrome.storage.local.set({
      [STORAGE_KEYS.CUSTOM_FEATURES]: data.customFeatures
    });
  }

  async updateCustomFeature(featureId: string, updates: Partial<CustomFeature>): Promise<void> {
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

  async deleteCustomFeature(featureId: string): Promise<void> {
    const data = await this.getStorageData();
    delete data.customFeatures[featureId];

    await chrome.storage.local.set({
      [STORAGE_KEYS.CUSTOM_FEATURES]: data.customFeatures
    });

    // Also remove from auto-apply in all sites
    const siteSettings = data.siteSettings;
    for (const hostname in siteSettings) {
      siteSettings[hostname].autoApplyFeatures =
        siteSettings[hostname].autoApplyFeatures.filter(id => id !== featureId);
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.SITE_SETTINGS]: siteSettings
    });
  }

  async getFeaturesForSite(url: string): Promise<CustomFeature[]> {
    const hostname = new URL(url).hostname;
    const domain = this.extractDomain(hostname);
    const data = await this.getStorageData();

    const allFeatures = Object.values(data.customFeatures);
    const siteSettings = data.siteSettings[hostname];

    if (siteSettings?.disabledFeatures) {
      return [];
    }

    return allFeatures.filter(feature => {
      // Explicitly disabled features never apply
      if (feature.autoApply === false) {
        return false;
      }
      // Features not globally enabled must be in the site's allow-list
      if (!feature.autoApply && !siteSettings?.autoApplyFeatures?.includes(feature.id)) {
        return false;
      }

      // Check scope matching
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

  async setAutoApply(featureId: string, hostname: string, enabled: boolean): Promise<void> {
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

  async setSiteDisabled(hostname: string, disabled: boolean): Promise<void> {
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

  async isSiteDisabled(hostname: string): Promise<boolean> {
    const data = await this.getStorageData();
    return data.siteSettings[hostname]?.disabledFeatures || false;
  }

  async getAllCustomFeatures(): Promise<CustomFeature[]> {
    const data = await this.getStorageData();
    return Object.values(data.customFeatures);
  }

  async updateGlobalSettings(settings: Partial<StorageData['globalSettings']>): Promise<void> {
    const data = await this.getStorageData();

    data.globalSettings = {
      ...data.globalSettings,
      ...settings
    };

    await chrome.storage.local.set({
      [STORAGE_KEYS.GLOBAL_SETTINGS]: data.globalSettings
    });
  }

  generateFeatureId(): string {
    return `feature_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private extractDomain(hostname: string): string {
    const parts = hostname.split('.');
    if (parts.length <= 2) {
      return hostname;
    }
    return parts.slice(-2).join('.');
  }

  async exportData(): Promise<StorageData> {
    return this.getStorageData();
  }

  async importData(data: Partial<StorageData>): Promise<void> {
    const updates: any = {};

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
}

export const persistence = new PersistenceManager();