// Comprehensive edge-case tests for PDF Editor
// Tests: annotation survival after auto-save, auto-save+manual save, page nav,
//        zoom during SHAPE_EDIT, no-mod auto-save, double auto-save
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const browser = await puppeteer.launch({headless:true});
const page = await browser.newPage();
const errors = [];
const logs = [];
page.on('pageerror', err=>{errors.push(err.message);console.error('PAGE ERROR:',err.message);});
page.on('console', msg=>{
  const t=msg.text();
  if(t.includes('[PDF Editor]')){logs.push(t);console.log('[LOG]',t);}
});
let passed=0,failed=0;
function test(cond,msg){cond?(passed++,console.log('  PASS:',msg)):(failed++,console.log('  FAIL:',msg));}

async function clickTool(titlePart){
  await page.evaluate((t)=>{
    for(const b of document.querySelectorAll('button'))
      if(b.title?.includes(t)){b.click();return;}
  },titlePart);
  await new Promise(r=>setTimeout(r,3000));
}
function getCounts(){
  return page.evaluate(()=>{
    const c=window.__AL.getCanvas();
    const objs=c.getObjects();
    return{
      total:objs.length,
      csShape:objs.filter(o=>o.customType==='csShape').length,
      csCover:objs.filter(o=>o.customType==='csCover').length,
      csModified:objs.filter(o=>o.customType==='csShape'&&o._isModified).length,
      pdfText:objs.filter(o=>o.customType==='pdfText').length,
      shapeAnnot:objs.filter(o=>o.customType==='shapeAnnot').length,
      userAnnot:objs.filter(o=>!o.customType||o.customType==='rect'||o.customType===undefined).length,
    };
  });
}
function getRedRectPos(){
  return page.evaluate(()=>{
    const c=window.__AL.getCanvas();
    const rect=c.getObjects().find(o=>o.customType==='csShape'&&o.type==='rect'&&o.stroke==='#ff0000');
    if(!rect)return null;
    return{left:Math.round(rect.left),top:Math.round(rect.top)};
  });
}
function moveRedRect(dx,dy){
  return page.evaluate(({dx,dy})=>{
    const c=window.__AL.getCanvas();
    const rect=c.getObjects().find(o=>o.customType==='csShape'&&o.type==='rect'&&o.stroke==='#ff0000');
    if(!rect)return null;
    const before={left:Math.round(rect.left),top:Math.round(rect.top)};
    rect.set({left:rect.left+dx,top:rect.top+dy});
    rect._isModified=true;
    rect.setCoords();
    c.renderAll();
    return{before,after:{left:Math.round(rect.left),top:Math.round(rect.top)}};
  },{dx,dy});
}

async function loadPdf(filePath){
  await page.goto('http://localhost:8765/index.html',{waitUntil:'networkidle0',timeout:30000});
  const [fc]=await Promise.all([
    page.waitForFileChooser(),
    page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})
  ]);
  await fc.accept([path.resolve(filePath)]);
  await new Promise(r=>setTimeout(r,3000));
}

// Helper: add a user-drawn rectangle annotation on the canvas via evaluate
async function addUserRect(x,y,w,h){
  return page.evaluate(({x,y,w,h})=>{
    const c=window.__AL.getCanvas();
    // Simulate what RECT tool does on mouseUp
    const rect=new fabric.Rect({
      left:x, top:y, width:w, height:h,
      stroke:'#ff00ff', strokeWidth:2, fill:'transparent',
      selectable:true, evented:true, opacity:1
    });
    // No customType set = regular user annotation (not csShape, not shapeAnnot)
    c.add(rect);
    c.setActiveObject(rect);
    c.renderAll();
    return {left:rect.left, top:rect.top, width:rect.width, height:rect.height};
  },{x,y,w,h});
}

