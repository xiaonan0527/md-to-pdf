# md-to-pdf

Convert Markdown documents to beautiful PDFs with AI-generated cover images, Mermaid diagram rendering, and professional styling.

## Features

- 🎨 **AI Cover Generation** — Gemini Pro generates a themed cover image
- 📊 **Mermaid Diagrams** — flowchart, sequenceDiagram, classDiagram, etc.
- 📄 **Cover/Content Separation** — cover page has zero margin (full-bleed), content pages have proper header/footer
- 🎨 **Indigo-Purple Theme** — professional tech-style color palette
- 📑 **Header & Footer** — title, version, author, page numbers on every content page

## Installation

```bash
cd scripts
npm install
```

## Usage

```bash
# Basic
node scripts/convert.cjs --input doc.md --output doc.pdf --title "My Document"

# With author and AI cover
export GEMINI_API_KEY=your_key
node scripts/convert.cjs \
  --input doc.md \
  --output doc.pdf \
  --title "System Design" \
  --subtitle "Backend Architecture" \
  --author "Your Name" \
  --version "V2.0" \
  --confidential

# With existing cover image
node scripts/convert.cjs \
  --input doc.md \
  --output doc.pdf \
  --cover-image cover.png

# No cover
node scripts/convert.cjs --input doc.md --output doc.pdf --no-cover
```

## Parameters

| Flag | Description | Default |
|------|-------------|---------|
| `--input` / `-i` | Input Markdown file (required) | — |
| `--output` / `-o` | Output PDF path (required) | — |
| `--title` | Document title | First H1 in MD |
| `--subtitle` | Subtitle (cover page) | — |
| `--author` | Author name (footer) | — |
| `--version` | Version string | V1.0 |
| `--date` | Date string | Today |
| `--cover-image` | Path to existing cover image | — |
| `--cover-prompt` | Custom Gemini prompt for cover | Auto-generated |
| `--no-cover` | Skip cover page | false |
| `--confidential` | Show CONFIDENTIAL in footer | false |
| `--gemini-api-key` | Gemini API key | `$GEMINI_API_KEY` |
| `--gemini-proxy` | HTTP proxy for Gemini | `$GEMINI_PRO_PROXY` |

## Dependencies

- [puppeteer](https://pptr.dev/) — headless Chrome for HTML→PDF
- [marked](https://marked.js.org/) — Markdown parser
- [pdf-lib](https://pdf-lib.js.org/) — PDF merging
- [mermaid](https://mermaid.js.org/) — diagram rendering (optional, install separately)

For Mermaid support, install in the scripts directory:
```bash
cd scripts && npm install mermaid
```

## License

MIT
