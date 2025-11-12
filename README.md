# 🪄 Web Augmenter

**Turn any website into a programmable surface using natural language.**

Web Augmenter is a powerful Chrome extension that lets you modify any website using simple natural language instructions. Instead of writing code, just describe what you want and let AI generate the changes for you.

![Web Augmenter Demo](docs/demo.gif)

## ✨ Features

- **Natural Language Interface**: Describe changes in plain English
- **Custom Features**: Save and reuse your modifications across sites
- **Auto-Apply**: Automatically apply saved features when visiting sites
- **Screenshot Context**: Optional visual context for better AI understanding
- **Local Persistence**: Your features and settings stay private on your device
- **Universal Compatibility**: Works on any website using semantic detection

## 🚀 Quick Start

### Installation

1. **Clone or Download** this repository
2. **Build the extension**:
   ```bash
   cd web-augmenter
   npm install
   npm run build
   ```
3. **Load in Chrome**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked" and select the `dist` folder

### First Use

1. **Click the Web Augmenter icon** in your Chrome toolbar
2. **Enter an instruction** like:
   - `"Hide the sidebar and focus on main content"`
   - `"Add a dark mode toggle to this site"`
   - `"Pin the video player in the bottom corner"`
3. **Click "Apply Changes"** and watch the magic happen!

## 🎯 Example Instructions

### Content Filtering
- "On Instagram, show only posts and hide everything else"
- "Hide all promotional content and ads"
- "Focus on the main article and hide distractions"

### UI Enhancements
- "Add a dark mode toggle to this site"
- "Create a floating notes panel on the right side"
- "Make the video player sticky when scrolling"

### Reading & Productivity
- "Create a reading mode with larger text"
- "Add a progress bar for article reading"
- "Highlight important text automatically"

### Custom Workflows
- "Create a minimal Twitter interface"
- "Add keyboard shortcuts for common actions"
- "Organize content into a grid layout"

## ⚙️ Configuration

### Anthropic API Setup

Web Augmenter uses **Anthropic's Claude AI** via the official Anthropic SDK:

