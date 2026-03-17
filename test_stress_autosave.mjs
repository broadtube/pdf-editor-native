// Stress test: multiple auto-save cycles and rapid mode switching
import puppeteer from 'puppeteer';
import path from 'path';

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

// ===== Load PDF =====
console.log('=== Stress Test: Multi-Cycle Auto-Save ===\n');
await page.goto('http://localhost:8765/index.html',{waitUntil:'networkidle0',timeout:30000});
const [fc]=await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})
]);
await fc.accept([path.resolve('test_shapes_sample.pdf')]);
await new Promise(r=>setTimeout(r,3000));

// ===== Step 1: Enter SHAPE_EDIT, get original position =====
console.log('--- Step 1: Enter SHAPE_EDIT, get original red rect position ---');
await clickTool('図形編集');
const origPos=await getRedRectPos();
console.log('  Original red rect:', origPos);
test(origPos!==null, `Red rect found at (${origPos?.left},${origPos?.top})`);

// ===== Step 2: Move red rect +30,+30 =====
console.log('\n--- Step 2: Move red rect +30,+30 ---');
const move1=await moveRedRect(30,30);
console.log('  Move 1:', JSON.stringify(move1));
test(move1?.after.left===origPos.left+30, `Moved to left=${move1?.after.left}`);

// ===== Step 3: Switch to TEXT_EDIT (triggers auto-save) =====
console.log('\n--- Step 3: Switch to TEXT_EDIT (triggers auto-save) ---');
logs.length=0;
await clickTool('テキスト編集');
const autoSave1=logs.some(l=>l.includes('CS図形編集を自動保存しました'));
test(autoSave1, 'Auto-save triggered on first TEXT_EDIT switch');
let c=await getCounts();
test(c.csShape===0, `CS shapes cleared: ${c.csShape}`);

// ===== Step 4: Switch back to SHAPE_EDIT, move red rect another +30,+30 =====
console.log('\n--- Step 4: Back to SHAPE_EDIT, move red rect another +30,+30 ---');
await clickTool('図形編集');
const posAfterFirstSave=await getRedRectPos();
console.log('  Red rect after first auto-save+reload:', posAfterFirstSave);
test(posAfterFirstSave?.left===origPos.left+30, `Red rect at (${posAfterFirstSave?.left},${posAfterFirstSave?.top}) after first save`);

const move2=await moveRedRect(30,30);
console.log('  Move 2:', JSON.stringify(move2));
test(move2?.after.left===origPos.left+60, `Moved to left=${move2?.after.left}`);

// ===== Step 5: Switch to SELECT (triggers auto-save again) =====
console.log('\n--- Step 5: Switch to SELECT (triggers second auto-save) ---');
logs.length=0;
await clickTool('選択');
const autoSave2=logs.some(l=>l.includes('CS図形編集を自動保存しました'));
test(autoSave2, 'Auto-save triggered on SELECT switch');
c=await getCounts();
test(c.csShape===0, `CS shapes cleared: ${c.csShape}`);

// ===== Step 6: Enter SHAPE_EDIT, verify red rect at original+60,+60 =====
console.log('\n--- Step 6: Enter SHAPE_EDIT, verify red rect at original+60,+60 ---');
await clickTool('図形編集');
const finalPos=await getRedRectPos();
console.log('  Red rect final position:', finalPos);
console.log(`  Expected: (${origPos.left+60},${origPos.top+60})`);
test(finalPos?.left===origPos.left+60, `Red rect left=${finalPos?.left} (expected ${origPos.left+60})`);
test(finalPos?.top===origPos.top+60, `Red rect top=${finalPos?.top} (expected ${origPos.top+60})`);
c=await getCounts();
test(c.csShape===6, `All 6 shapes still detected: ${c.csShape}`);

// ===== Step 7: Move a shape, then rapid switch: TEXT_EDIT -> SHAPE_EDIT -> TEXT_EDIT -> SELECT =====
console.log('\n--- Step 7: Move shape + rapid mode switching ---');
const move3=await moveRedRect(10,10);
console.log('  Move 3:', JSON.stringify(move3));

logs.length=0;
console.log('  Rapid switching: TEXT_EDIT -> SHAPE_EDIT -> TEXT_EDIT -> SELECT');
await clickTool('テキスト編集');
await clickTool('図形編集');
await clickTool('テキスト編集');
await clickTool('選択');

const autoSaveCount=logs.filter(l=>l.includes('CS図形編集を自動保存しました')).length;
console.log(`  Auto-save triggered ${autoSaveCount} time(s) during rapid switching`);
test(autoSaveCount>=1, `At least 1 auto-save during rapid switching: ${autoSaveCount}`);

// ===== Step 8: Enter SHAPE_EDIT, verify all shapes still detected correctly =====
console.log('\n--- Step 8: Enter SHAPE_EDIT, verify all shapes ---');
await clickTool('図形編集');
c=await getCounts();
console.log('  Counts:', JSON.stringify(c));
test(c.csShape===6, `All 6 shapes detected after rapid switching: ${c.csShape}`);
test(c.csCover===6, `All 6 covers present: ${c.csCover}`);

const allShapes=await page.evaluate(()=>{
  const c=window.__AL.getCanvas();
  return c.getObjects().filter(o=>o.customType==='csShape').map(o=>({
    type:o.type,left:Math.round(o.left),top:Math.round(o.top),stroke:o.stroke
  }));
});
console.log('  All shapes:');
for(const s of allShapes) console.log(`    ${s.type}: (${s.left},${s.top}) stroke=${s.stroke}`);

const finalRedRect=allShapes.find(s=>s.stroke==='#ff0000'&&s.type==='rect');
// After step 6 it was at orig+60, then step 7 moved +10 and auto-saved
const expectedLeft=origPos.left+70;
const expectedTop=origPos.top+70;
console.log(`  Red rect: (${finalRedRect?.left},${finalRedRect?.top}), expected ~(${expectedLeft},${expectedTop})`);
test(finalRedRect&&Math.abs(finalRedRect.left-expectedLeft)<=5, `Red rect left=${finalRedRect?.left} ~= ${expectedLeft}`);
test(finalRedRect&&Math.abs(finalRedRect.top-expectedTop)<=5, `Red rect top=${finalRedRect?.top} ~= ${expectedTop}`);

// Verify non-moved shapes are stable
const blueShape=allShapes.find(s=>s.stroke==='#0000ff');
test(blueShape&&Math.abs(blueShape.left-249)<=5, `Blue line stable at left=${blueShape?.left}`);

const greenShape=allShapes.find(s=>s.stroke==='#00ff00');
test(greenShape&&Math.abs(greenShape.left-49)<=5, `Green shape stable at left=${greenShape?.left}`);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
console.log('Page errors:', errors.length || 'none');
if(errors.length) errors.forEach(e=>console.log('  -',e));
await browser.close();
process.exit(failed>0?1:0);
