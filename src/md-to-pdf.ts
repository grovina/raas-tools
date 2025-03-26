#!/usr/bin/env node

import { execSync } from 'child_process';
import { Command } from 'commander';
import fs from 'fs';
import MarkdownIt from 'markdown-it';
import os from 'os';
import path from 'path';
import puppeteer from 'puppeteer';

// Define types
interface ProgramOptions {
  output?: string;
}

// Convert markdown to PDF function
export async function convertMarkdownToPdf(
  inputFile: string, 
  outputFile?: string
): Promise<string> {
  const baseName = path.basename(inputFile, path.extname(inputFile));
  const outputDir = path.dirname(inputFile);
  
  // Use provided output file or generate one based on input file
  const finalOutputFile = outputFile || path.join(outputDir, `${baseName}.pdf`);

  // Check if mermaid-cli is installed
  try {
    execSync('mmdc --version', { stdio: 'ignore' });
  } catch (error) {
    console.error('Error: mermaid-cli is not installed.');
    console.error('Please install it using: npm install -g @mermaid-js/mermaid-cli');
    throw new Error('mermaid-cli not installed');
  }

  // Create temporary directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-to-pdf-'));

  // Read input file
  const content = fs.readFileSync(inputFile, 'utf8');

  // Extract and convert Mermaid diagrams
  const mermaidPattern = /```mermaid\n([\s\S]*?)\n```/g;
  let modifiedContent = content;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = mermaidPattern.exec(content)) !== null) {
    const diagram = match[1];
    const diagramFile = path.join(tempDir, `diagram_${idx}.mmd`);
    const outputImageFile = path.join(tempDir, `diagram_${idx}.png`);
    
    // Write diagram to temporary file
    fs.writeFileSync(diagramFile, diagram);
    
    // Convert diagram to PNG
    console.log(`Generating diagram ${idx + 1}...`);
    execSync(`mmdc -i "${diagramFile}" -o "${outputImageFile}"`, { stdio: 'inherit' });
    
    // Replace Mermaid code with image reference
    modifiedContent = modifiedContent.replace(
      match[0],
      `![Diagram ${idx}](${outputImageFile})`
    );
    
    idx++;
  }

  // Initialize markdown-it
  const md = new MarkdownIt({
    html: true,
    breaks: true,
    linkify: true,
    typographer: true
  });

  // Convert markdown to HTML
  const htmlContent = md.render(modifiedContent);

  // Create HTML file with styling
  const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Converted Document</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.4;
      max-width: 100%;
      margin: 0 auto;
      padding: 1em;
      font-size: 0.9rem;
    }
    h1 {
      font-size: 1.4rem;
      margin-top: 0.8em;
      margin-bottom: 0.6em;
    }
    h2 {
      font-size: 1.2rem;
      margin-top: 0.7em;
      margin-bottom: 0.5em;
    }
    p {
      margin: 0.5em 0;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    pre {
      background-color: #f6f8fa;
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.8rem;
    }
    code {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
      font-size: 0.8rem;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.6em 0;
      font-size: 0.85rem;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 4px 6px;
      text-align: left;
    }
    th {
      background-color: #f6f8fa;
    }
    @media print {
      body {
        padding: 0;
      }
      @page {
        margin: 1cm;
        size: A4;
      }
    }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>
`;

  // Save HTML to temporary file
  const htmlFile = path.join(tempDir, 'output.html');
  fs.writeFileSync(htmlFile, htmlTemplate, 'utf8');

  // Convert HTML to PDF using Puppeteer
  console.log('Converting to PDF...');
  
  try {
    const browser = await puppeteer.launch({
      headless: true
    });
    
    const page = await browser.newPage();
    await page.goto(`file://${htmlFile}`, {
      waitUntil: 'networkidle0'
    });
    
    await page.pdf({
      path: finalOutputFile,
      format: 'A4',
      margin: {
        top: '1cm',
        right: '1cm',
        bottom: '1cm',
        left: '1cm'
      },
      printBackground: true
    });
    
    await browser.close();
    
    console.log(`Successfully converted ${inputFile} to ${finalOutputFile}`);
    
    // Clean up temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Warning: Could not clean up temporary directory: ${tempDir}`);
    }
    
    return finalOutputFile;
  } catch (error) {
    console.error('Error converting file:', error);
    throw error;
  }
}

// Main execution when script is run directly
if (require.main === module) {
  // Parse command line arguments
  const program = new Command();
  program
    .name('md-to-pdf')
    .description('Convert Markdown files with Mermaid diagrams to PDF')
    .argument('<input>', 'Input Markdown file')
    .option('-o, --output <o>', 'Output PDF file')
    .parse(process.argv);

  const options = program.opts() as ProgramOptions;
  const inputFile = program.args[0];
  
  // Convert the file
  convertMarkdownToPdf(inputFile, options.output)
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
} 