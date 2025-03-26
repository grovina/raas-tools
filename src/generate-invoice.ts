import { createWriteStream, readFileSync } from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { SwissQRBill, Table } from "swissqrbill/pdf";
import { mm2pt } from "swissqrbill/utils";
import { generateInvoiceNumberFromFile, generateSCORReference, parseISODate } from "./invoice-utils";

// Get input file from command line arguments
const inputFile = process.argv[2] || "./input.json";

// Replace the specific interface with a more flexible type
// that allows arbitrary keys while ensuring required fields
interface InvoiceItem extends Record<string, any> {
  description: string; // Required field
  amount: number; // Required field for totals calculation
  // Other fields are optional and dynamic
}

interface InvoiceData {
  number?: string; // Can be provided or auto-generated
  creditor: {
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
  };
  debtor: {
    name: string;
    address: string;
    buildingNumber: string;
    zip: string;
    city: string;
    country: string;
  };
  columns: string[];
  items: InvoiceItem[];
  language: "DE" | "EN" | "FR" | "IT";
  date: Date;
  vatRate: number | null;
  reference: string;
  currency?: string; // Defaults to CHF
}

// Load the invoice data from the specified file
let rawInvoiceData;
try {
  const filePath = path.resolve(inputFile);
  const fileContent = readFileSync(filePath, "utf8");
  rawInvoiceData = JSON.parse(fileContent);
  console.log(`Successfully loaded data from ${filePath}`);
} catch (error: any) {
  console.error(`Error loading input file: ${error.message}`);
  process.exit(1);
}

const invoiceData: InvoiceData = (() => {
  // Use the provided invoice number if it exists
  // Otherwise generate one either from filename or using the standard method
  let invoiceNumber: string;
  if (rawInvoiceData.number) {
    invoiceNumber = rawInvoiceData.number;
    console.log(`Using provided invoice number: ${invoiceNumber}`);
  } else {
    // Try to generate from filename first, fall back to standard method
    invoiceNumber = generateInvoiceNumberFromFile(inputFile, rawInvoiceData);
    console.log(`Generated invoice number: ${invoiceNumber}`);
  }
  
  // Generate reference using the invoice number
  const reference = generateSCORReference(invoiceNumber);
  
  return {
    ...rawInvoiceData,
    number: invoiceNumber,
    date: rawInvoiceData.date ? parseISODate(rawInvoiceData.date) : new Date(),
    language: rawInvoiceData.language as InvoiceData["language"],
    currency: rawInvoiceData.currency || "CHF",
    items: rawInvoiceData.items,
    reference: reference,
  };
})();

// Use the columns directly from invoiceData
const columnsToDisplay = invoiceData.columns;

// Helper function to handle column width
function getColumnWidth(key: string): number | undefined {
  return key === "description" ? undefined : mm2pt(30);
}

// Calculate totals
const subtotal = invoiceData.items.reduce(
  (sum: number, item: InvoiceItem) => sum + item.amount,
  0
);
const vat = invoiceData.vatRate ? subtotal * (invoiceData.vatRate / 100) : 0;
const total = subtotal + vat;

// Calculate due date (30 days from invoice date)
const dueDate = new Date(invoiceData.date);
dueDate.setDate(dueDate.getDate() + 30);

// Create a new PDF document
const inputBaseName = path.basename(inputFile, path.extname(inputFile));
const filename = `INV-${invoiceData.number}-${inputBaseName}.pdf`;
const stream = createWriteStream(filename);
const pdf = new PDFDocument({ size: "A4" });
pdf.pipe(stream);

// Add creditor address
pdf.fontSize(12);
pdf.fillColor("black");
pdf.font("Helvetica");
pdf.text(
  `${invoiceData.creditor.name}\n${invoiceData.creditor.address} ${invoiceData.creditor.buildingNumber}\n${invoiceData.creditor.zip} ${invoiceData.creditor.city}`,
  mm2pt(20),
  mm2pt(35),
  {
    align: "left",
    height: mm2pt(50),
    width: mm2pt(100),
  }
);

// Add debtor address after company address
pdf.text(
  `${invoiceData.debtor.name}\n${invoiceData.debtor.address} ${invoiceData.debtor.buildingNumber}\n${invoiceData.debtor.zip} ${invoiceData.debtor.city}`,
  mm2pt(130),
  mm2pt(60),
  {
    align: "left",
    height: mm2pt(50),
    width: mm2pt(70),
  }
);

// Add title and date
pdf.fontSize(11);
pdf.font("Helvetica");
pdf.text(
  `${invoiceData.creditor.city}, ${invoiceData.date.getDate()}.${
    invoiceData.date.getMonth() + 1
  }.${invoiceData.date.getFullYear()}`,
  mm2pt(20),
  mm2pt(85),
  {
    align: "left",
    width: mm2pt(170),
  }
);

