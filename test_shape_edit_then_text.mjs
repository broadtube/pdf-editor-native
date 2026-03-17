// テスト: 図形編集→テキスト編集で元の図形が再表示されないことを検証
// シナリオA: 図形編集→移動→テキスト編集（保存なし）→ 自動保存でPDFに反映
// シナリオB: 図形編集→移動→保存→テキスト編集 → PDFに反映済み
// シナリオC: 図形編集（変更なし）→テキスト編集 → 正常クリア
import puppeteer from 'puppeteer';
import path from 'path';

const browser = await puppeteer.launch({headless:true});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', err=>{errors.push(err.message);console.error('PAGE ERROR:',err.message);});
page.on('console', msg=>{
  const t=msg.text();
  if(t.includes('[PDF Editor]'))console.log('[LOG]',t);
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
    };
  });
}

// ===== シナリオC: 変更なしで切り替え（一番シンプルなケース）=====
console.log('=== シナリオC: 変更なしで切り替え ===\n');
await page.goto('http://localhost:8765/index.html',{waitUntil:'networkidle0',timeout:30000});
const [fc0]=await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})
]);
await fc0.accept([path.resolve('test_shapes_sample.pdf')]);
await new Promise(r=>setTimeout(r,3000));

console.log('--- C1: 図形編集モード ---');
await clickTool('図形編集');
let c=await getCounts();
test(c.csShape===6, `CS shapes detected: ${c.csShape}`);
test(c.csCover===6, `CS covers: ${c.csCover}`);

console.log('--- C2: テキスト編集に切替（変更なし） ---');
await clickTool('テキスト編集');
c=await getCounts();
test(c.csShape===0, `CS shapes cleared: ${c.csShape}`);
test(c.csCover===0, `CS covers cleared: ${c.csCover}`);

console.log('--- C3: 図形編集に戻る ---');
await clickTool('図形編集');
c=await getCounts();
test(c.csShape===6, `CS shapes re-detected: ${c.csShape}`);

console.log('--- C4: 選択に切替 ---');
await clickTool('選択');
c=await getCounts();
test(c.csShape===0, `CS shapes cleared: ${c.csShape}`);
test(c.csCover===0, `CS covers cleared: ${c.csCover}`);

// ===== シナリオA: 図形編集→移動→テキスト編集（保存なし）→自動保存 =====
console.log('\n=== シナリオA: 図形編集→移動→テキスト編集（自動保存検証） ===\n');
await page.goto('http://localhost:8765/index.html',{waitUntil:'networkidle0',timeout:30000});
const [fc1]=await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})
]);
await fc1.accept([path.resolve('test_shapes_sample.pdf')]);
await new Promise(r=>setTimeout(r,3000));

console.log('--- A1: 図形編集モード ---');
await clickTool('図形編集');

console.log('--- A2: 赤矩形を移動(+50,+50) ---');
const origRect=await page.evaluate(()=>{
  const canvas=window.__AL.getCanvas();
  const rect=canvas.getObjects().find(o=>o.customType==='csShape'&&o.type==='rect');
  if(!rect)return null;
  const orig={left:Math.round(rect.left),top:Math.round(rect.top)};
  rect.set({left:rect.left+50,top:rect.top+50});
  rect._isModified=true;
  rect.setCoords();
  canvas.renderAll();
  return orig;
});
console.log('  Original rect pos:', origRect);
c=await getCounts();
test(c.csModified===1, `1 modified shape`);

console.log('--- A3: テキスト編集に切替（保存なし→自動保存が走る）---');
await clickTool('テキスト編集');
c=await getCounts();
console.log('  Objects after switch:', JSON.stringify(c));
// 自動保存後: csShapeもcsCoverも全てクリア
test(c.csShape===0, `CS shapes cleared after auto-save: ${c.csShape}`);
test(c.csCover===0, `CS covers cleared after auto-save: ${c.csCover}`);

