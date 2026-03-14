#!/usr/bin/env node
/**
 * md-to-pdf: Convert Markdown to a beautiful PDF
 *
 * Usage:
 *   node convert.cjs --input doc.md --output doc.pdf --title "Title" --author "Author"
 *
 * See SKILL.md for full parameter reference.
 */

'use strict';

const puppeteer = require('puppeteer');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { marked } = require('marked');
const { PDFDocument } = require('pdf-lib');
const path = require('path');
const https = require('https');
const http = require('http');

// ─── CLI argument parsing ────────────────────────────────────────────────────

function getArg(name, alias) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name || (alias && args[i] === alias)) {
      return args[i + 1] || null;
    }
  }
  return null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const inputPath   = getArg('--input', '-i');
const outputPath  = getArg('--output', '-o');
const noCover     = hasFlag('--no-cover');
const coverImage  = getArg('--cover-image');
const coverPrompt = getArg('--cover-prompt');
const confidential = hasFlag('--confidential');
const geminiKey   = getArg('--gemini-api-key') || process.env.GEMINI_API_KEY || '';
const geminiProxy = getArg('--gemini-proxy') || process.env.GEMINI_PRO_PROXY || '';

if (!inputPath || !outputPath) {
  console.error('Usage: node convert.cjs --input <md> --output <pdf> [options]');
  console.error('Run with --help or see SKILL.md for full options.');
  process.exit(1);
}

if (!existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

// ─── Read & parse markdown ───────────────────────────────────────────────────

const md = readFileSync(inputPath, 'utf8');
marked.setOptions({ breaks: true, gfm: true });
const htmlContent = marked.parse(md);

// Extract title from first H1 if not provided
function extractTitle(markdown) {
  const m = markdown.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : 'Document';
}

const today = new Date().toISOString().slice(0, 10);
const title       = getArg('--title')    || extractTitle(md);
const subtitle    = getArg('--subtitle') || '';
const author      = getArg('--author')   || '';
const version     = getArg('--version')  || 'V1.0';
const date        = getArg('--date')     || today;

console.log(`📄 Converting: ${inputPath}`);
console.log(`   Title: ${title} | Author: ${author} | Version: ${version}`);

// ─── Gemini Pro image generation ─────────────────────────────────────────────

/**
 * Call Gemini image generation API directly via Node.js HTTPS.
 * Supports proxy via GEMINI_PRO_PROXY env var.
 * Model: gemini-3-pro-image-preview (high quality, ~60-180s)
 */
async function generateCoverWithGemini(prompt, outputImagePath) {
  if (!geminiKey) {
    console.warn('⚠️  GEMINI_API_KEY not set, skipping cover generation');
    return null;
  }

  console.log('🎨 Generating cover image with Gemini Pro...');

  const MODEL = 'gemini-3-pro-image-preview';
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiKey}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
  });

  try {
    const imageBytes = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Gemini API timeout (600s)')), 600000);

      // Parse proxy if set
      let reqOptions;
      if (geminiProxy) {
        const proxyUrl = new URL(geminiProxy);
        const targetUrl = new URL(API_URL);
        // Use CONNECT tunnel via proxy
        const tunnelReq = http.request({
          host: proxyUrl.hostname,
          port: parseInt(proxyUrl.port) || 8080,
          method: 'CONNECT',
          path: `${targetUrl.hostname}:443`,
        });
        tunnelReq.on('connect', (res, socket) => {
          if (res.statusCode !== 200) {
            clearTimeout(timeout);
            return reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
          }
          const req = https.request({
            host: targetUrl.hostname,
            path: targetUrl.pathname + targetUrl.search,
            method: 'POST',
            socket,
            agent: false,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          }, handleResponse);
          req.on('error', e => { clearTimeout(timeout); reject(e); });
          req.write(body);
          req.end();
        });
        tunnelReq.on('error', e => { clearTimeout(timeout); reject(e); });
        tunnelReq.end();
        return;
      }

      // No proxy — direct HTTPS
      const targetUrl = new URL(API_URL);
      const req = https.request({
        hostname: targetUrl.hostname,
        path: targetUrl.pathname + targetUrl.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, handleResponse);
      req.on('error', e => { clearTimeout(timeout); reject(e); });
      req.write(body);
      req.end();

      function handleResponse(res) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            if (data.error) return reject(new Error(data.error.message || JSON.stringify(data.error)));
            // Find image part
            for (const candidate of (data.candidates || [])) {
              for (const part of (candidate.content?.parts || [])) {
                if (part.inlineData?.mimeType?.startsWith('image/')) {
                  return resolve(Buffer.from(part.inlineData.data, 'base64'));
                }
              }
            }
            reject(new Error('No image in Gemini response: ' + JSON.stringify(data).slice(0, 200)));
          } catch (e) { reject(e); }
        });
        res.on('error', e => { clearTimeout(timeout); reject(e); });
      }
    });

    require('fs').writeFileSync(outputImagePath, imageBytes);
    const sizeMB = (imageBytes.length / 1024 / 1024).toFixed(2);
    console.log(`✅ Cover image saved: ${outputImagePath} (${sizeMB} MB)`);
    return outputImagePath;

  } catch (e) {
    console.warn(`⚠️  Cover generation failed: ${e.message}`);
    return null;
  }
}