// Count user-drawn annotations (objects without csShape/csCover/pdfText/freeTextAnnot/shapeAnnot customType)
function countUserAnnotations(){
  return page.evaluate(()=>{
    const c=window.__AL.getCanvas();
    const specialTypes=['csShape','csCover','pdfText','freeTextAnnot','shapeAnnot'];
    return c.getObjects().filter(o=>!o.customType||!specialTypes.includes(o.customType)).length;
  });
}

// ============================================================================
// TEST 1: Regular annotations survive auto-save
// ============================================================================
console.log('=== TEST 1: Regular annotations survive auto-save ===\n');
await loadPdf('test_shapes_sample.pdf');

// 1a: Add a user-drawn rectangle annotation (simulating rect tool)
console.log('--- 1a: Add user rectangle annotation ---');
const userRect=await addUserRect(300,300,80,60);
console.log('  Added user rect:', JSON.stringify(userRect));
let userCount=await countUserAnnotations();
test(userCount>=1, `User annotation exists on canvas: ${userCount}`);

// 1b: Enter SHAPE_EDIT mode
console.log('--- 1b: Enter SHAPE_EDIT ---');
await clickTool('図形編集');
let c=await getCounts();
test(c.csShape===6, `CS shapes detected: ${c.csShape}`);

// 1c: Move a csShape
console.log('--- 1c: Move a csShape ---');
const move1=await moveRedRect(20,20);
test(move1!==null, `Moved red rect to (${move1?.after.left},${move1?.after.top})`);

// 1d: Switch to TEXT_EDIT (triggers auto-save)
console.log('--- 1d: Switch to TEXT_EDIT (triggers auto-save) ---');
logs.length=0;
await clickTool('テキスト編集');
const autoSave1=logs.some(l=>l.includes('CS図形編集を自動保存しました'));
test(autoSave1, 'Auto-save triggered when switching to TEXT_EDIT');

// 1e: Switch to SELECT mode
console.log('--- 1e: Switch to SELECT ---');
await clickTool('選択');

// 1f: Check if user annotation survived
console.log('--- 1f: Check user annotation survival ---');
// After auto-save, AL.resetPages() is called which clears canvas.
// User annotations stored in pageData should be reloaded.
// We need to check if any non-csShape objects remain.
userCount=await countUserAnnotations();
console.log(`  User annotations remaining: ${userCount}`);
// NOTE: This is the key test - resetPages() in auto-save clears ALL canvas objects.
// If the annotation was saved to pageData before resetPages, it should be reloaded.
// If not, it will be lost. This test documents the actual behavior.
if(userCount>=1){
  test(true, 'User annotation SURVIVED auto-save (annotation preserved in pageData)');
} else {
  test(false, 'User annotation LOST after auto-save (resetPages wiped it)');
}

// ============================================================================
// TEST 2: Auto-save then manual save
// ============================================================================
console.log('\n=== TEST 2: Auto-save then manual save ===\n');
await loadPdf('test_shapes_sample.pdf');

// 2a: Enter SHAPE_EDIT, move a shape
console.log('--- 2a: Enter SHAPE_EDIT, move shape ---');
await clickTool('図形編集');
const origPos2=await getRedRectPos();
console.log('  Original red rect:', origPos2);
const move2=await moveRedRect(30,30);
test(move2!==null, `Moved red rect by +30,+30`);

// 2b: Switch to TEXT_EDIT (auto-save)
console.log('--- 2b: Switch to TEXT_EDIT (auto-save) ---');
logs.length=0;
await clickTool('テキスト編集');
const autoSave2=logs.some(l=>l.includes('CS図形編集を自動保存しました'));
test(autoSave2, 'Auto-save triggered');

// 2c: Switch to SELECT, then do manual save (simulating doSave)
console.log('--- 2c: Switch to SELECT, then manual save ---');
await clickTool('選択');