pdf.fontSize(14);
pdf.font("Helvetica-Bold");
pdf.text(`Invoice ${invoiceData.number}`, mm2pt(20), mm2pt(100), {
  align: "left",
  width: mm2pt(170),
});

pdf.fontSize(11);
pdf.font("Helvetica");
pdf.text(`UID: ${invoiceData.creditor.uid}`, {
  align: "left",
  continued: true,
});

pdf.text(
  `Due Date: ${dueDate.getDate()}.${
    dueDate.getMonth() + 1
  }.${dueDate.getFullYear()}`,
  {
    align: "right",
    width: mm2pt(170),
  }
);

// Add table
const table = new Table({
  rows: [
    {
      backgroundColor: "#4A4D51",
      columns: invoiceData.columns.map((key) => {
        return {
          text: key.charAt(0).toUpperCase() + key.slice(1), // Capitalize column name
          width: getColumnWidth(key), // Flexible width for description
        };
      }),
      fontName: "Helvetica-Bold",
      height: 20,
      padding: 5,
      textColor: "#fff",
      verticalAlign: "center",
    },
    ...invoiceData.items.map((item, index) => ({
      columns: invoiceData.columns.map((key) => {
        const value = item[key];

        // Format based on value type and column name
        if (key === "amount") {
          return {
            text: `${invoiceData.currency} ${Number(value).toFixed(2)}`,
            width: getColumnWidth(key),
          };
        }

        if (key === "date" && typeof value === "string") {
          try {
            // Try to parse as ISO date
            const parsedDate = parseISODate(value);
            return {
              text: `${parsedDate.getDate()}.${parsedDate.getMonth() + 1}.${parsedDate.getFullYear()}`,
              width: getColumnWidth(key),
            };
          } catch (e) {
            // Fallback to original value if parsing fails
            return {
              text: String(value),
              width: getColumnWidth(key),
            };
          }
        }

        if (key === "date" && value instanceof Date) {
          return {
            text: `${value.getDate()}.${value.getMonth() + 1}.${value.getFullYear()}`,
            width: getColumnWidth(key),
          };
        }

        // Money-related columns should be formatted with currency
        const moneyRelatedNames = ["price", "cost", "rate", "fee", "charge"];
        if (
          typeof value === "number" &&
          moneyRelatedNames.some((name) => key.toLowerCase().includes(name))
        ) {
          return {
            text: `${invoiceData.currency} ${value.toFixed(2)}`,
            width: getColumnWidth(key),
          };
        }

        return {
          text: String(value || ""),
          width: getColumnWidth(key),
        };
      }),
      padding: 5,
    })),
    // Subtotal row
    {
      columns: invoiceData.columns.map((key, index) => {
        // For the amount column, show the subtotal
        if (key === "amount") {
          return {
            fontName: "Helvetica-Bold",
            text: `${invoiceData.currency} ${subtotal.toFixed(2)}`,
            width: getColumnWidth(key),
          };
        }

        // For the column before amount, show "Subtotal" label
        const amountIndex = invoiceData.columns.indexOf("amount");
        if (amountIndex > 0 && index === amountIndex - 1) {
          return {
            fontName: "Helvetica-Bold",
            text: "Subtotal",
            width: getColumnWidth(key),
          };
        }

        // Empty cells for other columns
        return {
          text: "",
          width: getColumnWidth(key),
        };
      }),
      height: 40,
      padding: 5,
    },
    // VAT row (conditional)
    ...(invoiceData.vatRate
      ? [
          {
            columns: invoiceData.columns.map((key, index) => {
              // For the amount column, show the VAT percentage
              if (key === "amount") {
                return {
                  text: `${invoiceData.vatRate}%`,
                  width: getColumnWidth(key),
                };
              }

              // For the column before amount, show "VAT" label
              const amountIndex = invoiceData.columns.indexOf("amount");
              if (amountIndex > 0 && index === amountIndex - 1) {
                return {
                  text: "VAT",
                  width: getColumnWidth(key),
                };
              }

              // Empty cells for other columns
              return {
                text: "",
                width: getColumnWidth(key),
              };
            }),
            padding: 5,
          },
        ]
      : []),
    // Total row
    {
      columns: invoiceData.columns.map((key, index) => {
        // For the amount column, show the total
        if (key === "amount") {
          return {
            fontName: "Helvetica-Bold",
            text: `${invoiceData.currency} ${total.toFixed(2)}`,
            width: getColumnWidth(key),
          };
        }

        // For the column before amount, show "Total" label
        const amountIndex = invoiceData.columns.indexOf("amount");
        if (amountIndex > 0 && index === amountIndex - 1) {
          return {
            fontName: "Helvetica-Bold",
            text: "Total",
            width: getColumnWidth(key),
          };
        }

        // Empty cells for other columns
        return {
          text: "",
          width: getColumnWidth(key),
        };
      }),
      height: 40,
      padding: 5,
    },
  ],
  width: mm2pt(170),
});

