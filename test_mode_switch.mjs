import puppeteer from 'puppeteer';
import path from 'path';

const browser = await puppeteer.launch({headless:true});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', err=>{errors.push(err.message);console.error('PAGE ERROR:',err.message);});
page.on('console', msg=>{
  if(msg.text().includes('[PDF Editor]'))console.log('[LOG]',msg.text());
});
await page.goto('http://localhost:8765/index.html',{waitUntil:'networkidle0',timeout:30000});

const [fc] = await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})
]);
await fc.accept([path.resolve('test_shapes_sample.pdf')]);
await new Promise(r=>setTimeout(r,3000));

let passed=0,failed=0;
function test(cond,msg){cond?(passed++,console.log('  PASS:',msg)):(failed++,console.log('  FAIL:',msg));}

async function clickTool(titlePart){
  await page.evaluate((t)=>{
    for(const b of document.querySelectorAll('button'))
      if(b.title?.includes(t)){b.click();return;}
  },titlePart);
  await new Promise(r=>setTimeout(r,2000));
}

function getCounts(){
  return page.evaluate(()=>{
    const c=window.__AL.getCanvas();
    const objs=c.getObjects();
    return{
      total:objs.length,
      csShape:objs.filter(o=>o.customType==='csShape').length,
      csCover:objs.filter(o=>o.customType==='csCover').length,
      pdfText:objs.filter(o=>o.customType==='pdfText').length,
      shapeAnnot:objs.filter(o=>o.customType==='shapeAnnot').length,
    };
  });
}

console.log('=== Mode Switch Stability Test ===\n');

// --- Test 1: Initial state (select mode) ---
console.log('--- 1. Initial state (Select) ---');
let c = await getCounts();
console.log('  Objects:', JSON.stringify(c));
test(c.csShape===0, 'No CS shapes in select mode');
test(c.csCover===0, 'No CS covers in select mode');

// --- Test 2: Enter SHAPE_EDIT ---
console.log('\n--- 2. Enter Shape Edit ---');
await clickTool('図形編集');
c = await getCounts();
console.log('  Objects:', JSON.stringify(c));
test(c.csShape===6, `CS shapes: ${c.csShape} (expected 6)`);
test(c.csCover===6, `CS covers: ${c.csCover} (expected 6)`);

// --- Test 3: Switch to TEXT_EDIT ---
console.log('\n--- 3. Switch to Text Edit ---');
await clickTool('テキスト編集');
c = await getCounts();
console.log('  Objects:', JSON.stringify(c));
test(c.csShape===0, `CS shapes cleared: ${c.csShape}`);
test(c.csCover===0, `CS covers cleared: ${c.csCover}`);

// --- Test 4: Switch back to SHAPE_EDIT ---
console.log('\n--- 4. Back to Shape Edit ---');
await clickTool('図形編集');
c = await getCounts();
console.log('  Objects:', JSON.stringify(c));
test(c.csShape===6, `CS shapes reloaded: ${c.csShape}`);
test(c.csCover===6, `CS covers reloaded: ${c.csCover}`);

// --- Test 5: Switch to SELECT ---
console.log('\n--- 5. Switch to Select ---');
await clickTool('選択');
c = await getCounts();
console.log('  Objects:', JSON.stringify(c));
test(c.csShape===0, `CS shapes cleared: ${c.csShape}`);
test(c.csCover===0, `CS covers cleared: ${c.csCover}`);

// --- Test 6: Enter TEXT_EDIT ---
console.log('\n--- 6. Enter Text Edit ---');
await clickTool('テキスト編集');
c = await getCounts();
console.log('  Objects:', JSON.stringify(c));
test(c.csShape===0, `No CS shapes in text edit: ${c.csShape}`);

// --- Test 7: Switch to SELECT ---
console.log('\n--- 7. Text Edit → Select ---');
await clickTool('選択');
c = await getCounts();
console.log('  Objects:', JSON.stringify(c));
test(c.csShape===0 && c.pdfText===0, 'All edit objects cleared');

// --- Test 8: Rapid toggle SHAPE_EDIT on/off/on ---
console.log('\n--- 8. Rapid toggle Shape Edit ---');
await clickTool('図形編集');
await clickTool('選択');
await clickTool('図形編集');
c = await getCounts();
console.log('  Objects:', JSON.stringify(c));
test(c.csShape===6, `CS shapes after rapid toggle: ${c.csShape}`);
test(c.csCover===6, `CS covers after rapid toggle: ${c.csCover}`);

// --- Test 9: Rapid toggle TEXT_EDIT → SHAPE_EDIT → TEXT_EDIT ---
console.log('\n--- 9. Rapid TEXT→SHAPE→TEXT ---');
await clickTool('テキスト編集');
await clickTool('図形編集');
await clickTool('テキスト編集');
c = await getCounts();
console.log('  Objects:', JSON.stringify(c));
test(c.csShape===0, `No CS shapes after rapid switch: ${c.csShape}`);
test(c.csCover===0, `No CS covers after rapid switch: ${c.csCover}`);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
console.log('Page errors:', errors.length || 'none');
if(errors.length) errors.forEach(e=>console.log('  -',e));
await browser.close();
process.exit(failed > 0 ? 1 : 0);