const saveResult=await page.evaluate(async()=>{
  try{
    const AL=window.__AL,PM=window.__PM,RL=window.__RL;
    const all=AL.getAllAnnotations();
    for(const[pg,d]of all)await PM.embedAnnotations(pg-1,d,AL._lastZoom);
    const bytes=await PM.save();
    // Don't call resetPages/reload here as doSave does it via setDocId
    return{success:true,size:bytes.length,arr:Array.from(bytes)};
  }catch(e){return{error:e.message,stack:e.stack?.substring(0,500)};}
});
if(saveResult.error){
  console.log('  SAVE ERROR:', saveResult.error);
  test(false, `Manual save failed: ${saveResult.error}`);
} else {
  console.log('  Saved:', saveResult.size, 'bytes');
  fs.writeFileSync(path.resolve('test_edge_save_result.pdf'), Buffer.from(saveResult.arr));
  test(true, `Manual save succeeded (${saveResult.size} bytes)`);

  // 2d: Reload saved PDF and verify shape at new position
  console.log('--- 2d: Reload saved PDF, verify shape position ---');
  await loadPdf('test_edge_save_result.pdf');
  await clickTool('図形編集');
  const reloadPos=await getRedRectPos();
  console.log(`  Red rect after reload: ${JSON.stringify(reloadPos)}`);
  console.log(`  Expected near: (${origPos2.left+30},${origPos2.top+30})`);
  if(reloadPos){
    test(Math.abs(reloadPos.left-(origPos2.left+30))<=10, `Red rect left=${reloadPos.left} ~= ${origPos2.left+30}`);
    test(Math.abs(reloadPos.top-(origPos2.top+30))<=10, `Red rect top=${reloadPos.top} ~= ${origPos2.top+30}`);
  } else {
    test(false, 'Red rect not found after reload');
    test(false, 'Red rect position check skipped');
  }
  c=await getCounts();
  test(c.csShape>=6, `All shapes detected after reload: ${c.csShape}`);
}

// ============================================================================
// TEST 3: Page navigation during SHAPE_EDIT
// ============================================================================
console.log('\n=== TEST 3: Page navigation during SHAPE_EDIT ===\n');
// Use test_shapes_sample.pdf (1 page) - we test what happens when we try navigating
// If it's single page, verify that re-entering same page still detects shapes
await loadPdf('test_shapes_sample.pdf');

// 3a: Enter SHAPE_EDIT on page 1
console.log('--- 3a: Enter SHAPE_EDIT on page 1 ---');
await clickTool('図形編集');
c=await getCounts();
const shapesPage1=c.csShape;
test(shapesPage1===6, `Page 1: ${shapesPage1} shapes detected`);

// 3b: Get current page info
const pageInfo=await page.evaluate(()=>{
  return{curPage:window.__curPage||1, total:window.__total||1};
});
console.log(`  Page info: page ${pageInfo.curPage} of ${pageInfo.total}`);

if(pageInfo.total>=2){
  // 3c: Navigate to page 2
  console.log('--- 3c: Navigate to page 2 ---');
  await page.evaluate(()=>{
    // Click next page button or set page
    const btns=document.querySelectorAll('button');
    for(const b of btns)if(b.title?.includes('次')|| b.textContent?.includes('▶')){b.click();return;}
  });
  await new Promise(r=>setTimeout(r,3000));

  // 3d: Navigate back to page 1
  console.log('--- 3d: Navigate back to page 1 ---');
  await page.evaluate(()=>{
    const btns=document.querySelectorAll('button');
    for(const b of btns)if(b.title?.includes('前')||b.textContent?.includes('◀')){b.click();return;}
  });
  await new Promise(r=>setTimeout(r,3000));

  // 3e: Verify shapes still detected
  c=await getCounts();
  test(c.csShape===6, `Shapes after page nav round-trip: ${c.csShape}`);
} else {
  // Single-page PDF: test switching away and back
  console.log('--- 3c: Single page PDF - switch to SELECT and back to SHAPE_EDIT ---');
  await clickTool('選択');
  await clickTool('図形編集');
  c=await getCounts();
  test(c.csShape===6, `Shapes after mode round-trip: ${c.csShape}`);

  // Also test: leave SHAPE_EDIT, re-enter, shapes still there
  console.log('--- 3d: Exit SHAPE_EDIT, re-enter ---');
  await clickTool('テキスト編集');
  await clickTool('図形編集');
  c=await getCounts();
  test(c.csShape===6, `Shapes after TEXT_EDIT round-trip: ${c.csShape}`);
  test(c.csCover===6, `Covers after TEXT_EDIT round-trip: ${c.csCover}`);
}

