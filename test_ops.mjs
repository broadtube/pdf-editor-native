import puppeteer from 'puppeteer';
import path from 'path';
const browser = await puppeteer.launch({headless:true});
const page = await browser.newPage();
page.on('console',msg=>{if(msg.text().includes('[CS-DBG]'))console.log(msg.text());});
page.on('pageerror',err=>console.error('ERR:',err.message));
await page.goto('http://localhost:8765/index.html',{waitUntil:'networkidle0',timeout:30000});
const[fc]=await Promise.all([page.waitForFileChooser(),page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.title?.includes('開く')){b.click();return;}})]);
await fc.accept([path.resolve('test_cs_shapes.pdf')]);
await new Promise(r=>setTimeout(r,3000));

const result = await page.evaluate(async()=>{
  const pdfDoc = pdfjsLib.getDocument ? null : null;
  // Access RL's internal pdfDoc
  const pdfPage = await window.__RL_pdfDoc?.getPage(1);
  // We need direct access. Let me load via pdfjsLib directly
  const bytes = await window.__PM.save();
  const doc = await pdfjsLib.getDocument({data:bytes}).promise;
  const pg = await doc.getPage(1);
  const opList = await pg.getOperatorList();
  
  const OPS = pdfjsLib.OPS;
  const opNames = {};
  for(const[k,v] of Object.entries(OPS)) opNames[v]=k;
  
  const summary = [];
  for(let i=0;i<opList.fnArray.length;i++){
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    const name = opNames[fn]||('op_'+fn);
    // For constructPath, show sub-ops
    if(fn===91){
      summary.push({i,op:name,subOps:args[0]?.map(o=>opNames[o]||o),coords:args[1]?.slice(0,20)});
    } else {
      summary.push({i,op:name,args:args?.slice(0,6)});
    }
  }
  return summary;
});
console.log(JSON.stringify(result,null,1));
await browser.close();
