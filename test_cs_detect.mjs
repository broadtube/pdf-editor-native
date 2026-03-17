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

// Load test PDF with known shapes
const [fc] = await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})
]);
await fc.accept([path.resolve('test_shapes_sample.pdf')]);
await new Promise(r=>setTimeout(r,3000));

// Click SHAPE_EDIT button
await page.evaluate(()=>{
  for(const b of document.querySelectorAll('button'))
    if(b.title?.includes('図形編集')){b.click();return;}
});
await new Promise(r=>setTimeout(r,3000));

// Check detected shapes
const result = await page.evaluate(()=>{
  const canvas=window.__AL.getCanvas();
  const objs=canvas.getObjects();
  const csShapes=objs.filter(o=>o.customType==='csShape');
  return{
    totalObjects:objs.length,
    csShapeCount:csShapes.length,
    csShapes:csShapes.map(o=>({
      type:o.type,
      left:Math.round(o.left),
      top:Math.round(o.top),
      width:Math.round(o.width||0),
      height:Math.round(o.height||0),
      stroke:o.stroke,
      fill:o.fill,
      customType:o.customType,
      shape:o._csOriginal?.shape
    }))
  };
});

console.log('\n=== Content Stream Shape Detection Results ===');
console.log('Total objects:', result.totalObjects);
console.log('CS shapes detected:', result.csShapeCount);
console.log('\nExpected shapes:');
console.log('  1. Red rect at ~(50,100) 150x100');
console.log('  2. Blue line from ~(250,100) to ~(400,200)');
console.log('  3. Green/light-blue filled ellipse at ~(50,242) 150x100');
console.log('  4. Orange filled triangle at ~(250,242) 150x100');
console.log('  5. Purple rounded rect at ~(50,512) 150x80');
console.log('  6. Teal wave curve at ~(300,502) 180x80');

console.log('\nDetected shapes:');
for(const s of result.csShapes){
  console.log(`  ${s.shape}(${s.type}): left=${s.left}, top=${s.top}, ${s.width}x${s.height}, stroke=${s.stroke}, fill=${s.fill}`);
}

// Verify approximate positions (PDF coords: origin bottom-left, screen: top-left)
// Page height 842: PDF y=642 → screen y=842-642-100=100, PDF y=450 → screen y=842-550=292
let passed=0,failed=0;
function test(cond,msg){cond?(passed++,console.log('  PASS:',msg)):(failed++,console.log('  FAIL:',msg));}

test(result.csShapeCount >= 6, `Detected ${result.csShapeCount} shapes (expected >=6)`);
const shapes = result.csShapes;
const rects = shapes.filter(s=>s.shape==='rect');
const lines = shapes.filter(s=>s.shape==='line');
const paths = shapes.filter(s=>s.shape==='path');
test(rects.length >= 1, `Found ${rects.length} rects`);
test(lines.length >= 1, `Found ${lines.length} lines`);
test(paths.length >= 1, `Found ${paths.length} paths (ellipse/curve/etc)`);

// Check colors
const redShape = shapes.find(s=>s.stroke==='#ff0000');
const blueShape = shapes.find(s=>s.stroke==='#0000ff');
const greenShape = shapes.find(s=>s.stroke==='#00ff00');
test(!!redShape, 'Found red stroked shape');
test(!!blueShape, 'Found blue stroked shape');
test(!!greenShape, 'Found green stroked shape');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
console.log('Page errors:', errors.length || 'none');
if(errors.length) errors.forEach(e=>console.log('  -',e));

await browser.close();
process.exit(failed > 0 ? 1 : 0);