// ============================================================================
// TEST 4: Zoom change during SHAPE_EDIT
// ============================================================================
console.log('\n=== TEST 4: Zoom change during SHAPE_EDIT ===\n');
await loadPdf('test_shapes_sample.pdf');

// 4a: Enter SHAPE_EDIT at default zoom
console.log('--- 4a: Enter SHAPE_EDIT at default zoom ---');
await clickTool('図形編集');
c=await getCounts();
test(c.csShape===6, `Shapes at zoom=1: ${c.csShape}`);
const shapesAtZoom1=await page.evaluate(()=>{
  const c=window.__AL.getCanvas();
  return c.getObjects().filter(o=>o.customType==='csShape').map(o=>({
    type:o.type,left:Math.round(o.left),top:Math.round(o.top),stroke:o.stroke
  }));
});
console.log('  Shapes at zoom 1:');
for(const s of shapesAtZoom1) console.log(`    ${s.type}: (${s.left},${s.top}) stroke=${s.stroke}`);

// 4b: Change zoom via AL.resize (simulating zoom handler)
console.log('--- 4b: Change zoom to 1.5 ---');
const zoomResult=await page.evaluate(()=>{
  const AL=window.__AL;
  const canvas=AL.getCanvas();
  // Get current dimensions
  const w=canvas.getWidth();
  const h=canvas.getHeight();
  const newZoom=1.5;
  const oldZoom=AL._lastZoom||1;
  const ratio=newZoom/oldZoom;
  // Resize with new zoom
  AL.resize(w*ratio, h*ratio, newZoom);
  return{oldZoom,newZoom,newWidth:Math.round(canvas.getWidth()),newHeight:Math.round(canvas.getHeight())};
});
console.log(`  Zoom changed: ${zoomResult.oldZoom} -> ${zoomResult.newZoom}`);
await new Promise(r=>setTimeout(r,1000));

// 4c: Verify shapes are still present and approximately correctly positioned
c=await getCounts();
test(c.csShape===6, `Shapes still present at zoom=1.5: ${c.csShape}`);

const shapesAtZoom15=await page.evaluate(()=>{
  const c=window.__AL.getCanvas();
  return c.getObjects().filter(o=>o.customType==='csShape').map(o=>({
    type:o.type,left:Math.round(o.left),top:Math.round(o.top),stroke:o.stroke
  }));
});
console.log('  Shapes at zoom 1.5:');
for(const s of shapesAtZoom15) console.log(`    ${s.type}: (${s.left},${s.top}) stroke=${s.stroke}`);

// Verify positions scaled approximately by 1.5
const redAtZ1=shapesAtZoom1.find(s=>s.stroke==='#ff0000');
const redAtZ15=shapesAtZoom15.find(s=>s.stroke==='#ff0000');
if(redAtZ1&&redAtZ15){
  const expectedLeft=Math.round(redAtZ1.left*1.5);
  const expectedTop=Math.round(redAtZ1.top*1.5);
  console.log(`  Red rect: zoom1=(${redAtZ1.left},${redAtZ1.top}) zoom1.5=(${redAtZ15.left},${redAtZ15.top}) expected~(${expectedLeft},${expectedTop})`);
  test(Math.abs(redAtZ15.left-expectedLeft)<=5, `Red rect left scaled: ${redAtZ15.left} ~= ${expectedLeft}`);
  test(Math.abs(redAtZ15.top-expectedTop)<=5, `Red rect top scaled: ${redAtZ15.top} ~= ${expectedTop}`);
} else {
  test(false, 'Red rect not found at zoom 1 or 1.5');
  test(false, 'Red rect zoom scaling check skipped');
}

