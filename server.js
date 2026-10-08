import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as mupdf from 'mupdf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend assets (e.g. index.html) directly from workspace root
app.use(express.static(__dirname));

const TEMPLATE_PDF = path.join(__dirname, 'SSOS FRONT PAGE.pdf');

// Default bounding boxes (x0, y0, x1, y1 from top-left) for placeholders in SSOS FRONT PAGE.pdf
const DEFAULT_POSITIONS = {
  '<<DEPARTMENT>>': { x0: 288.05, y0: 165.01, x1: 399.49, y1: 178.29 },
  '<<YEAR>>':       { x0: 260.21, y0: 179.89, x1: 321.53, y1: 193.17 },
  '<<NAME>>':       { x0: 199.37, y0: 245.18, x1: 256.59, y1: 257.40 },
  '<<REG.NO>>':     { x0: 198.41, y0: 285.29, x1: 255.61, y1: 296.33 },
  '<<CLASS>>':      { x0: 199.37, y0: 322.73, x1: 258.50, y1: 334.95 },
  '<<BATCH>>':      { x0: 198.41, y0: 362.69, x1: 249.50, y1: 373.73 },
  '<<SEM>>':        { x0: 198.41, y0: 401.81, x1: 240.12, y1: 412.85 },
  '<<COURSE>>':     { x0: 198.41, y0: 440.21, x1: 256.70, y1: 451.25 },
  '<<CC>>':         { x0: 198.41, y0: 479.47, x1: 231.99, y1: 490.51 },
  '<<TOPIC>>':      { x0: 197.33, y0: 501.31, x1: 253.80, y1: 513.53 },
  '<<DATE>>':       { x0: 199.37, y0: 555.43, x1: 252.38, y1: 567.65 },
  '<<IN-CHARGE>>':  { x0: 199.37, y0: 593.59, x1: 284.67, y1: 605.81 },
};

// Scan the PDF template dynamically to locate placeholders
function loadPlaceholderPositions(pdfPath) {
  try {
    if (!fs.existsSync(pdfPath)) return DEFAULT_POSITIONS;
    const doc = mupdf.PDFDocument.openDocument(pdfPath);
    const page = doc.loadPage(0);
    const positions = {};

    for (const tag of Object.keys(DEFAULT_POSITIONS)) {
      const quads = page.search(tag);
      if (quads && quads.length > 0) {
        const q = quads[0][0];
        positions[tag] = {
          x0: Math.min(q[0], q[2], q[4], q[6]),
          y0: Math.min(q[1], q[3], q[5], q[7]),
          x1: Math.max(q[0], q[2], q[4], q[6]),
          y1: Math.max(q[1], q[3], q[5], q[7]),
        };
      } else {
        positions[tag] = DEFAULT_POSITIONS[tag];
      }
    }
    return positions;
  } catch (err) {
    console.warn('[PDF] Dynamic placeholder scan warning, using defaults:', err.message);
    return DEFAULT_POSITIONS;
  }
}

// Cache template positions on startup
let cachedPositions = loadPlaceholderPositions(TEMPLATE_PDF);

app.post('/generate-pdf', async (req, res) => {
  try {
    const userData = req.body || {};

    if (!fs.existsSync(TEMPLATE_PDF)) {
      return res.status(500).json({ error: `Template PDF not found at ${TEMPLATE_PDF}` });
    }

    const templateBytes = fs.readFileSync(TEMPLATE_PDF);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page = pdfDoc.getPages()[0];
    const pageHeight = page.getHeight();

    // Standard Times-Bold matches the 'tibo' font used in PyMuPDF
    const font = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

    const replacements = {
      '<<DEPARTMENT>>': userData.dept || '',
      '<<YEAR>>': `(${userData.academic_year || ''})`,
      '<<NAME>>': String(userData.name || '').toUpperCase(),
      '<<REG.NO>>': userData.regno || '',
      '<<CLASS>>': userData.class_val || '',
      '<<BATCH>>': userData.batch || '',
      '<<SEM>>': userData.sem || '',
      '<<COURSE>>': userData.course || '',
      '<<CC>>': userData.course_code || '',
      '<<TOPIC>>': userData.topic || '',
      '<<DATE>>': userData.date || '',
      '<<IN-CHARGE>>': userData.incharge || '',
    };

    for (const [searchText, replaceText] of Object.entries(replacements)) {
      const pos = cachedPositions[searchText] || DEFAULT_POSITIONS[searchText];
      if (!pos) continue;

      // 1. Redact / erase placeholder text by drawing a white rectangle over it
      const rectX = pos.x0 - 1;
      const rectY = pageHeight - pos.y1 - 1;
      const rectW = (pos.x1 - pos.x0) + 2;
      const rectH = (pos.y1 - pos.y0) + 2;

      page.drawRectangle({
        x: rectX,
        y: rectY,
        width: rectW,
        height: rectH,
        color: rgb(1, 1, 1),
      });

      // 2. Insert replacement text at baseline (inst.x0, inst.y1 - 2) matching PyMuPDF
      const textX = pos.x0;
      const textY = pageHeight - (pos.y1 - 2);

      page.drawText(String(replaceText), {
        x: textX,
        y: textY,
        size: 12,
        font: font,
        color: rgb(0, 0, 0),
      });
    }

    const pdfBytes = await pdfDoc.save();
    const downloadName = `FrontPage_${userData.name || 'Output'}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
    return res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Error generating PDF:', error);
    return res.status(500).json({ error: 'Failed to generate PDF', details: error.message });
  }
});

const port = parseInt(process.env.PORT, 10) || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running at http://0.0.0.0:${port}`);
});
