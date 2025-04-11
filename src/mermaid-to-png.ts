#!/usr/bin/env node

import * as childProcess from 'child_process';
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Define types for our options
interface MermaidOptions {
  output?: string;
  extract: boolean;
  width: string;
  height: string;
  background: string;
  theme: string;
  keepTemp: boolean;
}

// Current directory
const __dirname = path.resolve();

// Parse command line arguments
const program = new Command();
program
  .name('mermaid-to-png')
  .description('Convert Mermaid diagrams to PNG images')
  .argument('<input>', 'Input Mermaid file or Markdown file containing Mermaid diagrams')
  .option('-o, --output <output>', 'Output PNG file or directory (for multiple diagrams)')
  .option('-e, --extract', 'Extract Mermaid diagrams from Markdown file', false)
  .option('-w, --width <width>', 'Width of the output image in pixels', '1200')
  .option('-h, --height <height>', 'Height of the output image in pixels (0 for auto)', 'auto')
  .option('-b, --background <color>', 'Background color of the diagram', 'white')
  .option('-t, --theme <theme>', 'Mermaid theme (default, forest, dark, neutral)', 'default')
  .option('-k, --keep-temp', 'Keep temporary files', false)
  .parse(process.argv);

const options = program.opts() as MermaidOptions;
const inputFile = program.args[0];

// Check if mermaid-cli is installed
try {
  childProcess.execSync('mmdc --version', { stdio: 'ignore' });
} catch (error) {
  console.error('Error: mermaid-cli is not installed.');
  console.error('Please install it using: npm install -g @mermaid-js/mermaid-cli');
  process.exit(1);
}

// Create temporary directory if needed
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mermaid-to-png-'));

// Process a single Mermaid diagram file
function processMermaidFile(mermaidFile: string, outputFile: string): boolean {
  console.log(`Converting ${mermaidFile} to ${outputFile}...`);
  
  const configFile = path.join(tempDir, 'mermaid-config.json');
  
  // Create mermaid configuration
  const config = {
    theme: options.theme,
    backgroundColor: options.background
  };
  
  fs.writeFileSync(configFile, JSON.stringify(config), 'utf8');
  
  // Build the command with all options
  const commandParts = [
    'mmdc',
    `-i "${mermaidFile}"`,
    `-o "${outputFile}"`,
    `-c "${configFile}"`,
    `-w ${options.width}`
  ];
  
  // Only add height if it's not 'auto'
  if (options.height !== 'auto') {
    commandParts.push(`-H ${options.height}`);
  }
  
  const command = commandParts.join(' ');
  
  try {
    childProcess.execSync(command, { stdio: 'inherit' });
    console.log(`Successfully generated ${outputFile}`);
    return true;
  } catch (error) {
    const err = error as Error;
    console.error(`Error generating diagram: ${err.message}`);
    return false;
  }
}

// Extract Mermaid diagrams from Markdown
function extractMermaidFromMarkdown(markdownFile: string): string[] {
  console.log(`Extracting Mermaid diagrams from ${markdownFile}...`);
  
  const content = fs.readFileSync(markdownFile, 'utf8');
  const mermaidPattern = /```mermaid\n([\s\S]*?)\n```/g;
  const diagrams: string[] = [];
  let match;
  
  while ((match = mermaidPattern.exec(content)) !== null) {
    diagrams.push(match[1]);
  }
  
  if (diagrams.length === 0) {
    console.error('No Mermaid diagrams found in the Markdown file.');
    process.exit(1);
  }
  
  console.log(`Found ${diagrams.length} Mermaid diagram(s).`);
  return diagrams;
}

// Main execution
try {
  // Check if input file exists
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file '${inputFile}' does not exist.`);
    process.exit(1);
  }
  
  // Determine if we're extracting from Markdown or processing a Mermaid file directly
  if (options.extract || inputFile.endsWith('.md')) {
    const diagrams = extractMermaidFromMarkdown(inputFile);
    
    // Determine output directory
    let outputDir = options.output;
    if (!outputDir) {
      // Use output/ directory as default
      outputDir = 'output/';
      // Create output directory if it doesn't exist
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
    } else if (!fs.existsSync(outputDir)) {
      // Create output directory if it doesn't exist
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Process each diagram
    let successCount = 0;
    for (let i = 0; i < diagrams.length; i++) {
      const diagram = diagrams[i];
      const diagramFile = path.join(tempDir, `diagram_${i}.mmd`);
      
      // Generate output filename
      const baseName = path.basename(inputFile, path.extname(inputFile));
      const outputFile = path.join(outputDir, `${baseName}_diagram_${i + 1}.png`);
      
      // Write diagram to temporary file
      fs.writeFileSync(diagramFile, diagram);
      
      // Convert to PNG
      if (processMermaidFile(diagramFile, outputFile)) {
        successCount++;
      }
    }
    
    console.log(`Conversion complete. Successfully converted ${successCount} of ${diagrams.length} diagrams.`);
  } else {
    // Process a single Mermaid file
    const outputDir = options.output || 'output/';
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const baseName = path.basename(inputFile, path.extname(inputFile));
    const outputFile = path.join(outputDir, `${baseName}.png`);
    
    processMermaidFile(inputFile, outputFile);
  }
} catch (error) {
  const err = error as Error;
  console.error(`Error: ${err.message}`);
  process.exit(1);
} finally {
  // Clean up temporary directory
  if (!options.keepTemp) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Warning: Could not clean up temporary directory: ${tempDir}`);
    }
  }
} 