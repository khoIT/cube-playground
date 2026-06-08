import { chromium } from 'playwright';
const f='file://'+process.cwd()+'/VIP Care CS Console Flow.html';
const b=await chromium.launch(); const p=await b.newPage();
await p.setViewportSize({width:1440,height:1000});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(f); await p.waitForTimeout(400);
// queue (by VIP) via hint link
await p.getByText('Open VIP Action Queue →').click(); await p.waitForTimeout(350);
await p.screenshot({path:'02-queue-vip.png'});
// switch to by-playbook
await p.getByText('By Playbook',{exact:true}).click(); await p.waitForTimeout(300);
await p.screenshot({path:'03-queue-playbook.png'});
// open a member 360
await p.getByText('Open 360 →').first().click(); await p.waitForTimeout(350);
await p.screenshot({path:'04-member-care.png'});
console.log('pageerrors:',errs.length, errs.join('|'));
await b.close();
