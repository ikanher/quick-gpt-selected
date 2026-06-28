# Quick GPT Selected (Text)

Simple Firefox plugin that does Quick GPT query of selected text in the browser with options to configure custom prompts.

## Usage

Select text in a page, right-click, and choose a prompt from the Quick GPT Selected menu.  The response streams inline near your selection. Click "More" in the inline card to open a popup with a detailed response.

## Screenshots

<table width="100%">
  <tr>
    <td width="33%">
      <strong>Context menu</strong><br>
      <img src="images/context-menu.png" width="100%" alt="Context menu">
    </td>
    <td width="33%">
      <strong>Short answer (inline)</strong><br>
      <img src="images/short-answer.png" width="100%" alt="Short answer">
    </td>
    <td width="33%">
      <strong>Long answer (popup)</strong><br>
      <img src="images/long-answer.png" width="100%" alt="Long answer">
    </td>
  </tr>
</table>

## Installation

### Firefox Add-ons (recommended)

Install the official add-on from Mozilla:
https://addons.mozilla.org/addon/quick-gpt-selected/

### Manual install (legacy / testing)

Download the latest XPI from GitHub Releases:
- [quick_gqt_selected.xpi](https://github.com/ikanher/quick-gpt-selected/releases/latest/download/quick_gqt_selected.xpi)

Go to 'about:addons' in Firefox. Click the settings wheel. Choose 'Install Add-on From File'. Navigate to the XPI and click 'Open'.

Legacy build:
- The legacy XPI is for older Firefox versions that do not support the latest manifest fields.
- If you need Firefox 134 or earlier, download:
  - [quick_gqt_selected-legacy.xpi](https://github.com/ikanher/quick-gpt-selected/releases/latest/download/quick_gqt_selected-legacy.xpi)

### Release checklist

1. Build the AMO (modern) package:
   - `make xpi`
2. Build the legacy package:
   - `make legacy-xpi`
3. Upload:
   - AMO: upload `dist/quick_gqt_selected.xpi`
   - GitHub Releases: attach both `dist/quick_gqt_selected.xpi` and `dist/quick_gqt_selected-legacy.xpi`

### AMO source build instructions

The extension's own source files are plain JavaScript, HTML, and CSS. They are
not transpiled, concatenated, or minified. The only generated third-party code
included in the extension is the official KaTeX browser bundle, stylesheet, and
fonts under `src/vendor/katex/`, copied from the pinned npm dependency
`katex@0.17.0`.

Build environment used for the submitted package:

- Linux
- Node.js v20.16.0
- npm 9.2.0
- GNU Make 4.3
- rsync 3.3.0
- Info-ZIP `zip`
- jq 1.7, only needed for `make legacy-xpi`

Install the required tools with your operating system package manager, and
install Node.js/npm from https://nodejs.org/ or your operating system package
manager. Then run:

```sh
npm install
make xpi
```

This creates the AMO package at:

```text
dist/quick_gqt_selected.xpi
```

For the optional legacy package, run:

```sh
make legacy-xpi
```

The build script is `Makefile`. It performs these steps:

1. Copies `katex@0.17.0`'s `katex.min.js`, `katex.min.css`, `fonts/`,
   `LICENSE`, and `package.json` from `node_modules/katex/` into
   `src/vendor/katex/`.
2. Copies the extension source from `src/` into a temporary `build/` directory,
   excluding editor backup files.
3. Zips the temporary build directory into `dist/quick_gqt_selected.xpi`.

## Configuration

**OpenAI (ChatGPT) API key needed**: Open the add-on settings and add your OpenAI key.

You can also configure your own prompts, as seen below.

<p>
  <img src="images/options.png" width="80%" alt="Options page">
</p>

## License

MIT