// ============================================================================
// TEST 5: Auto-save with no csShapes modified (enter/leave without editing)
// ============================================================================
console.log('\n=== TEST 5: Auto-save with no csShapes modified ===\n');
await loadPdf('test_shapes_sample.pdf');

// 5a: Enter SHAPE_EDIT
console.log('--- 5a: Enter SHAPE_EDIT ---');
await clickTool('図形編集');
c=await getCounts();
test(c.csShape===6, `Shapes detected: ${c.csShape}`);

// 5b: Switch to SELECT without any modifications
console.log('--- 5b: Switch to SELECT (no modifications) ---');
logs.length=0;
await clickTool('選択');
const noAutoSave=!logs.some(l=>l.includes('CS図形編集を自動保存しました'));
test(noAutoSave, 'No auto-save log when no shapes modified');
c=await getCounts();
test(c.csShape===0, `CS shapes cleared on exit: ${c.csShape}`);

// 5c: Enter SHAPE_EDIT again
console.log('--- 5c: Enter SHAPE_EDIT again ---');
await clickTool('図形編集');
c=await getCounts();
test(c.csShape===6, `All 6 shapes re-detected (no data loss): ${c.csShape}`);
test(c.csCover===6, `All 6 covers present: ${c.csCover}`);

// 5d: Also test entering TEXT_EDIT without modification
console.log('--- 5d: Enter TEXT_EDIT without shape modification ---');
logs.length=0;
await clickTool('選択');
const noAutoSave2=!logs.some(l=>l.includes('CS図形編集を自動保存しました'));
test(noAutoSave2, 'Still no auto-save on second exit without modifications');

// 5e: Final check - shapes still intact
console.log('--- 5e: Final SHAPE_EDIT re-entry ---');
await clickTool('図形編集');
c=await getCounts();
test(c.csShape===6, `Shapes still 6 after multiple no-mod cycles: ${c.csShape}`);

// ============================================================================
// TEST 6: Double auto-save (edit, switch, edit again, switch again)
// ============================================================================
console.log('\n=== TEST 6: Double auto-save ===\n');
await loadPdf('test_shapes_sample.pdf');

// 6a: Enter SHAPE_EDIT, get original position
console.log('--- 6a: Enter SHAPE_EDIT, get original position ---');
await clickTool('図形編集');
const origPos6=await getRedRectPos();
console.log('  Original red rect:', origPos6);
test(origPos6!==null, `Red rect found at (${origPos6?.left},${origPos6?.top})`);

// 6b: Move red rect by +20,+20
console.log('--- 6b: Move red rect +20,+20 ---');
const move6a=await moveRedRect(20,20);
test(move6a!==null, `Moved to (${move6a?.after.left},${move6a?.after.top})`);

// 6c: Switch to SELECT (auto-save #1)
console.log('--- 6c: Switch to SELECT (auto-save #1) ---');
logs.length=0;
await clickTool('選択');
const as1=logs.some(l=>l.includes('CS図形編集を自動保存しました'));
test(as1, 'Auto-save #1 triggered');

// 6d: Enter SHAPE_EDIT, verify red rect at new position
console.log('--- 6d: Enter SHAPE_EDIT, verify position after auto-save #1 ---');
await clickTool('図形編集');
const posAfterAS1=await getRedRectPos();
console.log(`  Red rect after auto-save #1: ${JSON.stringify(posAfterAS1)}`);
console.log(`  Expected: (${origPos6.left+20},${origPos6.top+20})`);
test(posAfterAS1&&Math.abs(posAfterAS1.left-(origPos6.left+20))<=5,
  `Red rect left after AS1: ${posAfterAS1?.left} ~= ${origPos6.left+20}`);
test(posAfterAS1&&Math.abs(posAfterAS1.top-(origPos6.top+20))<=5,
  `Red rect top after AS1: ${posAfterAS1?.top} ~= ${origPos6.top+20}`);

