import puppeteer from 'puppeteer';
import path from 'path';

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('console', msg => {
  const text = msg.text();
  if (text.includes('[PDF Editor]') || text.includes('Error') || text.includes('error')) console.log('[LOG]', text);
});
page.on('pageerror', err => { errors.push(err.message); console.error('[PAGE ERROR]', err.message); });

let passed = 0, failed = 0;
function test(cond, msg) { cond ? (passed++, console.log('  PASS:', msg)) : (failed++, console.log('  FAIL:', msg)); }

console.log('=== Text Add & Format Test ===\n');
await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle0', timeout: 30000 });

// Load PDF
const [fc] = await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (b.title?.includes('開く')) { b.click(); return; } })
]);
await fc.accept([path.resolve('test_text.pdf')]);
await new Promise(r => setTimeout(r, 4000));

// --- Test 1: TEXT tool add text ---
console.log('--- Test 1: Add text with TEXT tool ---');
// Switch to TEXT tool
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) if (b.title?.includes('テキスト追加')) { b.click(); return; }
});
await new Promise(r => setTimeout(r, 500));

// Click on canvas to add text
const addResult = await page.evaluate(() => {
  const AL = window.__AL;
  const canvas = AL.getCanvas();
  if (!canvas) return { error: 'no canvas' };

  // Simulate mousedown on canvas at position (200, 300)
  const before = canvas.getObjects().length;
  // Trigger mouse:down through canvas
  canvas.fire('mouse:down', {
    e: { clientX: 200, clientY: 300, preventDefault: ()=>{}, stopPropagation: ()=>{} },
    pointer: { x: 200, y: 300 },
    target: null
  });

  const after = canvas.getObjects().length;
  const lastObj = canvas.getObjects()[after - 1];

  return {
    beforeCount: before,
    afterCount: after,
    added: after > before,
    lastObj: lastObj ? {
      type: lastObj.type,
      text: lastObj.text,
      left: lastObj.left,
      top: lastObj.top,
      fontSize: lastObj.fontSize,
      fill: lastObj.fill,
      stroke: lastObj.stroke,
      _pdfFontKey: lastObj._pdfFontKey,
      editable: lastObj.editable
    } : null
  };
});
console.log('  Result:', JSON.stringify(addResult, null, 2));
test(addResult.added, 'Text object added to canvas');
test(addResult.lastObj?.text === 'テキスト', 'Default text is "テキスト"');
test(addResult.lastObj?._pdfFontKey, 'Has _pdfFontKey: ' + addResult.lastObj?._pdfFontKey);
test(!addResult.lastObj?.stroke, 'No stroke on new text (stroke=' + addResult.lastObj?.stroke + ')');

// --- Test 2: Stroke not set on text when changing color ---
console.log('\n--- Test 2: Color change does NOT set stroke on text ---');
const colorResult = await page.evaluate(() => {
  const AL = window.__AL;
  const canvas = AL.getCanvas();
  const textObj = canvas.getObjects().find(o => ['textbox','Textbox'].includes(o.type));
  if (!textObj) return { error: 'no text obj' };

  canvas.setActiveObject(textObj);
  AL.setProps({ textColor: '#0000ff' });

  return {
    fill: textObj.fill,
    stroke: textObj.stroke,
    fillCorrect: textObj.fill === '#0000ff',
    strokeNull: !textObj.stroke
  };
});
console.log('  Color result:', JSON.stringify(colorResult));
test(colorResult.fillCorrect, 'Fill set to blue');
test(colorResult.strokeNull, 'Stroke is null/empty (not set on text)');

// --- Test 3: Bold/Italic/Underline/Linethrough ---
console.log('\n--- Test 3: Format toggles ---');
const fmtResult = await page.evaluate(() => {
  const AL = window.__AL;
  const canvas = AL.getCanvas();
  const textObj = canvas.getActiveObject();
  if (!textObj) return { error: 'no active obj' };

  AL.setProps({ fontWeight: 'bold' });
  AL.setProps({ fontStyle: 'italic' });
  AL.setProps({ underline: true });
  AL.setProps({ linethrough: true });

  return {
    fontWeight: textObj.fontWeight,
    fontStyle: textObj.fontStyle,
    underline: textObj.underline,
    linethrough: textObj.linethrough,
    stroke: textObj.stroke,
  };
});
test(fmtResult.fontWeight === 'bold', 'Bold applied');
test(fmtResult.fontStyle === 'italic', 'Italic applied');
test(fmtResult.underline === true, 'Underline applied');
test(fmtResult.linethrough === true, 'Linethrough applied');
test(!fmtResult.stroke, 'Still no stroke after formatting');

// --- Test 4: Save formatted text ---
console.log('\n--- Test 4: Save formatted text ---');
const saveResult = await page.evaluate(async () => {
  try {
    const AL = window.__AL;
    const PM = window.__PM;
    const zoom = AL._lastZoom;
    const all = AL.getAllAnnotations();
    for (const [pg, d] of all) await PM.embedAnnotations(pg - 1, d, zoom);
    const bytes = await PM.save();
    return { success: true, size: bytes.length };
  } catch (e) {
    return { error: e.message, stack: e.stack?.substring(0, 300) };
  }
});
test(!saveResult.error, 'Save formatted text: ' + (saveResult.error || saveResult.size + ' bytes'));

// --- Test 5: Page errors ---
console.log('\n--- Test 5: No page errors ---');
test(errors.length === 0, 'No page errors' + (errors.length ? ': ' + errors.join('; ') : ''));

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
