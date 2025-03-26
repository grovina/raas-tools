import { createHash } from "crypto";

/**
 * Parses a date string in yyyy-mm-dd format to ensure consistent handling
 * @param dateStr Date string in yyyy-mm-dd format
 * @returns A proper Date object
 */
export function parseISODate(dateStr: string): Date {
  // If the date is already in ISO format, parse it directly
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    // Use UTC to avoid timezone issues
    const [year, month, day] = dateStr.split('-').map(num => parseInt(num, 10));
    return new Date(Date.UTC(year, month - 1, day));
  }
  
  // Fallback to standard date parsing
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}. Please use yyyy-mm-dd format.`);
  }
  return date;
}

/**
 * Generates an invoice number based on the date and invoice data
 * Format: YYMM-XXX where XXX is a hash of the invoice data
 */
export function generateInvoiceNumber(data: any): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");

  // Create a hash of the relevant invoice data
  const numericHash =
    parseInt(
      createHash("sha256")
        .update(JSON.stringify(data))
        .digest("hex")
        .slice(0, 8),
      16
    ) % 1000; // Convert to number and get last 3 digits
  const hash = numericHash.toString().padStart(3, "0"); // Ensure it's always 3 digits

  return `${year}${month}-${hash}`;
}

/**
 * Generates an invoice number for a specific file
 * Uses the filename and date from the file path
 * If the invoice data already contains a number, it will be used instead
 */
export function generateInvoiceNumberFromFile(filePath: string, invoiceData: any): string {
  // First check if the invoice data already contains a number
  if (invoiceData.number) {
    return invoiceData.number;
  }
  
  // Extract year and month from filename (YYYY-MM-clientname.json)
  const filename = filePath.split('/').pop() || '';
  const match = filename.match(/^(\d{4})-(\d{2})/);
  
  if (!match) {
    return generateInvoiceNumber(invoiceData); // Fallback to standard generation
  }
  
  const year = match[1].slice(-2); // Last two digits of year
  const month = match[2];
  
  // Create a hash of the relevant invoice data
  const numericHash =
    parseInt(
      createHash("sha256")
        .update(JSON.stringify(invoiceData))
        .digest("hex")
        .slice(0, 8),
      16
    ) % 1000; // Convert to number and get last 3 digits
  const hash = numericHash.toString().padStart(3, "0"); // Ensure it's always 3 digits

  return `${year}${month}-${hash}`;
}

/**
 * Generates a SCOR reference from an invoice number
 * This is used for QR-bill payments in Switzerland
 */
export function generateSCORReference(invoiceNumber: string): string {
  // Remove any non-alphanumeric characters
  const cleanNumber = invoiceNumber.replace(/[^a-zA-Z0-9]/g, "");

  // Convert letters to numbers (A=10, B=11, etc) according to ISO 11649
  const converted = cleanNumber
    .toUpperCase()
    .split("")
    .map((char) => {
      if (/[0-9]/.test(char)) return char;
      return (char.charCodeAt(0) - 55).toString();
    })
    .join("");

  // Add "RF00" to the beginning (00 is temporary check digits)
  const withRF = converted + "RF00";

  // Convert letters to numbers (A=10, B=11, etc)
  const numeric = withRF
    .split("")
    .map((char) => {
      if (/[0-9]/.test(char)) return char;
      return (char.charCodeAt(0) - 55).toString();
    })
    .join("");

  // Calculate modulo 97
  const mod = BigInt(numeric) % 97n;

  // Calculate check digits
  const checkDigits = (98 - Number(mod)).toString().padStart(2, "0");

  // Return final SCOR reference
  return `RF${checkDigits}${cleanNumber}`;
} 