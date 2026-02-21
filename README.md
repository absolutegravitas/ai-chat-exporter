# AI Chat Exporter

Export your Gemini and ChatGPT conversations to perfectly formatted Markdown files with complete preservation of LaTeX math, code blocks, tables, and all formatting. Version 4.0.3 adds attachment support—export uploaded images and files alongside your chats in a single ZIP file.

## Features

- **Attachment Support (v4.0.3+)**: Export uploaded images and files with your chat conversations
- **ZIP Export**: Everything consolidated into a single ZIP file (markdown + attachments/ folder)
- **Single-Click Export**: No dropdown/preference popup - just click and export immediately
- **Multi-Chat Selection**: Sidebar checkboxes to select multiple chats for batch export
- **DOM-based extraction for Gemini**: Direct HTML parsing without clipboard dependency using Turndown library
- Export your full Gemini or ChatGPT chat conversation to Markdown, preserving formatting (code, tables, LaTeX, etc.)
- Dedicated "Export Chat" button appears automatically on every Gemini and ChatGPT chat page
- Option to hide the export button via the extension popup
- **Granular message selection**: Use checkboxes next to each message to select exactly what to export
- **Selection presets**: Instantly select all, none, or only AI responses with a dropdown
- **Export to clipboard or file**: Copy your chat as Markdown directly to your clipboard—no file download needed, or save as .md file
- **Custom filename (optional)**: Enter a filename, or leave blank to use the chat title or a timestamp
- **Automatic lazy-loading**: Scrolls to load all messages in long conversations before export
- **Citation removal**: Automatically strips Gemini citation markers from exported content
- **Math formula support**: Preserves LaTeX equations from Gemini's `data-math` attributes
- Dark mode support: Export controls display correctly in both light and dark themes
- No build step required
- Open source under the Apache License 2.0

## Installation

1. **Download the latest release**
   - Go to the [Releases](https://github.com/absolutegravitas/ai-chat-exporter/releases) page
   - Download the `ai-chat-exporter.zip` file from the latest release
   - Unzip the file to a folder on your computer

2. **Load the extension in Chrome**
   - Open `chrome://extensions` in your Chrome browser
   - Enable "Developer mode" (toggle in the top right)
   - Click "Load unpacked" and select the folder where you unzipped the extension files

3. **You're done!**
   - The "Export Chat" button will now appear on every Gemini and ChatGPT chat page

Support for other LLMs like DeepSeek, Claude, and Grok will be added in future updates.

## What's New in v4.0.3

### 🎉 Attachment Support & ZIP Export
- **ZIP Export**: Everything packaged into a single ZIP file for easy download
- **Attachments Folder**: Images and files saved to `attachments/` subfolder within the ZIP
- **Single-Click Export**: Simplified flow - just click the button to export (no popup)
- **Sidebar Checkboxes**: Select multiple chats from the sidebar for batch export
- **Debug Logging**: Console logs to help troubleshoot attachment detection

## Usage

### Gemini
1. Go to [Gemini](https://gemini.google.com/) and open any chat conversation.
2. *(Optional)* Use sidebar checkboxes to select multiple chats for batch export.
3. Click the **Export Chat** button at the top right of the page.
4. The extension will automatically:
   - Scroll to load all messages in the conversation (including lazy-loaded older messages)
   - Extract content directly from the DOM (no clipboard needed!)
   - Convert formatting, tables, code blocks, and math formulas to Markdown
   - Remove Gemini citation markers like `[cite_start]` and `[cite:1,2,3]`
   - Fetch uploaded images and files as attachments
   - Create a ZIP file with markdown + attachments folder
5. Your exported file will be named: `<conversation_title>_YYYY-MM-DD_HHMMSS.zip`
6. Extract the ZIP to find:
   - `<conversation_title>.md` - The markdown export
   - `attachments/` - Any uploaded images or files

**Supported formatting:**
- ✅ Text formatting (bold, italics, inline code)
- ✅ Headings (H1-H6)
- ✅ Code blocks with syntax highlighting markers
- ✅ Tables (converted to Markdown tables)
- ✅ Lists (ordered and unordered)
- ✅ Blockquotes
- ✅ Horizontal rules
- ✅ Math formulas (LaTeX from `data-math` attributes)
- ✅ Line breaks
- ✅ **Uploaded images** (saved to attachments/ folder in ZIP)
- ✅ **Uploaded files** (PDF, DOC, XLS, etc. → saved to attachments/ folder)

**Not supported:**
- ❌ Canvas/drawing responses
- ❌ Gemini-generated images (only user-uploaded images are supported)

### ChatGPT
1. Go to [ChatGPT](https://chatgpt.com/) and open any chat conversation.
2. Click the **Export Chat** button at the top right of the page.
3. Use the checkboxes and selection dropdown to choose which messages to export, just like in Gemini.
4. **(Optional)** Enter a custom filename, or leave blank to use the chat title or timestamp.
5. Choose your export mode:
   - **Export as file** (default): Downloads a Markdown (.md) file
   - **Export to clipboard**: Copies the conversation to your clipboard
6. Click **Export Chat** again to start. The button will show "Exporting..." during the process.
7. The extension will:
   - Automatically scroll to load all messages in the conversation
   - Use ChatGPT's built-in copy button to extract formatted content
   - Compile all selected messages into Markdown format
8. Your exported file will be named: `<chat_title>_YYYY-MM-DD_HHMMSS.md` (e.g., `My_Chat_Title_2026-01-18_153012.md`)

**Note:** ChatGPT export uses clipboard-based extraction via the platform's native copy button to ensure perfect formatting preservation.

## Support This Project

This extension is free and open source. If you find it useful, please consider supporting ongoing development!

### Donation Options
- **[Donate via Stripe](https://buy.stripe.com/placeholder_stripe)** — Specify your donation amount
- **[Donate via Airwallex](https://pay.airwallex.com/placeholder_airwallex)** — Specify your donation amount

Your support helps keep this project alive and enables new features!

## Permissions

This extension requires:
- **storage**: For extension settings
- **clipboardRead**: For ChatGPT exports (not needed for Gemini)
- **downloads**: For saving attachment files to your computer

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the [Apache License 2.0](LICENSE).

## Attribution

Extension icons are generated using Gemini AI.