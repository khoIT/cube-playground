import { chromium } from 'playwright';
const url = 'file://' + process.cwd() + '/vip-segment-care-flow.html';
const errs = [];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1320, height: 900 } });
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type()==='error') errs.push('CONSOLE: ' + m.text()); });
await p.goto(url); await p.waitForTimeout(1200);
// open seam modal
await p.getByText('Send to CS Care').first().click(); await p.waitForTimeout(400);
await p.screenshot({ path: 'beat1b-seam-modal.png' });
// confirm Model A
await p.getByText('Run playbooks · open queue').click(); await p.waitForTimeout(500);
await p.screenshot({ path: 'beat2-queue-modelA.png' });
// flip to Model B to capture the contrast
await p.getByRole('button', { name: 'Model B' }).click(); await p.waitForTimeout(300);
await p.screenshot({ path: 'beat2b-queue-modelB.png' });
// back to A, open a member (first row name)
await p.getByRole('button', { name: 'Model A' }).click(); await p.waitForTimeout(200);
await p.getByText('Nguyễn Văn Hùng').first().click(); await p.waitForTimeout(450);
await p.screenshot({ path: 'beat3-member360.png' });
// claim then treat
const claim = p.getByRole('button', { name: 'Claim' });
if (await claim.count()) { await claim.first().click(); await p.waitForTimeout(150); }
await p.getByRole('button', { name: 'Treat' }).first().click(); await p.waitForTimeout(400);
await p.screenshot({ path: 'beat4-treat-modal.png' });
await p.getByRole('button', { name: 'Mark treated' }).click(); await p.waitForTimeout(500);
await p.screenshot({ path: 'beat5-after-treat-drawer.png' });
// close drawer, simulate +14d
await p.keyboard.press('Escape');
await p.mouse.click(660, 12); await p.waitForTimeout(150);
const sim = p.getByText('Simulate +14d');
if (await sim.count()) { await sim.click(); await p.waitForTimeout(500); }
await p.screenshot({ path: 'beat5b-closed-loop.png' });
console.log(errs.length ? errs.join('\n') : 'NO_ERRORS');
await b.close();
