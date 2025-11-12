export interface ScreenshotOptions {
  format?: 'png' | 'jpeg';
  quality?: number; // 0-100, only for jpeg
}

export class ScreenshotCapture {
  async captureCurrentTab(options: ScreenshotOptions = {}): Promise<string | null> {
    try {
      // Get the current active tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tabs.length === 0) {
        console.warn('No active tab found');
        return null;
      }

      const tab = tabs[0];

      if (!tab.id) {
        console.warn('Active tab has no ID');
        return null;
      }

      // Capture the visible area of the tab
      const captureOptions: chrome.tabs.CaptureVisibleTabOptions = {
        format: options.format || 'png'
      };

      if (options.format === 'jpeg' && options.quality) {
        captureOptions.quality = Math.max(0, Math.min(100, options.quality));
      }

      const dataUrl = await chrome.tabs.captureVisibleTab(captureOptions);

      return dataUrl;

    } catch (error) {
      console.error('Failed to capture screenshot:', error);

      // Check for specific error types and provide helpful messages
      if (error instanceof Error) {
        if (error.message.includes('activeTab')) {
          console.warn('Screenshot failed: activeTab permission required');
        } else if (error.message.includes('Cannot capture')) {
          console.warn('Screenshot failed: Cannot capture this type of tab (chrome://, etc.)');
        }
      }

      return null;
    }
  }

  async captureWithRetry(
    options: ScreenshotOptions = {},
    maxRetries: number = 2,
    delay: number = 100
  ): Promise<string | null> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await this.captureCurrentTab(options);
        if (result) {
          return result;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt <= maxRetries) {
          // Wait before retry
          await this.sleep(delay * attempt);
        }
      }
    }

    console.warn('Screenshot capture failed after retries:', lastError);
    return null;
  }

  isScreenshotSupported(): boolean {
    return typeof chrome !== 'undefined' &&
           typeof chrome.tabs !== 'undefined' &&
           typeof chrome.tabs.captureVisibleTab === 'function';
  }

  async checkPermissions(): Promise<boolean> {
    try {
      const permissions = await chrome.permissions.getAll();
      return permissions.permissions?.includes('activeTab') ||
             permissions.permissions?.includes('tabs') ||
             false;
    } catch (error) {
      console.warn('Could not check permissions:', error);
      return false;
    }
  }

  getScreenshotInfo(dataUrl: string): {
    format: string;
    size: number;
    isValid: boolean;
  } {
    const isValid = dataUrl.startsWith('data:image/');

    if (!isValid) {
      return { format: 'unknown', size: 0, isValid: false };
    }

    const format = dataUrl.substring(11, dataUrl.indexOf(';'));
    const base64Data = dataUrl.substring(dataUrl.indexOf(',') + 1);

    // Approximate size calculation (base64 is ~4/3 the size of binary)
    const size = Math.round((base64Data.length * 3) / 4);

    return { format, size, isValid: true };
  }

  compressScreenshot(dataUrl: string, quality: number = 80): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Set canvas dimensions to match image
        canvas.width = img.width;
        canvas.height = img.height;

        // Draw image to canvas
        ctx.drawImage(img, 0, 0);

        // Convert to compressed JPEG
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality / 100);
        resolve(compressedDataUrl);
      };

      img.onerror = () => {
        reject(new Error('Could not load image for compression'));
      };

      img.src = dataUrl;
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const screenshotCapture = new ScreenshotCapture();