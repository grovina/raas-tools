#!/usr/bin/env ts-node

/**
 * Buchführung Generator
 * 
 * This script generates professional bookkeeping reports based on invoice JSON files
 * with currency conversion and invoice numbering for Swiss tax compliance
 * 
 * Usage: yarn buchfuehrung <year> [invoices-directory] [options]
 * 
 * Options:
 *   --lang=en|de       Generate report in English or German (default: both)
 *   --pdf              Automatically convert reports to PDF
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { convertCurrency, getOfficialExchangeRates } from './currency-converter';
import { generateInvoiceNumberFromFile } from './invoice-utils';
import { convertMarkdownToPdf } from './md-to-pdf';

// Promisify exec for easier async/await usage
const execPromise = promisify(exec);

// Default configuration
const DEFAULT_INVOICES_DIR = path.resolve(__dirname, '../../context/business/accounting/invoices');
const REPORTS_DIR = path.resolve(__dirname, '../../context/business/accounting/reports');

// Process command line arguments
function parseArguments() {
  const args = process.argv.slice(2); // Remove node and script path
  
  if (args.length === 0) {
    console.error('Please provide a year (YYYY) as the first argument');
    process.exit(1);
  }
  
  const year = args[0];
  
  if (!/^\d{4}$/.test(year)) {
    console.error('Year must be in YYYY format');
    process.exit(1);
  }
  
  // Get optional invoice directory
  let invoicesDir = DEFAULT_INVOICES_DIR;
  let language: 'en' | 'de' | 'both' = 'both'; // Default to generating both languages
  let generatePdf = false; // Default to not generating PDFs
  
  // Process remaining arguments
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--lang=de' || arg === '-l=de') {
      language = 'de';
    } else if (arg === '--lang=en' || arg === '-l=en') {
      language = 'en';
    } else if (arg === '--pdf' || arg === '-p') {
      generatePdf = true;
    } else if (!arg.startsWith('-')) {
      // If it doesn't start with a dash, treat as directory
      invoicesDir = path.resolve(arg);
    }
  }
  
  return { year, invoicesDir, language, generatePdf };
}

// Types
interface InvoiceItem {
  description: string;
  amount: number;
  [key: string]: any;
}

interface Creditor {
  name: string;
  uid: string;
  address: string;
  buildingNumber: string;
  zip: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  iban: string;
  swift: string;
  accountName: string;
}

interface Debtor {
  name: string;
  address: string;
  buildingNumber: string;
  zip: string;
  city: string;
  country: string;
}

interface InvoiceData {
  creditor: Creditor;
  debtor: Debtor;
  columns: string[];
  items: InvoiceItem[];
  language: "DE" | "EN" | "FR" | "IT";
  vatRate: number | null;
  currency: string;
  [key: string]: any;
}

interface ProcessedInvoice {
  client: string;
  month: string;
  fileName: string;
  date: Date;
  invoiceNumber: string;
  data: InvoiceData;
}

interface ClientSummary {
  totalBilled: number;
  totalBilledCHF: number;
  invoiceCount: number;
  currency: string;
}

interface MonthSummary {
  [month: string]: {
    total: number;
    totalCHF: number;
    byCurrency: Record<string, number>
  }
}

interface Report {
  year: string;
  generatedAt: string;
  exchangeRateDate: string;
  totalRevenue: Record<string, number>;
  totalRevenueCHF: number; // Total in CHF for tax reporting
  monthlyRevenue: MonthSummary;
  clientSummary: Record<string, ClientSummary>;
  invoices: Array<{
    client: string;
    month: string;
    date: string;
    invoiceNumber: string;
    amount: number;
    amountCHF: number; // Amount converted to CHF
    currency: string;
    items: number;
    fileName: string;
  }>;
}

// Main function
async function generateReport() {
  // Ensure the reports directory exists
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  // Get command line arguments
  const { year, invoicesDir, language, generatePdf } = parseArguments();

  // Validate invoices directory
  if (!fs.existsSync(invoicesDir)) {
    console.error(`Invoices directory not found: ${invoicesDir}`);
    process.exit(1);
  }

  console.log(`Generating Buchführung report for year ${year}...`);
  console.log(`Using invoices from: ${invoicesDir}`);

  // Get exchange rates for currency conversion
  console.log('Fetching official exchange rates...');
  let exchangeRates;
  
  try {
    exchangeRates = await getOfficialExchangeRates();
    console.log('Exchange rates successfully retrieved');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`Error: ${error.message}`);
    console.error('Cannot proceed without exchange rates for tax reporting');
    process.exit(1);
  }

  // Get all invoice files for the specified year
  const invoiceFiles = fs.readdirSync(invoicesDir)
    .filter(file => file.startsWith(`${year}-`) && file.endsWith('.json'));

  if (invoiceFiles.length === 0) {
    console.warn(`No invoices found for year ${year}`);
    process.exit(0);
  }

  console.log(`Found ${invoiceFiles.length} invoices for ${year}`);

  // Process invoices
  const invoices: ProcessedInvoice[] = invoiceFiles.map(file => {
    const filePath = path.join(invoicesDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as InvoiceData;
    
    // Use the debtor name as the client name
    const clientName = data.debtor.name;
    
    // Extract month from filename
    const month = file.substring(5, 7);
    
    // Create a date from year and month
    // JavaScript months are 0-indexed (0=Jan, 11=Dec)
    const monthIndex = parseInt(month) - 1;
    // Create a date object for the first day of the month in UTC to avoid timezone issues
    const date = new Date(Date.UTC(parseInt(year), monthIndex, 1));
    console.log(`Processing file ${file}: year=${year}, month=${month}, monthIndex=${monthIndex}, date=${date.toISOString()}`);
    
    // Generate invoice number
    const invoiceNumber = generateInvoiceNumberFromFile(filePath, data);
    
    return {
      client: clientName,
      month,
      fileName: file,
      date,
      invoiceNumber,
      data
    };
  });

  // Validate consistency of creditor information across all invoices
  if (invoices.length > 1) {
    console.log('Validating creditor consistency across invoices...');
    const firstCreditor = invoices[0].data.creditor;
    
    for (let i = 1; i < invoices.length; i++) {
      const currentCreditor = invoices[i].data.creditor;
      
      // Check only the most critical fields: name and uid
      // These should never differ across invoices from the same company
      if (
        currentCreditor.name !== firstCreditor.name ||
        currentCreditor.uid !== firstCreditor.uid
      ) {
        console.error('Error: Critical creditor information is inconsistent across invoices');
        console.error(`Invoice ${invoices[0].fileName} has creditor: ${firstCreditor.name} (${firstCreditor.uid})`);
        console.error(`Invoice ${invoices[i].fileName} has creditor: ${currentCreditor.name} (${currentCreditor.uid})`);
        process.exit(1);
      }
    }
    console.log('Critical creditor information is consistent across all invoices');
  }

  // Generate report
  const report: Report = {
    year,
    generatedAt: new Date().toISOString(),
    exchangeRateDate: new Date().toISOString().split('T')[0], // Today's date for exchange rates
    totalRevenue: {},
    totalRevenueCHF: 0,
    monthlyRevenue: {},
    clientSummary: {},
    invoices: []
  };

  // Process each invoice
  invoices.forEach(invoice => {
    const { client, month, fileName, date, invoiceNumber, data } = invoice;
    
    // Set default currency if not specified
    const currency = data.currency || 'CHF';
    
    // Calculate invoice total
    let invoiceTotal = 0;
    data.items.forEach(item => {
      invoiceTotal += item.amount;
    });
    
    // Add VAT if present
    if (data.vatRate) {
      invoiceTotal += invoiceTotal * (data.vatRate / 100);
    }
    
    // Convert to CHF for tax reporting
    let invoiceTotalCHF = invoiceTotal;
    if (currency !== 'CHF') {
      try {
        invoiceTotalCHF = convertCurrency(invoiceTotal, currency, 'CHF', exchangeRates);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`Warning: ${error.message}`);
        console.error(`Using 1:1 rate for ${currency} to CHF as fallback`);
      }
    }
    
    // Update total revenue by currency
    report.totalRevenue[currency] = (report.totalRevenue[currency] || 0) + invoiceTotal;
    
    // Update total revenue in CHF
    report.totalRevenueCHF += invoiceTotalCHF;
    
    // Update monthly data
    if (!report.monthlyRevenue[month]) {
      report.monthlyRevenue[month] = {
        total: 0,
        totalCHF: 0,
        byCurrency: {}
      };
    }
    report.monthlyRevenue[month].total += invoiceTotal;
    report.monthlyRevenue[month].totalCHF += invoiceTotalCHF;
    
    // Update monthly revenue by currency
    if (!report.monthlyRevenue[month].byCurrency[currency]) {
      report.monthlyRevenue[month].byCurrency[currency] = 0;
    }
    report.monthlyRevenue[month].byCurrency[currency] += invoiceTotal;
    
    // Update client summary
    if (!report.clientSummary[client]) {
      report.clientSummary[client] = {
        totalBilled: 0,
        totalBilledCHF: 0,
        invoiceCount: 0,
        currency: currency
      };
    }
    report.clientSummary[client].totalBilled += invoiceTotal;
    report.clientSummary[client].totalBilledCHF += invoiceTotalCHF;
    report.clientSummary[client].invoiceCount += 1;
    
    // Add to invoices list
    report.invoices.push({
      client,
      month,
      date: date.toISOString().split('T')[0],
      invoiceNumber,
      amount: invoiceTotal,
      amountCHF: invoiceTotalCHF,
      currency,
      items: data.items.length,
      fileName
    });
  });

  // Sort invoices by date (chronologically)
  report.invoices.sort((a, b) => a.date.localeCompare(b.date));

  // Sort months by name for the monthly report
  const sortedMonths = Object.keys(report.monthlyRevenue).sort();

  // Create an array of client information sorted by total billed (descending)
  const sortedClients = Object.entries(report.clientSummary)
    .sort(([, a], [, b]) => b.totalBilledCHF - a.totalBilledCHF)
    .map(([client, data]) => ({
      name: client,
      totalBilled: data.totalBilled,
      totalBilledCHF: data.totalBilledCHF,
      invoiceCount: data.invoiceCount,
      currency: data.currency
    }));

  // Get the company name from the first invoice
  const companyName = invoices.length > 0 ? invoices[0].data.creditor.name : 'Company';
  const uid = invoices.length > 0 ? invoices[0].data.creditor.uid : '';
  const creditorCity = invoices.length > 0 ? invoices[0].data.creditor.city : '';

  // Generate reports based on language selection
  const generatedFiles: string[] = [];
  
  if (language === 'both' || language === 'de') {
    const filePath = generateLanguageReport('de', report, year, companyName, uid, sortedMonths, creditorCity);
    generatedFiles.push(filePath);
  }
  
  if (language === 'both' || language === 'en') {
    const filePath = generateLanguageReport('en', report, year, companyName, uid, sortedMonths, creditorCity);
    generatedFiles.push(filePath);
  }
  
  // Generate PDFs if requested
  if (generatePdf) {
    console.log('\nConverting reports to PDF...');
    for (const file of generatedFiles) {
      console.log(`Converting ${file} to PDF...`);
      try {
        // Directly use the imported function
        const pdfFile = await convertMarkdownToPdf(file);
        console.log(`PDF generated: ${pdfFile}`);
      } catch (err) {
        console.error(`Error converting to PDF: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  
  return { generatedFiles, generatePdf };
}

// Function to generate a report for a specific language
function generateLanguageReport(
  language: 'en' | 'de', 
  report: Report, 
  year: string, 
  companyName: string, 
  uid: string, 
  sortedMonths: string[],
  creditorCity: string
) {
  // Format functions
  const formatAmount = (amount: number, currency: string): string => {
    return `${amount.toFixed(2)} ${currency}`;
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
  };

  // Localized strings based on language
  const texts = {
    en: {
      generatedLabel: 'Generated',
      exchangeRatesLabel: 'Exchange rates as of',
      revenueTitle: 'Revenue Summary',
      totalRevenue: 'Total Revenue',
      approximatedTotal: 'Approximated Total (CHF)',
      quarterlyTitle: 'Quarterly Summary',
      quarter: 'Quarter',
      originalCurrencies: 'Amount',
      chfValue: 'CHF Value',
      invoiceDetailsTitle: 'Invoice Details',
      date: 'Date',
      invoiceNumber: 'Invoice #',
      client: 'Client',
      amount: 'Amount',
      items: 'Items',
      notesTitle: 'Notes',
      exchangeRatesNote: 'Exchange rates obtained from `open.er-api.com` on',
      roundingNote: 'All amounts are rounded to the nearest cent',
      none: 'None',
      signatureTitle: 'Signature',
      signatureDate: 'Date',
      signatureName: 'Name'
    },
    de: {
      generatedLabel: 'Generiert am',
      exchangeRatesLabel: 'Wechselkurse vom',
      revenueTitle: 'Umsatzübersicht',
      totalRevenue: 'Gesamtumsatz',
      approximatedTotal: 'Ungefährer Gesamtbetrag',
      quarterlyTitle: 'Quartalsübersicht',
      quarter: 'Quartal',
      originalCurrencies: 'Betrag',
      chfValue: 'CHF-Wert',
      invoiceDetailsTitle: 'Rechnungsdetails',
      date: 'Datum',
      invoiceNumber: 'Rechnung #',
      client: 'Kunde',
      amount: 'Betrag',
      items: 'Positionen',
      notesTitle: 'Hinweise',
      exchangeRatesNote: 'Wechselkurse bezogen von `open.er-api.com` am',
      roundingNote: 'Alle Beträge sind auf den nächsten Rappen gerundet',
      none: 'Keine',
      signatureTitle: 'Unterschrift',
      signatureDate: 'Datum',
      signatureName: 'Name'
    }
  };

  // Use the appropriate language texts
  const t = language === 'de' ? texts.de : texts.en;

  // Get creditor information from the first invoice for the signature
  const today = new Date();
  
  // Check if we have multiple currencies
  const hasMultipleCurrencies = Object.keys(report.totalRevenue).length > 1;

  // Generate markdown report with Swiss tax-specific information
  const markdownReport = `# ${companyName} - Buchführung ${year}

*${t.generatedLabel}: ${formatDate(new Date().toISOString())}*  
*UID: ${uid}*  

## ${t.revenueTitle}

**${t.totalRevenue}:**
${Object.entries(report.totalRevenue)
  .map(([currency, amount]) => `- ${formatAmount(amount, currency)}`)
  .join('\n')}

${hasMultipleCurrencies 
  ? `**${t.approximatedTotal}**: ${formatAmount(report.totalRevenueCHF, 'CHF')}`
  : ''
}

## ${t.quarterlyTitle}

| ${t.quarter} | ${hasMultipleCurrencies ? `${t.originalCurrencies} | ${t.chfValue}` : t.totalRevenue} |
|---------|${hasMultipleCurrencies ? '---------------------|-----------' : '-----------|'}
${Array.from({ length: 4 }, (_, i) => {
  const quarterIndex = i + 1;
  const currentDate = new Date();
  const reportYear = parseInt(year);
  const currentYear = currentDate.getFullYear();
  const currentQuarter = Math.ceil((currentDate.getMonth() + 1) / 3);
  
  // Skip future quarters in the current year
  if (reportYear === currentYear && quarterIndex > currentQuarter) {
    return null;
  }
  
  const quarterMonths = sortedMonths.filter(month => {
    const monthNum = parseInt(month);
    return Math.ceil(monthNum / 3) === quarterIndex;
  });
  
  // For past quarters with no data, show zero
  const quarterRevenue = quarterMonths.reduce((sum, month) => {
    return sum + report.monthlyRevenue[month].totalCHF;
  }, 0);
  
  // Get revenue by currency for this quarter
  const currencySums: Record<string, number> = {};
  
  quarterMonths.forEach(month => {
    Object.entries(report.monthlyRevenue[month].byCurrency).forEach(([currency, amount]) => {
      currencySums[currency] = (currencySums[currency] || 0) + amount;
    });
  });
  
  const currencyText = Object.entries(currencySums)
    .map(([currency, amount]) => formatAmount(amount, currency))
    .join(', ');
  
  if (hasMultipleCurrencies) {
    return `| Q${quarterIndex} | ${currencyText || t.none} | ${formatAmount(quarterRevenue, 'CHF')} |`;
  } else {
    return `| Q${quarterIndex} | ${currencyText || formatAmount(quarterRevenue, 'CHF')} |`;
  }
}).filter(Boolean).join('\n')}

## ${t.invoiceDetailsTitle}

| ${t.date} | ${t.invoiceNumber} | ${t.client} | ${t.amount} | ${hasMultipleCurrencies ? `${t.chfValue} |` : ''} ${t.items} |
|------|-----------|--------|--------|${hasMultipleCurrencies ? '-----------|' : ''}-------|
${report.invoices.map(inv => {
  // Parse the date string properly to ensure correct month
  const date = new Date(inv.date);
  console.log(`Formatting invoice ${inv.invoiceNumber}: date string=${inv.date}, parsed date=${date.toISOString()}, month=${date.getMonth()}`);
  
  // Get the month name based on the locale
  const localizedDate = language === 'de' 
    ? `${date.toLocaleDateString('de-DE', { month: 'long' })} ${date.getFullYear()}`
    : `${date.toLocaleDateString('en-US', { month: 'long' })} ${date.getFullYear()}`;

  if (hasMultipleCurrencies) {
    return `| ${localizedDate} | ${inv.invoiceNumber} | ${inv.client} | ${formatAmount(inv.amount, inv.currency)} | ${formatAmount(inv.amountCHF, 'CHF')} | ${inv.items} |`;
  } else {
    return `| ${localizedDate} | ${inv.invoiceNumber} | ${inv.client} | ${formatAmount(inv.amount, inv.currency)} | ${inv.items} |`;
  }
}).join('\n')}

## ${t.notesTitle}

${hasMultipleCurrencies ? `- ${t.exchangeRatesNote} ${formatDate(report.exchangeRateDate)}` : ''}
- ${t.roundingNote}

## ${t.signatureTitle}

${creditorCity}, ${formatDate(today.toISOString())}

&nbsp;  
&nbsp;  

${companyName}
`;

  // Generate filename with language suffix
  const markdownPath = path.join(REPORTS_DIR, `buchfuehrung-${year}-${language}.md`);
  fs.writeFileSync(markdownPath, markdownReport);

  console.log(`${language.toUpperCase()} report generated at: ${markdownPath}`);
  return markdownPath;
}

// Run the async report generation
generateReport().catch(err => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(`Error generating report: ${error.message}`);
  process.exit(1);
}).then((result) => {
  if (result && result.generatePdf === false) {
    console.log('\nMarkdown reports generated successfully!');
    console.log('To also generate PDF reports, run with the --pdf option:');
    console.log(`yarn buchfuehrung ${parseArguments().year} --pdf`);
  }
}); 