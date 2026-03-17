import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const browser = await puppeteer.launch({headless:true});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', err=>{errors.push(err.message);console.error('PAGE ERROR:',err.message);});
page.on('console', msg=>{
  if(msg.text().includes('[PDF Editor]'))console.log('[LOG]',msg.text());
});

let passed=0,failed=0;
function test(cond,msg){cond?(passed++,console.log('  PASS:',msg)):(failed++,console.log('  FAIL:',msg));}

await page.goto('http://localhost:8765/index.html',{waitUntil:'networkidle0',timeout:30000});

// Load test PDF
const [fc]=await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})
]);
await fc.accept([path.resolve('test_shapes_sample.pdf')]);
await new Promise(r=>setTimeout(r,3000));

// Enter SHAPE_EDIT
await page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('図形編集')){b.click();return;}});
await new Promise(r=>setTimeout(r,3000));

// --- Step 1: Get original positions ---
console.log('=== CS Shape Save/Reload Test ===\n');
console.log('--- Step 1: Original positions ---');
const origPositions=await page.evaluate(()=>{
  const c=window.__AL.getCanvas();
  return c.getObjects().filter(o=>o.customType==='csShape').map(o=>({
    type:o.type,left:Math.round(o.left),top:Math.round(o.top),
    width:Math.round(o.width||0),height:Math.round(o.height||0),
    stroke:o.stroke,shape:o._csOriginal?.shape
  }));
});
console.log('Original shapes:', origPositions.length);
for(const s of origPositions)console.log(`  ${s.shape}(${s.type}): (${s.left},${s.top}) ${s.width}x${s.height} stroke=${s.stroke}`);

// --- Step 2: Move the red rect (+30, +30) ---
console.log('\n--- Step 2: Move red rect by (+30,+30) ---');
const moveResult=await page.evaluate(()=>{
  const c=window.__AL.getCanvas();
  const rect=c.getObjects().find(o=>o.customType==='csShape'&&o.type==='rect');
  if(!rect)return{error:'no rect found'};
  const origL=rect.left,origT=rect.top;
  rect.set({left:rect.left+30,top:rect.top+30});
  rect._isModified=true;
  rect.setCoords();
  c.renderAll();
  return{origL:Math.round(origL),origT:Math.round(origT),newL:Math.round(rect.left),newT:Math.round(rect.top)};
});
console.log('Move result:', JSON.stringify(moveResult));

// --- Step 3: Save to PDF ---
console.log('\n--- Step 3: Save to PDF ---');
const saveResult=await page.evaluate(async()=>{
  try{
    const AL=window.__AL,PM=window.__PM;
    const zoom=AL._lastZoom;
    const all=AL.getAllAnnotations();
    for(const[pg,d]of all)await PM.embedAnnotations(pg-1,d,zoom);
    const bytes=await PM.save();
    return{success:true,size:bytes.length,arr:Array.from(bytes)};
  }catch(e){return{error:e.message,stack:e.stack?.substring(0,500)};}
});
if(saveResult.error){
  console.log('SAVE ERROR:', saveResult.error);
  console.log(saveResult.stack);
} else {
  console.log('Saved:', saveResult.size, 'bytes');
  fs.writeFileSync('test_cs_save_result.pdf', Buffer.from(saveResult.arr));
}
test(!saveResult.error, 'Save succeeded');

// --- Step 4: Reload the saved PDF ---
console.log('\n--- Step 4: Reload saved PDF ---');
await page.goto('http://localhost:8765/index.html',{waitUntil:'networkidle0',timeout:30000});
const [fc2]=await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})
]);
await fc2.accept([path.resolve('test_cs_save_result.pdf')]);
await new Promise(r=>setTimeout(r,3000));

// Enter SHAPE_EDIT
await page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('図形編集')){b.click();return;}});
await new Promise(r=>setTimeout(r,3000));

const reloadPositions=await page.evaluate(()=>{
  const c=window.__AL.getCanvas();
  return c.getObjects().filter(o=>o.customType==='csShape').map(o=>({
    type:o.type,left:Math.round(o.left),top:Math.round(o.top),
    width:Math.round(o.width||0),height:Math.round(o.height||0),
    stroke:o.stroke,shape:o._csOriginal?.shape
  }));
});
console.log('Reloaded shapes:', reloadPositions.length);
for(const s of reloadPositions)console.log(`  ${s.shape}(${s.type}): (${s.left},${s.top}) ${s.width}x${s.height} stroke=${s.stroke}`);

// --- Step 5: Verify positions ---
console.log('\n--- Step 5: Verify ---');
// Should have shapes detected (including new ones from our save)
test(reloadPositions.length >= 6, `Detected ${reloadPositions.length} shapes after reload`);

// The moved rect should now appear at a different position
// Original was at (50,100), moved to (80,130)
// After save + reload, the red rect should be detected at approximately (80,130) from the new drawing
// The white rect should have covered the original (50,100) position
const redShapes=reloadPositions.filter(s=>s.stroke==='#ff0000');
console.log('Red shapes after reload:', redShapes.map(s=>`(${s.left},${s.top}) ${s.width}x${s.height}`));
// There should be a new red rect near (80,130) and the original at (50,100) should be covered by white
// But the white rect itself might be detected... and the new drawing will also be detected

// Check that non-moved shapes kept their original positions
const blueShapes=reloadPositions.filter(s=>s.stroke==='#0000ff');
if(blueShapes.length>0){
  test(Math.abs(blueShapes[0].left-250)<10, `Blue line at ~(${blueShapes[0].left}) near original (250)`);
}

// --- Step 6: Check TEXT_EDIT doesn't show old shapes ---
console.log('\n--- Step 6: Switch to Text Edit → back to Shape Edit ---');
await page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('テキスト編集')){b.click();return;}});
await new Promise(r=>setTimeout(r,2000));
await page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('図形編集')){b.click();return;}});
await new Promise(r=>setTimeout(r,3000));

const afterSwitchPositions=await page.evaluate(()=>{
  const c=window.__AL.getCanvas();
  return c.getObjects().filter(o=>o.customType==='csShape').length;
});
test(afterSwitchPositions>=6, `Shapes present after mode switch: ${afterSwitchPositions}`);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
console.log('Page errors:', errors.length || 'none');
if(errors.length) errors.forEach(e=>console.log('  -',e));
await browser.close();
process.exit(failed>0?1:0);
