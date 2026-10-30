import {defineConfig} from '@playwright/test';
if(!process.env.ISOLATED_DEPLOY_DRILL)throw new Error('Run only through the isolated deployment drill');
export default defineConfig({testDir:'./deployment-e2e',workers:1,fullyParallel:false,timeout:45000,reporter:'list',outputDir:process.env.DEPLOY_ARTIFACTS,use:{baseURL:'https://127.0.0.1:31443',ignoreHTTPSErrors:true,viewport:{width:1440,height:1024}},projects:[{name:'chrome',use:{channel:'chrome'}},{name:'edge',use:{channel:'msedge'}}]});
