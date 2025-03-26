# Markdown to PDF Converter

This tool converts Markdown files with Mermaid diagrams to PDF documents.

## Prerequisites

1. Node.js and npm

## Installation

1. Install dependencies:

```bash
cd tools
npm install
```

2. Install Mermaid CLI globally:

```bash
npm install -g @mermaid-js/mermaid-cli
```

3. Make the script executable:

```bash
chmod +x md-to-pdf.js
```

## Usage

Convert a Markdown file to PDF:

```bash
./md-to-pdf.js input.md
```

Specify custom output file:

```bash
./md-to-pdf.js input.md -o output.pdf
```

## Features

- Converts Markdown to beautifully formatted PDF
- Renders Mermaid diagrams as images
- Supports tables, code blocks, and other Markdown features
- Clean, modern styling with system fonts
- Pure Node.js implementation for better reliability

## Example

To convert the system flows document:

```bash
./md-to-pdf.js ../clients/savoir/deliverables/2025-02-25-system-flows-fr.md
```