// Also verify other shapes not affected
const otherShapesAS1=await page.evaluate(()=>{
  const c=window.__AL.getCanvas();
  return c.getObjects().filter(o=>o.customType==='csShape').map(o=>({
    type:o.type,left:Math.round(o.left),top:Math.round(o.top),stroke:o.stroke
  }));
});
const blueAS1=otherShapesAS1.find(s=>s.stroke==='#0000ff');
const greenAS1=otherShapesAS1.find(s=>s.stroke==='#00ff00');

// 6e: Move red rect by another +20,+20
console.log('--- 6e: Move red rect another +20,+20 ---');
const move6b=await moveRedRect(20,20);
test(move6b!==null, `Moved to (${move6b?.after.left},${move6b?.after.top})`);

// 6f: Switch to SELECT (auto-save #2)
console.log('--- 6f: Switch to SELECT (auto-save #2) ---');
logs.length=0;
await clickTool('選択');
const as2=logs.some(l=>l.includes('CS図形編集を自動保存しました'));
test(as2, 'Auto-save #2 triggered');

// 6g: Enter SHAPE_EDIT, verify red rect at original+40,+40
console.log('--- 6g: Enter SHAPE_EDIT, verify position after auto-save #2 ---');
await clickTool('図形編集');
const posAfterAS2=await getRedRectPos();
console.log(`  Red rect after auto-save #2: ${JSON.stringify(posAfterAS2)}`);
console.log(`  Expected: (${origPos6.left+40},${origPos6.top+40})`);
test(posAfterAS2&&Math.abs(posAfterAS2.left-(origPos6.left+40))<=5,
  `Red rect left after AS2: ${posAfterAS2?.left} ~= ${origPos6.left+40}`);
test(posAfterAS2&&Math.abs(posAfterAS2.top-(origPos6.top+40))<=5,
  `Red rect top after AS2: ${posAfterAS2?.top} ~= ${origPos6.top+40}`);

// 6h: Verify other shapes unchanged
console.log('--- 6h: Verify other shapes unchanged ---');
const otherShapesAS2=await page.evaluate(()=>{
  const c=window.__AL.getCanvas();
  return c.getObjects().filter(o=>o.customType==='csShape').map(o=>({
    type:o.type,left:Math.round(o.left),top:Math.round(o.top),stroke:o.stroke
  }));
});
c=await getCounts();
test(c.csShape===6, `All 6 shapes still present: ${c.csShape}`);

const blueAS2=otherShapesAS2.find(s=>s.stroke==='#0000ff');
const greenAS2=otherShapesAS2.find(s=>s.stroke==='#00ff00');

if(blueAS1&&blueAS2){
  test(Math.abs(blueAS2.left-blueAS1.left)<=3, `Blue shape stable: left=${blueAS2.left} (was ${blueAS1.left})`);
  test(Math.abs(blueAS2.top-blueAS1.top)<=3, `Blue shape stable: top=${blueAS2.top} (was ${blueAS1.top})`);
} else {
  test(false, 'Blue shape not found for comparison');
  test(false, 'Blue shape stability check skipped');
}
if(greenAS1&&greenAS2){
  test(Math.abs(greenAS2.left-greenAS1.left)<=3, `Green shape stable: left=${greenAS2.left} (was ${greenAS1.left})`);
  test(Math.abs(greenAS2.top-greenAS1.top)<=3, `Green shape stable: top=${greenAS2.top} (was ${greenAS1.top})`);
} else {
  test(false, 'Green shape not found for comparison');
  test(false, 'Green shape stability check skipped');
}

// ============================================================================
// SUMMARY
// ============================================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`=== FINAL RESULTS: ${passed} passed, ${failed} failed ===`);
console.log(`${'='.repeat(60)}`);
console.log('Page errors:', errors.length || 'none');
if(errors.length) errors.forEach(e=>console.log('  -',e));

await browser.close();
process.exit(failed>0?1:0);