// ─── Mermaid JS (bundled inline) ──────────────────────────────────────────────

function findMermaidJs() {
  // Look for mermaid in common locations
  const candidates = [
    path.join(__dirname, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
    path.join(process.env.HOME || '', '.openclaw', 'workspace', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  console.warn('⚠️  mermaid.min.js not found, diagrams will not render. Run: npm install mermaid');
  return '/* mermaid not found */';
}

// ─── CSS styles ──────────────────────────────────────────────────────────────

const CONTENT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans CN', sans-serif;
    font-size: 13px;
    line-height: 1.85;
    color: #1f2937;
    background: #fff;
  }
  .content { padding: 4mm 0; }

  h1 {
    font-size: 21px; font-weight: 700; color: #111827;
    margin: 32px 0 14px; padding-bottom: 9px;
    border-bottom: 2.5px solid #4f46e5;
    page-break-after: avoid;
  }
  h1:first-child { margin-top: 0; }
  h2 {
    font-size: 15px; font-weight: 600; color: #1e1b4b;
    margin: 24px 0 10px; padding: 8px 14px 8px 15px;
    background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%);
    border-left: 4px solid #4f46e5; border-radius: 0 5px 5px 0;
    page-break-after: avoid;
  }
  h3 {
    font-size: 13.5px; font-weight: 600; color: #1e40af;
    margin: 18px 0 8px; padding-left: 10px;
    border-left: 3px solid #60a5fa;
    page-break-after: avoid;
  }
  h4 { font-size: 13px; font-weight: 600; color: #374151; margin: 14px 0 6px; }
  p { margin: 7px 0; color: #374151; text-align: justify; }
  ul, ol { margin: 7px 0 7px 18px; color: #374151; }
  li { margin: 3px 0; line-height: 1.75; }
  li > ul, li > ol { margin: 3px 0 3px 14px; }
  strong { color: #111827; font-weight: 600; }
  em { color: #4b5563; }

  table {
    width: 100%; border-collapse: collapse;
    margin: 12px 0; font-size: 11px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  }
  thead tr { background: linear-gradient(135deg, #312e81, #1e40af); color: #fff; }
  thead th { padding: 8px 10px; text-align: left; font-weight: 600; font-size: 10.5px; }
  tbody tr:nth-child(even) { background: #f5f3ff; }
  tbody tr:nth-child(odd) { background: #fff; }
  tbody td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; color: #374151; vertical-align: top; line-height: 1.6; }
  tbody tr:last-child td { border-bottom: none; }

  pre {
    background: #0f172a; border-radius: 6px;
    padding: 12px 16px; margin: 10px 0;
    border: 1px solid #1e293b;
  }
  pre code {
    font-family: 'SF Mono', Consolas, 'Courier New', monospace;
    font-size: 10.5px; color: #e2e8f0;
    line-height: 1.6; white-space: pre-wrap; word-break: break-all;
  }
  p code, li code {
    background: #ede9fe; color: #4f46e5;
    padding: 1px 5px; border-radius: 3px;
    font-size: 11px; font-family: 'SF Mono', Consolas, monospace; font-weight: 500;
  }
  blockquote {
    border-left: 4px solid #818cf8; background: #faf5ff;
    padding: 9px 13px; margin: 10px 0; border-radius: 0 5px 5px 0;
  }
  blockquote p { margin: 3px 0; color: #4b5563; font-style: italic; }
  hr { border: none; border-top: 1.5px solid #e5e7eb; margin: 20px 0; }

  .mermaid {
    background: #f8fafc; border: 1px solid #e2e8f0;
    border-radius: 8px; padding: 12px; margin: 12px 0;
    text-align: center; overflow: hidden;
  }
  .mermaid svg { max-width: 100%; max-height: 220mm; height: auto; display: block; margin: 0 auto; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

const MERMAID_INIT_SCRIPT = `
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      primaryColor: '#4f46e5', primaryTextColor: '#1f2937',
      primaryBorderColor: '#4f46e5', lineColor: '#6b7280',
      secondaryColor: '#eef2ff', tertiaryColor: '#f5f3ff',
      background: '#f8fafc', mainBkg: '#eef2ff',
      nodeBorder: '#4f46e5', clusterBkg: '#f5f3ff',
      titleColor: '#1e1b4b', edgeLabelBackground: '#fff', fontSize: '11px'
    },
    flowchart: { htmlLabels: true, curve: 'basis', useMaxWidth: true },
    securityLevel: 'loose'
  });
  document.querySelectorAll('pre code').forEach((el, i) => {
    const text = el.textContent.trim();
    if (/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)/.test(text)) {
      const pre = el.closest('pre');
      const div = document.createElement('div');
      div.className = 'mermaid'; div.id = 'mermaid-' + i; div.textContent = text;
      pre.parentNode.replaceChild(div, pre);
    }
  });
  mermaid.run();
`;

// ─── PDF generation ───────────────────────────────────────────────────────────

async function generateCoverPdf(browser, coverImagePath) {
  const coverBase64 = readFileSync(coverImagePath).toString('base64');
  const coverDataUrl = `data:image/png;base64,${coverBase64}`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 210mm; height: 297mm; overflow: hidden; }
  .cover { width: 210mm; height: 297mm; position: relative; overflow: hidden; }
  .cover-bg {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    background-image: url('${coverDataUrl}');
    background-size: cover; background-position: center top;
    filter: brightness(0.5);
  }
  .cover-overlay {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    background: linear-gradient(180deg, rgba(10,10,30,0.15) 0%, rgba(10,10,30,0.05) 30%, rgba(10,10,30,0.6) 65%, rgba(10,10,30,0.92) 100%);
  }
  .cover-bottom { position: absolute; bottom: 48px; left: 50px; right: 50px; z-index: 10; }
  .cover-tag {
    display: inline-block; background: rgba(99,102,241,0.9); color: #fff;
    font-size: 10px; letter-spacing: 2.5px; padding: 5px 14px;
    border-radius: 3px; margin-bottom: 18px; font-weight: 500;
    font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  }
  .cover-title {
    font-size: 34px; font-weight: 700; color: #fff; line-height: 1.2;
    margin-bottom: 8px; text-shadow: 0 2px 12px rgba(0,0,0,0.5);
    font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  }
  .cover-subtitle {
    font-size: 15px; color: rgba(255,255,255,0.75); margin-bottom: 24px;
    font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  }
  .cover-divider { width: 48px; height: 3px; background: linear-gradient(90deg, #818cf8, #60a5fa); border-radius: 2px; margin-bottom: 22px; }
  .cover-meta-row { display: flex; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 18px; }
  .cover-meta-item { flex: 1; padding-right: 18px; }
  .cover-meta-item + .cover-meta-item { padding-left: 18px; border-left: 1px solid rgba(255,255,255,0.15); }
  .cover-meta-label { font-size: 9px; color: rgba(255,255,255,0.45); letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 4px; font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; }
  .cover-meta-value { font-size: 12px; color: rgba(255,255,255,0.9); font-weight: 500; font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; }
</style>
</head>
<body>
<div class="cover">
  <div class="cover-bg"></div>
  <div class="cover-overlay"></div>
  <div class="cover-bottom">
    <div class="cover-tag">CONFIDENTIAL · INTERNAL USE ONLY</div>
    <div class="cover-title">${title}</div>
    ${subtitle ? `<div class="cover-subtitle">${subtitle}</div>` : ''}
    <div class="cover-divider"></div>
    <div class="cover-meta-row">
      <div class="cover-meta-item">
        <div class="cover-meta-label">版本</div>
        <div class="cover-meta-value">${version}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">日期</div>
        <div class="cover-meta-value">${date}</div>
      </div>
      ${author ? `<div class="cover-meta-item">
        <div class="cover-meta-label">作者</div>
        <div class="cover-meta-value">${author}</div>
      </div>` : ''}
    </div>
  </div>
</div>
</body>
</html>`;

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
  const pdfBytes = await page.pdf({
    format: 'A4', printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    displayHeaderFooter: false,
  });
  await page.close();
  return pdfBytes;
}

async function generateContentPdf(browser, mermaidJs) {
  const footerLeft = confidential ? 'CONFIDENTIAL · 仅供内部使用' : (author ? `作者：${author}` : '');
  const footerCenter = confidential && author ? `作者：${author}` : '';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<script>${mermaidJs}</script>
<style>${CONTENT_CSS}</style>
</head>
<body>
<div class="content">${htmlContent}</div>
<script>${MERMAID_INIT_SCRIPT}</script>
</body>
</html>`;

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });

  // Wait for Mermaid diagrams
  await page.waitForFunction(() => {
    const diagrams = document.querySelectorAll('.mermaid');
    if (diagrams.length === 0) return true;
    return Array.from(diagrams).every(d => d.querySelector('svg') !== null);
  }, { timeout: 30000 }).catch(() => console.warn('⚠️  Mermaid render timeout'));
  await new Promise(r => setTimeout(r, 2000));

  const pdfBytes = await page.pdf({
    format: 'A4', printBackground: true,
    margin: { top: '22mm', right: '18mm', bottom: '22mm', left: '18mm' },
    displayHeaderFooter: true,
    headerTemplate: `<div style="width:100%;font-size:9px;color:#9ca3af;padding:0 4mm;font-family:'PingFang SC','Microsoft YaHei',sans-serif;display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#6366f1;font-weight:600;">${title}</span>
      <span>${version} · ${date}</span>
    </div>`,
    footerTemplate: `<div style="width:100%;font-size:9px;color:#9ca3af;padding:0 4mm;font-family:'PingFang SC','Microsoft YaHei',sans-serif;display:flex;justify-content:space-between;align-items:center;position:relative;">
      <span>${footerLeft}</span>
      ${footerCenter ? `<span style="position:absolute;left:50%;transform:translateX(-50%);">${footerCenter}</span>` : ''}
      <span>第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</span>
    </div>`,
  });
  await page.close();
  return pdfBytes;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    let finalCoverImagePath = null;

    if (!noCover) {
      if (coverImage && existsSync(coverImage)) {
        finalCoverImagePath = coverImage;
        console.log(`🖼️  Using provided cover image: ${coverImage}`);
      } else {
        // Generate cover with Gemini
        const prompt = coverPrompt || `A professional document cover for "${title}". Modern tech illustration, clean gradients, indigo-purple-blue color palette, abstract geometric shapes, no text, 16:9 ratio.`;
        const tmpCover = `/tmp/md-to-pdf-cover-${Date.now()}.png`;
        finalCoverImagePath = await generateCoverWithGemini(prompt, tmpCover);
      }
    }

    const mermaidJs = findMermaidJs();

    let coverPdfBytes = null;
    if (finalCoverImagePath) {
      console.log('📑 Generating cover page...');
      coverPdfBytes = await generateCoverPdf(browser, finalCoverImagePath);
    }

    console.log('📝 Generating content pages...');
    const contentPdfBytes = await generateContentPdf(browser, mermaidJs);

    // Merge PDFs
    console.log('🔗 Merging PDFs...');
    const mergedDoc = await PDFDocument.create();

    if (coverPdfBytes) {
      const coverDoc = await PDFDocument.load(coverPdfBytes);
      const [coverPage] = await mergedDoc.copyPages(coverDoc, [0]);
      mergedDoc.addPage(coverPage);
    }

    const contentDoc = await PDFDocument.load(contentPdfBytes);
    const pageCount = contentDoc.getPageCount();
    const pages = await mergedDoc.copyPages(contentDoc, Array.from({ length: pageCount }, (_, i) => i));
    pages.forEach(p => mergedDoc.addPage(p));

    const mergedBytes = await mergedDoc.save();
    writeFileSync(outputPath, mergedBytes);

    const totalPages = (coverPdfBytes ? 1 : 0) + pageCount;
    console.log(`✅ PDF saved: ${outputPath} (${totalPages} pages, ${(mergedBytes.length / 1024 / 1024).toFixed(1)} MB)`);

  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
