import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
const password='Browser-validation-123';
async function open(page:Page){
 await expect(page.locator('.application-stage')).toBeVisible();
 if(await page.getByRole('dialog').count()){await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);}
 if(!await page.getByRole('button',{name:'账户',exact:true}).count())await page.getByRole('button',{name:'返回首页',exact:true}).click();
 await page.getByRole('button',{name:'账户',exact:true}).click();await expect(page.getByRole('dialog',{name:'账户与云端保存'})).toBeVisible();
}
async function accountState(page:Page,text:string){await open(page);await expect(page.getByLabel('账户状态')).toContainText(text);await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'账户',exact:true})).toBeFocused();}
async function register(page:Page,username:string){await open(page);await page.getByRole('button',{name:'注册并带入游客数据'}).click();await page.getByLabel('用户名',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'注册并迁移',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await accountState(page,username);}
async function login(page:Page,username:string){await open(page);await page.getByLabel('用户名',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录并下载',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}
async function chain(page:Page,name='阅读'){await page.getByRole('button',{name:'新建链条',exact:true}).click();await page.getByLabel('链名称',{exact:true}).fill(name);await page.getByRole('radio',{name:'戴上耳机',exact:true}).check();await page.getByRole('button',{name:'创建',exact:true}).click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();}

test('游客任务迁移、声音同步、重开只读恢复和离线计时',async({page,context},info)=>{
 const username=`a_${info.project.name}_${Date.now()}`;await page.goto('/');await chain(page);
 await page.getByRole('button',{name:'开始',exact:true}).click();await page.getByLabel('任务内容',{exact:true}).fill('阅读论文');await page.getByRole('spinbutton',{name:'专注分钟',exact:true}).focus();await page.keyboard.press('ArrowDown');await page.getByRole('button',{name:'开始专注',exact:true}).click();
 await expect(page.getByLabel('有效专注时间',{exact:true})).toBeVisible();await register(page,username);
 await page.getByRole('button',{name:'返回当前任务',exact:true}).click();await expect(page.getByLabel('有效专注时间',{exact:true})).toBeVisible();
 const requests:string[]=[];page.on('request',r=>{if(r.url().includes('/test-api/'))requests.push(r.url());});await page.reload();await accountState(page,'云端保存已就绪');expect(requests.some(x=>x.endsWith('/snapshot'))).toBe(false);
 await page.getByRole('button',{name:'返回当前任务',exact:true}).click();await expect(page.getByRole('button',{name:'账户',exact:true})).toHaveCount(0);await context.setOffline(true);await expect(page.getByLabel('账户提示')).toContainText('只读');const before=await page.getByLabel('有效专注时间',{exact:true}).textContent();await page.waitForTimeout(1100);expect(await page.getByLabel('有效专注时间',{exact:true}).textContent()).not.toBe(before);await expect(page.getByRole('button',{name:'中断',exact:true})).toBeDisabled();await context.setOffline(false);
 await open(page);await page.getByRole('button',{name:'检查会话并校时'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('switch',{name:'提示声音'}).click();await expect(page.getByRole('switch',{name:'提示声音'})).toHaveAttribute('aria-checked','false');await page.keyboard.press('Escape');
 await page.setViewportSize({width:1280,height:720});await open(page);await expect(page.getByLabel('密码',{exact:true})).toBeVisible();expect(await page.getByRole('dialog').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight)).toBe(true);await page.getByRole('button',{name:'退出回到空游客'}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'退出回到空游客'})).toBeVisible();
 if(process.env.ACCOUNT_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.ACCOUNT_SCREENSHOT_DIR,`${info.project.name}-account.png`)});
 await page.keyboard.press('Escape');await page.setViewportSize({width:1920,height:1080});await expect(page.getByRole('button',{name:'账户',exact:true})).toBeVisible();
});
test('响应丢失后刷新原请求重试、登录覆盖游客、退出和两设备覆盖',async({page,browser},info)=>{
 const username=`b_${info.project.name}_${Date.now()}`;await page.goto('/');await register(page,username);
 let lost=true;await page.route('**/test-api/v1/accounts/*/snapshot',async route=>{if(lost&&route.request().method()==='PUT'){lost=false;await route.fetch();await route.abort('failed');}else await route.continue();});
 await chainCandidate();
 async function chainCandidate(){await page.getByRole('button',{name:'新建链条',exact:true}).click();await page.getByLabel('链名称',{exact:true}).fill('未确认链');await page.getByRole('radio',{name:'戴上耳机',exact:true}).check();await page.getByRole('button',{name:'创建',exact:true}).click();}
 await expect(page.getByLabel('账户提示')).toContainText('未确认');await page.reload();await expect(page.getByLabel('账户提示')).toContainText('未确认');await open(page);await page.getByRole('button',{name:'重试原操作'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'未确认链',exact:true})).toBeVisible();
 const device=await browser.newContext();const other=await device.newPage();try{
   await other.goto('http://127.0.0.1:5184');await chain(other,'游客旧链');await other.getByRole('button',{name:'返回',exact:true}).click();await login(other,username);await expect(other.getByRole('button',{name:'游客旧链',exact:true})).toHaveCount(0);await expect(other.getByRole('button',{name:'未确认链',exact:true})).toBeVisible();
   await chain(page,'设备一新链');await page.getByRole('button',{name:'返回',exact:true}).click();
   await other.reload();await accountState(other,'云端保存已就绪');await other.getByRole('button',{name:'设置',exact:true}).click();await other.getByRole('switch',{name:'提示声音'}).click();await other.keyboard.press('Escape');
   await login(page,username);await expect(page.getByRole('button',{name:'设备一新链',exact:true})).toHaveCount(0);
   await open(page);await page.getByRole('button',{name:'退出回到空游客'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await accountState(page,'当前为游客');await expect(page.getByRole('button',{name:'未确认链',exact:true})).toHaveCount(0);
   await login(page,username);await expect(page.getByRole('button',{name:'未确认链',exact:true})).toBeVisible();
 }finally{await device.close();}
});
test('待判定任务中换号不自动成功或违约，原账户返回仍待处理',async({page,browser},info)=>{
 const stamp=Date.now(),alice=`pa_${info.project.name}_${stamp}`,bob=`pb_${info.project.name}_${stamp}`;
 const second=await browser.newContext();try{
   const other=await second.newPage();await other.goto('http://127.0.0.1:5184');await register(other,bob);
   await page.goto('/');await chain(page);await page.getByRole('button',{name:'开始',exact:true}).click();await page.getByLabel('任务内容',{exact:true}).fill('阅读论文');await page.getByRole('spinbutton',{name:'专注分钟',exact:true}).focus();await page.keyboard.press('ArrowDown');await page.getByRole('button',{name:'开始专注',exact:true}).click();await register(page,alice);
   await page.getByRole('button',{name:'返回当前任务',exact:true}).click();await page.getByRole('button',{name:'中断',exact:true}).click();
   await expect(page.getByRole('dialog').getByRole('button',{name:'账户',exact:true})).toHaveCount(0);await login(page,bob);await expect(page.getByRole('button',{name:'返回当前任务',exact:true})).toHaveCount(0);
   await login(page,alice);await page.getByRole('button',{name:'返回当前任务',exact:true}).click();await expect(page.getByRole('button',{name:'处理本次中断',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'完成',exact:true})).toHaveCount(0);
   await page.getByRole('button',{name:'处理本次中断',exact:true}).click();await expect(page.getByRole('dialog',{name:'中断判定',exact:true})).toBeVisible();
 }finally{await second.close();}
});
