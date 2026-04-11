const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const puppeteer = require('puppeteer');
const { formatAppointmentDateRu } = require('./ticketFormat');

const projectRoot = path.join(__dirname, '..');

function buildPdfStylesheet() {
  const chunks = [];

  const bootstrapCss = path.join(projectRoot, 'node_modules/bootstrap/dist/css/bootstrap.min.css');
  const iconsCssPath = path.join(projectRoot, 'node_modules/bootstrap-icons/font/bootstrap-icons.css');
  const appCss = path.join(projectRoot, 'public/css/style.css');

  if (fs.existsSync(bootstrapCss)) {
    chunks.push(fs.readFileSync(bootstrapCss, 'utf8'));
  }
  if (fs.existsSync(iconsCssPath)) {
    let iconsCss = fs.readFileSync(iconsCssPath, 'utf8');
    const fontsDir = path.join(projectRoot, 'node_modules/bootstrap-icons/font/fonts');
    iconsCss = iconsCss.replace(/url\(["']?(\.\/fonts\/[^"')]+)["']?\)/gi, (_, relPath) => {
      const clean = relPath.split('?')[0];
      const fp = path.join(fontsDir, path.basename(clean));
      if (!fs.existsSync(fp)) return `url("${relPath}")`;
      const b64 = fs.readFileSync(fp).toString('base64');
      const ext = fp.endsWith('.woff2') ? 'woff2' : 'woff';
      return `url(data:font/${ext};base64,${b64})`;
    });
    chunks.push(iconsCss);
  }
  if (fs.existsSync(appCss)) {
    chunks.push(fs.readFileSync(appCss, 'utf8'));
  }

  chunks.push(`
:root, html.ticket-pdf-root {
  --app-primary: #0d6efd;
  --app-text: #0f172a;
  --app-muted: #64748b;
  --app-gray-50: #f8fafc;
  --app-gray-100: #f1f5f9;
  --app-gray-200: #e2e8f0;
  --app-white: #ffffff;
  --radius-xl: 1rem;
  --radius-lg: 0.75rem;
  --radius-md: 0.5rem;
  --radius-pill: 50rem;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.05);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,.08);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,.1);
  color-scheme: light only;
}
html.ticket-pdf-root, body.ticket-pdf-body {
  background: #ffffff !important;
  color: #0f172a !important;
}
body.ticket-pdf-body {
  margin: 0;
  padding: 12px 10px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.ticket-pdf-banner {
  max-width: 640px;
  margin: 0 auto 16px;
  text-align: center;
  padding: 12px 14px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  color: #9a3412;
  font-size: 14px;
  font-weight: 600;
  border-radius: 8px;
  box-sizing: border-box;
}
`);

  return chunks.join('\n\n');
}

/**
 * @param {object} row — строка из fetchAppointmentMailPayload
 * @param {{ statusOverride?: string }} opts
 */
function buildTicketViewModelFromMailRow(row, opts = {}) {
  const status = opts.statusOverride != null ? opts.statusOverride : row.appt_status || 'booked';
  return {
    ticket_number: row.ticket_number || '—',
    status,
    patient_last_name: row.patient_last || '',
    patient_first_name: row.patient_first || '',
    patient_middle_name: row.patient_middle || '',
    doctor_last_name: row.doctor_last || '',
    doctor_first_name: row.doctor_first || '',
    doctor_middle_name: row.doctor_middle || '',
    specialization: row.specialization || '',
    formatted_date: formatAppointmentDateRu(row.appointment_date_raw),
    formatted_time: (row.appt_time && String(row.appt_time).trim()) || '—',
    cabinet: row.cabinet,
  };
}

function safeTicketPdfFilename(ticketNumber) {
  const base = String(ticketNumber || 'ticket')
    .replace(/^МЗ-/, 'MZ-')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `ticket_${base || 'unknown'}.pdf`;
}

async function renderTicketPdfHtml(ticketViewModel, pdfBannerLine) {
  const inlinedStyles = buildPdfStylesheet();
  const pdfPath = path.join(projectRoot, 'views', 'tickets', 'pdf.ejs');
  return ejs.renderFile(
    pdfPath,
    {
      ticket: ticketViewModel,
      inlinedStyles,
      pdfBannerLine: pdfBannerLine || null,
    },
    { async: true, root: path.join(projectRoot, 'views') }
  );
}

/**
 * @param {object} ticketViewModel — результат buildTicketViewModelFromMailRow
 * @param {{ pdfBannerLine?: string|null }} options
 * @returns {Promise<Buffer>}
 */
async function generateTicketPdfBuffer(ticketViewModel, options = {}) {
  const pdfBannerLine = options.pdfBannerLine != null ? options.pdfBannerLine : null;
  const html = await renderTicketPdfHtml(ticketViewModel, pdfBannerLine);

  const launchOpts = {
    headless: true,
    args: ['--disable-dev-shm-usage', '--font-render-hinting=medium'],
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const extra = (process.env.PUPPETEER_ARGS || '').trim();
  if (extra) {
    launchOpts.args.push(...extra.split(/\s+/).filter(Boolean));
  }
  if (process.env.PUPPETEER_NO_SANDBOX === '1' || process.env.PUPPETEER_NO_SANDBOX === 'true') {
    launchOpts.args.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const pdfUint8 = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
    });
    return Buffer.from(pdfUint8);
  } finally {
    await browser.close();
  }
}

module.exports = {
  generateTicketPdfBuffer,
  buildTicketViewModelFromMailRow,
  buildPdfStylesheet,
  safeTicketPdfFilename,
};