// Combine all elements
table.attachTo(pdf);

if (invoiceData.currency === "CHF" || invoiceData.currency === "EUR") {
  // Create QR bill
  const qrBill = new SwissQRBill(
    {
      amount: total,
      currency: invoiceData.currency,
      creditor: {
        name: invoiceData.creditor.accountName,
        address: invoiceData.creditor.address,
        buildingNumber: invoiceData.creditor.buildingNumber,
        zip: invoiceData.creditor.zip,
        city: invoiceData.creditor.city,
        country: invoiceData.creditor.country,
        account: invoiceData.creditor.iban,
      },
      debtor: {
        name: invoiceData.debtor.name,
        address: invoiceData.debtor.address,
        buildingNumber: invoiceData.debtor.buildingNumber,
        zip: invoiceData.debtor.zip,
        city: invoiceData.debtor.city,
        country: invoiceData.debtor.country,
      },
      reference: invoiceData.reference,
    },
    {
      language: invoiceData.language,
    }
  );
  // Only attach QR bill if currency is CHF or EUR
  qrBill.attachTo(pdf);
} else {
  // Wait for table to finish rendering
  pdf.moveDown(6);

  // Get current Y position after table
  const paymentSectionY = pdf.y + mm2pt(10);

  // Add a light gray background box for payment details
  pdf.fillColor("#f5f5f5");
  pdf.rect(mm2pt(15), paymentSectionY, mm2pt(180), mm2pt(70)).fill();
  pdf.fillColor("black");

  // Add a styled header within the box
  pdf.fontSize(14);
  pdf.font("Helvetica-Bold");
  pdf.text("Payment Details", mm2pt(20), paymentSectionY + mm2pt(5), {
    width: mm2pt(170),
    align: "left",
  });

  // Add a divider line
  pdf
    .moveTo(mm2pt(20), pdf.y + mm2pt(5))
    .lineTo(mm2pt(180), pdf.y + mm2pt(5))
    .strokeColor("#333333")
    .lineWidth(0.5)
    .stroke();

  pdf.moveDown(2);
  pdf.fontSize(10);
  pdf.font("Helvetica");

  // Format payment details in two columns
  const leftColumnX = mm2pt(25);
  const rightColumnX = mm2pt(105);
  const rowHeight = mm2pt(8);
  let currentY = pdf.y;

  // Left column
  pdf.font("Helvetica-Bold");
  pdf.text("Account Holder:", leftColumnX, currentY, { continued: true });
  pdf.font("Helvetica");
  pdf.text(` ${invoiceData.creditor.accountName}`, { align: "left" });

  currentY += rowHeight;
  pdf.font("Helvetica-Bold");
  pdf.text("IBAN:", leftColumnX, currentY, { continued: true });
  pdf.font("Helvetica");
  pdf.text(` ${invoiceData.creditor.iban}`, { align: "left" });

  currentY += rowHeight;
  pdf.font("Helvetica-Bold");
  pdf.text("SWIFT/BIC:", leftColumnX, currentY, { continued: true });
  pdf.font("Helvetica");
  pdf.text(` ${invoiceData.creditor.swift}`, { align: "left" });

  // Right column - calculate new position relative to the left column content
  currentY = pdf.y - rowHeight * 2;
  pdf.font("Helvetica-Bold");
  pdf.text("Reference:", rightColumnX, currentY, { continued: true });
  pdf.font("Helvetica");
  pdf.text(` ${invoiceData.reference}`, { align: "left" });

  currentY += rowHeight;
  pdf.font("Helvetica-Bold");
  pdf.text("Amount:", rightColumnX, currentY, { continued: true });
  pdf.font("Helvetica");
  pdf.text(` ${invoiceData.currency} ${total.toFixed(2)}`, { align: "left" });

  currentY += rowHeight;
  pdf.font("Helvetica-Bold");
  pdf.text("Due Date:", rightColumnX, currentY, { continued: true });
  pdf.font("Helvetica");
  pdf.text(
    ` ${dueDate.getDate()}.${dueDate.getMonth() + 1}.${dueDate.getFullYear()}`,
    { align: "left" }
  );

  // Add a note
  pdf.moveDown(2);
  pdf.fontSize(9);
  pdf.font("Helvetica-Oblique");
  pdf.text(
    "Please include the reference number in your payment to ensure proper processing.",
    mm2pt(25),
    undefined,
    {
      width: mm2pt(160),
      align: "center",
    }
  );
}

// Finalize the document
pdf.end();

console.log(`Generated ${filename}`);