1. **Get an API Key**:
   - Visit [console.anthropic.com](https://console.anthropic.com/)
   - Create an account or sign in
   - Generate a new API key

2. **Configure the Extension**:
   - Open the Web Augmenter popup
   - Click **Settings** (expand the settings section)
   - Enter your **Anthropic API Key** (starts with `sk-ant-...`)
   - Click **"Save Settings"**

#### Supported Models

The extension automatically uses the latest Claude models:
- **Claude 3.5 Sonnet** (default) - Best for complex reasoning and code
- **Claude 3 Haiku** - Faster responses for simple tasks
- **Claude 3 Opus** - Highest capability for demanding tasks

#### Pricing & Usage

- **Free Tier**: Anthropic provides credits for new users
- **Pay-as-you-go**: Transparent pricing per token
- **Local Processing**: Only sends DOM structure and instructions (no personal data)

> **Note**: Without an API key, the extension provides demo functionality with mock responses.

### Screenshot Context

- **Enable/Disable**: Toggle "Include screenshot context" in the popup
- **Default Setting**: Configure in Settings → "Include screenshot by default"
- **Benefits**: Provides visual context to help AI understand page layout
- **Privacy**: Screenshots are sent only to your configured API, never stored

## 💾 Custom Features

### Creating Custom Features

1. **Enter an instruction** and enable "Save as custom feature"
2. **Apply the changes** successfully
3. **Configure the feature**:
   - **Name**: e.g., "Reading Mode"
   - **Scope**: Choose where to apply:
     - **This site only**: `example.com`
     - **All subdomains**: `*.example.com`
     - **All sites**: Global application
     - **Custom pattern**: Regex URL matching
   - **Description**: Optional notes about the feature

### Managing Custom Features

- **View Features**: See all saved features in the popup
- **Apply Manually**: Click "Apply Now" on any feature
- **Auto-Apply**: Toggle automatic application per site
- **Delete**: Remove unwanted features
- **Export/Import**: Backup and share your feature library

### Auto-Apply Behavior

- Features with **auto-apply enabled** run automatically when you visit matching sites
- **Per-site control**: Enable/disable Web Augmenter entirely for specific sites
- **Smart reapplication**: Features reapply when dynamic content loads

## 🛠️ Development

### Project Structure

```
web-augmenter/
├── src/
│   ├── background/          # Service worker
│   │   └── serviceWorker.ts
│   ├── content/            # Content scripts
│   │   ├── contentScript.ts
│   │   └── injectPatches.ts
│   ├── popup/              # Extension popup UI
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.ts
│   └── shared/             # Shared utilities
│       ├── types.ts
│       ├── constants.ts
│       ├── persistence.ts
│       ├── llmClient.ts
│       ├── domSnapshot.ts
│       └── screenshot.ts
├── dist/                   # Compiled extension
├── manifest.json           # Extension manifest
├── tsconfig.json          # TypeScript config
├── package.json           # Build configuration
└── build.js              # Build utilities
```

### Building

```bash
# Install dependencies
npm install

# Build for development
npm run build

# Build and watch for changes
npm run dev

# Build production package
npm run package
```

### Architecture

1. **Popup UI** → **Content Script** → **Background Service Worker** → **LLM API**
2. **LLM Response** → **Background** → **Content Script** → **Inject Patches**

#### Key Components

- **DOM Snapshot**: Extracts semantic structure from any webpage
- **LLM Client**: Integrates with Anthropic's Claude via official SDK
- **Patch Injector**: Safely executes generated CSS/JavaScript
- **Persistence Manager**: Handles local storage of features and settings
- **Screenshot Capture**: Optional visual context for AI with multi-modal support

### Extension Permissions

- **`activeTab`**: Access current tab for DOM analysis and injection
- **`tabs`**: Screenshot capture and tab management
- **`storage`**: Local persistence of features and settings
- **`scripting`**: Dynamic script injection
- **`contextMenus`**: Right-click integration
- **`<all_urls>`**: Universal website compatibility

## 🔒 Privacy & Security

### Data Handling

- **Local Storage**: All features and settings stored locally in your browser
- **No Tracking**: Extension doesn't track usage or collect personal data
- **API Communication**: Only sends page structure and instructions to your configured LLM API
- **Screenshot Privacy**: Screenshots sent only to your API, never stored

### Security Features

- **Sandboxed Execution**: Generated scripts run in isolated page context
- **Input Validation**: All LLM responses validated before execution
- **No External Dependencies**: Extension works offline (except LLM calls)
- **Safe Injection**: CSS/JS injection uses secure methods

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature-name`
3. **Commit** your changes: `git commit -m 'Add feature'`
4. **Push** to the branch: `git push origin feature-name`
5. **Submit** a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Maintain backward compatibility
- Test on multiple websites
- Document new features
- Keep security in mind

## 📋 Roadmap

- [ ] **Sharing Features**: Import/export feature libraries
- [ ] **Visual Editor**: GUI for creating simple modifications
- [ ] **Template Library**: Pre-built features for common use cases
- [ ] **Batch Operations**: Apply multiple features simultaneously
- [ ] **Performance Monitoring**: Track feature impact
- [ ] **Cloud Sync**: Optional cloud storage for features

## 🐛 Troubleshooting

### Common Issues

**Extension not working on certain sites**
- Some sites (chrome://, file://) are restricted by browser security
- Try refreshing the page after installation

**API calls failing**
- Verify your API key and endpoint in Settings
- Check browser network tab for error details
- Ensure API provider supports the required format

**Features not auto-applying**
- Check that auto-apply is enabled for the specific feature
- Verify the site isn't disabled for Web Augmenter
- Look for JavaScript errors in browser console

**Screenshot capture failing**
- Requires `activeTab` permission
- May not work on restricted pages (chrome://, extensions://)
- Try disabling "Include screenshot context" as workaround

### Debug Mode

Enable Chrome DevTools for debugging:
1. Right-click the extension icon → "Inspect popup"
2. Check Console for error messages
3. Monitor Network tab for API calls

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/web-augmenter/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/web-augmenter/discussions)
- **Email**: support@your-domain.com

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Anthropic** for Claude AI and the excellent official SDK
- **Chrome Extensions API** for the powerful platform
- **TypeScript** for type safety and development experience
- **Open source community** for inspiration and tools

---

**Made with ❤️ for the web customization community**

*Transform any website into exactly what you need with the power of natural language.*