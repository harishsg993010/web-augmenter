# 🪄 Web Augmenter

**Turn any website into a programmable surface using natural language.**

Web Augmenter is a powerful Chrome extension that lets you modify any website using simple natural language instructions. Instead of writing code, just describe what you want and let AI generate the changes for you.

![Web Augmenter Demo](docs/demo.gif)

## ✨ Features

- **Natural Language Interface**: Describe changes in plain English
- **AI UI Generation**: Draw anywhere on a page and generate fully functional UI components
- **Visual Editing Mode**: Drag-and-drop elements to reposition them visually
- **Custom Features**: Save and reuse your modifications across sites
- **Auto-Apply**: Automatically apply saved features when visiting sites
- **Screenshot Context**: Optional visual context for better AI understanding
- **Local Persistence**: Your features and settings stay private on your device
- **Universal Compatibility**: Works on any website using semantic detection
- **Browser API Integration**: Generated UIs can use clipboard, geolocation, notifications, and more
- **External API Support**: Create widgets that fetch real data from weather, news, crypto APIs

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

### Keyboard Shortcuts

- **`Ctrl+Shift+E`** (or `Cmd+Shift+E` on Mac) - Toggle Visual Editing Mode
- **`Ctrl+Shift+U`** (or `Cmd+Shift+U` on Mac) - Toggle UI Generation Mode
- **`Esc`** - Exit current mode

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

## 🎨 UI Generation Mode

**Generate fully functional UI components anywhere on any webpage!**

### How to Use

1. **Press `Ctrl+Shift+U`** (or `Cmd+Shift+U` on Mac) to activate UI Generation Mode
2. **Draw a rectangle** on the page where you want your UI to appear
3. **Describe what you want** in the dialog that appears
4. **AI generates it** - fully functional, with real logic and data persistence
5. **UI persists** across page reloads and is automatically saved

### What You Can Generate

#### Productivity Tools
- **"Create a pomodoro timer"** → Real countdown with notifications and localStorage
- **"Make a notes widget"** → Full note-taking with save/load/delete functionality
- **"Build a todo list"** → Complete CRUD operations with checkboxes and persistence
- **"Add a calculator"** → Fully functional calculator with keyboard support

#### Data Widgets
- **"Show Bitcoin price"** → Live crypto prices from CoinGecko API
- **"Weather widget for London"** → Real weather data from OpenWeatherMap
- **"Display latest tech news"** → Live news feed from NewsAPI
- **"Stock ticker for AAPL"** → Real-time stock prices with auto-refresh

#### Browser Tools
- **"Clipboard manager"** → Uses real Clipboard API to copy/paste
- **"Show my location"** → Uses Geolocation API to display coordinates
- **"Screenshot tool"** → Capture and download page screenshots
- **"Color picker"** → Extract colors from page elements

#### Custom Utilities
- **"Unit converter"** → Temperature, length, weight conversions
- **"Text formatter"** → Uppercase, lowercase, title case, etc.
- **"Countdown to New Year"** → Real-time countdown timer
- **"Random quote generator"** → Fetch quotes from API

### Key Features

✅ **100% Functional** - Every button, input, and feature works completely
✅ **Data Persistence** - Uses localStorage to save your data
✅ **Real APIs** - Fetches live data from external APIs when requested
✅ **Browser APIs** - Full access to Clipboard, Geolocation, Notifications, etc.
✅ **Draggable** - Move widgets anywhere on the page
✅ **Auto-saved** - Generated UIs persist across page reloads
✅ **Modern Design** - Beautiful gradients, shadows, and animations

### Visual Editing Mode

**Press `Ctrl+Shift+E`** to enter Visual Editing Mode:
- **Drag and drop** any element to reposition it
- **Hover** to see element outlines
- **Changes persist** automatically as custom features
- Works on both page elements and generated UIs

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

### ✅ Completed
- [x] **Visual Editor**: Drag-and-drop element positioning (`Ctrl+Shift+E`)
- [x] **UI Generation Mode**: AI-powered widget creation (`Ctrl+Shift+U`)
- [x] **Browser API Integration**: Clipboard, Geolocation, Notifications support
- [x] **External API Support**: Weather, crypto, news, and custom API integration
- [x] **Element Persistence**: Auto-save moved elements and generated UIs

### 🚧 In Progress
- [ ] **Template Library**: Pre-built UI components and features
- [ ] **Sharing Features**: Import/export feature libraries
- [ ] **UI Component Gallery**: Browse and install community widgets

### 🔮 Planned
- [ ] **Batch Operations**: Apply multiple features simultaneously
- [ ] **Performance Monitoring**: Track feature impact and optimization
- [ ] **Cloud Sync**: Optional cloud storage for features
- [ ] **Collaborative Features**: Share and remix community creations
- [ ] **Advanced Selectors**: Visual selector picker for complex targeting
- [ ] **Version Control**: Track changes and rollback features

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

**UI Generation not working**
- Ensure you have a valid Anthropic API key configured
- Check that you drew a rectangle large enough (minimum 50x50 pixels)
- Verify the extension has permissions for the current site
- Look for errors in the browser console (F12)

**Generated UI not functional**
- The AI should generate fully working code - if not, try being more specific
- Example: Instead of "timer", say "pomodoro timer that counts down from 25 minutes"
- Check browser console for JavaScript errors
- Try regenerating with more detailed instructions

**Generated UI disappeared**
- Check if it was saved as a custom feature (should auto-save)
- Verify the feature is enabled in the popup
- The UI might be off-screen - try Visual Editing Mode to move it

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

## 📖 Quick Reference

### Modes

| Mode | Shortcut | Purpose |
|------|----------|---------|
| **Normal Mode** | - | Use popup to modify page behavior |
| **Visual Editing** | `Ctrl+Shift+E` | Drag and drop elements to reposition |
| **UI Generation** | `Ctrl+Shift+U` | Draw and create custom UI widgets |

### UI Generation Examples

| What to Say | What You Get |
|-------------|--------------|
| "Create a pomodoro timer" | Fully functional 25-minute countdown timer with notifications |
| "Make a notes widget" | Note-taking app with save/load/delete using localStorage |
| "Show Bitcoin price" | Live BTC price from CoinGecko API with auto-refresh |
| "Weather for London" | Real weather data with temperature and conditions |
| "Clipboard manager" | Copy/paste tool using browser Clipboard API |
| "Build a calculator" | Working calculator with all operations |
| "Todo list" | Full CRUD todo app with checkboxes and persistence |

### Available Browser APIs

Generated UIs have full access to:
- **localStorage/sessionStorage** - Data persistence
- **Clipboard API** - Copy/paste functionality  
- **Geolocation API** - Location tracking
- **Notifications API** - Desktop notifications
- **Fetch API** - HTTP requests to any endpoint
- **File API** - File reading and handling
- **Date/Time** - Timers and scheduling

### Tips for Best Results

1. **Be specific**: "Pomodoro timer with 25-minute countdown" > "timer"
2. **Mention APIs**: "Weather widget using OpenWeatherMap" gets real data
3. **Specify behavior**: "Notes that auto-save to localStorage" ensures persistence
4. **Request features**: "Calculator with keyboard support" adds extra functionality
5. **Use Visual Mode**: After generating, press `Ctrl+Shift+E` to reposition

---

**Made with ❤️ for the web customization community**

*Transform any website into exactly what you need with the power of natural language.*