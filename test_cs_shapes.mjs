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
await page.goto('http://localhost:8765/index.html',{waitUntil:'networkidle0',timeout:30000});

// Load PDF
const [fc] = await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})
]);
await fc.accept([path.resolve('test_text.pdf')]);
await new Promise(r=>setTimeout(r,3000));

// Draw shapes and save
console.log('\n--- Step 1: Draw shapes and save ---');
const saveResult = await page.evaluate(async ()=>{
  const AL=window.__AL,PM=window.__PM,canvas=AL.getCanvas();
  const defs=[
    {tool:'rect',x:50,y:100,x2:200,y2:200},
    {tool:'line',x:250,y:100,x2:400,y2:200},
    {tool:'ellipse',x:50,y:250,x2:200,y2:350},
    {tool:'triangle',x:250,y:250,x2:400,y2:350},
  ];
  for(const d of defs){
    AL.setTool(d.tool);
    canvas.fire('mouse:down',{e:{clientX:d.x,clientY:d.y,preventDefault:()=>{},stopPropagation:()=>{}},pointer:{x:d.x,y:d.y},target:null});
    canvas.fire('mouse:move',{e:{clientX:d.x2,clientY:d.y2,preventDefault:()=>{},stopPropagation:()=>{}},pointer:{x:d.x2,y:d.y2}});
    canvas.fire('mouse:up',{e:{preventDefault:()=>{},stopPropagation:()=>{}}});
  }
  const zoom=AL._lastZoom;
  const all=AL.getAllAnnotations();
  for(const[pg,d] of all) await PM.embedAnnotations(pg-1,d,zoom);
  const bytes=await PM.save();
  return{size:bytes.length,arr:Array.from(bytes)};
});
fs.writeFileSync('test_cs_shapes.pdf',Buffer.from(saveResult.arr));
console.log('Created test_cs_shapes.pdf:',saveResult.size,'bytes');

// Reload with the new PDF
console.log('\n--- Step 2: Reload and detect CS shapes ---');
await page.goto('http://localhost:8765/index.html',{waitUntil:'networkidle0',timeout:30000});
const [fc2] = await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})
]);
await fc2.accept([path.resolve('test_cs_shapes.pdf')]);
await new Promise(r=>setTimeout(r,3000));

// Click SHAPE_EDIT button via UI
await page.evaluate(()=>{
  for(const b of document.querySelectorAll('button'))
    if(b.title?.includes('図形編集')){b.click();return;}
});
await new Promise(r=>setTimeout(r,3000));

// Check results
const result = await page.evaluate(()=>{
  const canvas=window.__AL.getCanvas();
  const objs=canvas.getObjects();
  const csShapes=objs.filter(o=>o.customType==='csShape');
  return{
    totalObjects:objs.length,
    csShapeCount:csShapes.length,
    csShapes:csShapes.map(o=>({type:o.type,left:Math.round(o.left),top:Math.round(o.top),customType:o.customType,hasOriginal:o._csOriginal?true:false}))
  };
});
console.log('\nContent stream shape detection:', JSON.stringify(result, null, 2));

// Test modification and save
if(result.csShapeCount > 0){
  console.log('\n--- Step 3: Modify a CS shape and save ---');
  const modResult = await page.evaluate(async()=>{
    try{
      const AL=window.__AL,PM=window.__PM,canvas=AL.getCanvas();
      const csShape=canvas.getObjects().find(o=>o.customType==='csShape');
      if(!csShape)return{error:'no csShape'};
      csShape.set({left:csShape.left+50,top:csShape.top+50});
      csShape._isModified=true;
      canvas.renderAll();
      const zoom=AL._lastZoom;
      const all=AL.getAllAnnotations();
      for(const[pg,d] of all) await PM.embedAnnotations(pg-1,d,zoom);
      const bytes=await PM.save();
      return{success:true,size:bytes.length};
    }catch(e){return{error:e.message,stack:e.stack?.substring(0,300)};}
  });
  console.log('Modify+Save result:', JSON.stringify(modResult));
}

console.log('\nPage errors:', errors.length || 'none');
if(errors.length) errors.forEach(e=>console.log('  -',e));
await browser.close();