console.log('--- A4: 図形編集に戻る → 新PDFから再検出 ---');
await clickTool('図形編集');
c=await getCounts();
console.log('  Objects after return:', JSON.stringify(c));
test(c.csShape===6, `6 shapes re-detected from auto-saved PDF: ${c.csShape}`);

// 赤矩形が新しい位置にあることを確認
const shapes=await page.evaluate(()=>{
  const canvas=window.__AL.getCanvas();
  return canvas.getObjects().filter(o=>o.customType==='csShape').map(o=>({
    type:o.type,left:Math.round(o.left),top:Math.round(o.top),stroke:o.stroke
  }));
});
const redRect=shapes.find(s=>s.stroke==='#ff0000'&&s.type==='rect');
console.log('  Red rect after auto-save+reload:', redRect);
test(redRect&&redRect.left>=(origRect.left+40), `Red rect at new position left=${redRect?.left} (was ${origRect?.left})`);

// 他の図形も元の位置にあること確認
const blueShape=shapes.find(s=>s.stroke==='#0000ff');
test(blueShape&&Math.abs(blueShape.left-249)<10, `Blue line at original pos left=${blueShape?.left}`);

// ===== シナリオB: 図形編集→移動→保存→テキスト編集 =====
console.log('\n=== シナリオB: 図形編集→保存→テキスト編集 ===\n');
await page.goto('http://localhost:8765/index.html',{waitUntil:'networkidle0',timeout:30000});
const [fc2]=await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})
]);
await fc2.accept([path.resolve('test_shapes_sample.pdf')]);
await new Promise(r=>setTimeout(r,3000));

console.log('--- B1: 図形編集→赤矩形を移動 ---');
await clickTool('図形編集');
await page.evaluate(()=>{
  const canvas=window.__AL.getCanvas();
  const rect=canvas.getObjects().find(o=>o.customType==='csShape'&&o.type==='rect');
  if(rect){rect.set({left:rect.left+50,top:rect.top+50});rect._isModified=true;rect.setCoords();canvas.renderAll();}
});

console.log('--- B2: 保存ボタン押下 ---');
// doSaveをシミュレート（downloadは省略）
const saveOk=await page.evaluate(async()=>{
  try{
    const AL=window.__AL,PM=window.__PM,RL=window.__RL;
    const all=AL.getAllAnnotations();
    for(const[pg,d]of all)await PM.embedAnnotations(pg-1,d,AL._lastZoom);
    const bytes=await PM.save();
    await RL.loadDocument(bytes.buffer);await PM.load(bytes.buffer);
    AL.resetPages();
    return true;
  }catch(e){return e.message;}
});
test(saveOk===true, 'Save succeeded');
await new Promise(r=>setTimeout(r,2000));

console.log('--- B3: テキスト編集に切替 ---');
await clickTool('テキスト編集');
c=await getCounts();
console.log('  Objects:', JSON.stringify(c));
test(c.csShape===0, `No csShapes: ${c.csShape}`);
test(c.csCover===0, `No csCover: ${c.csCover}`);

console.log('--- B4: 図形編集に戻る ---');
await clickTool('図形編集');
c=await getCounts();
test(c.csShape>=6, `Shapes detected from saved PDF: ${c.csShape}`);
const shapes2=await page.evaluate(()=>{
  return window.__AL.getCanvas().getObjects().filter(o=>o.customType==='csShape').map(o=>({
    type:o.type,left:Math.round(o.left),top:Math.round(o.top),stroke:o.stroke
  }));
});
const redRect2=shapes2.find(s=>s.stroke==='#ff0000'&&s.type==='rect');
test(redRect2&&redRect2.left>=90, `Red rect at new pos after save: left=${redRect2?.left}`);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
console.log('Page errors:', errors.length || 'none');
if(errors.length) errors.forEach(e=>console.log('  -',e));
await browser.close();
process.exit(failed>0?1:0);
