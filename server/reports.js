const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");

function buildWorkbookBuffer(sheetName, rows) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function buildPdfBuffer(title, subtitle, rows) {
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 36, size: "A4" });

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(22).text(title, { align: "left" });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor("#666").text(subtitle);
    doc.moveDown();
    doc.fillColor("#111");

    rows.forEach((row, index) => {
      doc.fontSize(12).text(`${index + 1}. ${Object.values(row).join(" | ")}`);
      doc.moveDown(0.3);
    });

    doc.end();
  });
}

module.exports = {
  buildPdfBuffer,
  buildWorkbookBuffer
};
