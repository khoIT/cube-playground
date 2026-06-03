import { chromium } from 'playwright';
const f='file://'+process.cwd()+'/user-access-redesign.html';
const b=await chromium.launch();
const errs=[];
const p=await b.newPage({viewport:{width:1320,height:1400},deviceScaleFactor:2});
p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto(f);
// expand a couple sessions for the crop
await p.evaluate(()=>{['sess1'].forEach(id=>document.getElementById(id)?.classList.add('open'));});
const card=await p.$('.cols .stack:last-child .card');
await card.screenshot({path:'preview-sessions-zoom.png'});
// dark mode full
await p.evaluate(()=>document.documentElement.dataset.theme='dark');
await p.screenshot({path:'preview-dark.png',fullPage:true});
console.log('CONSOLE_ERRORS:',errs.length, errs.slice(0,5).join(' | '));
await b.close();
