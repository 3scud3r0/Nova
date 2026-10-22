#!/usr/bin/env node
/** Reproducible AGPL clone of Sandbox Science with NOVA Pages overlay. */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(fileURLToPath(new URL("..", import.meta.url)));
const vendor=join(root,"vendor","SandboxScience");
const target=join(root,".web-build");
const overlays=join(root,"overrides");
const pinned="ba43fde7ed3fc2224302c2682a3ecd3030717ba5";
if(!existsSync(join(vendor,"nuxt.config.ts")))throw new Error("Initialize the pinned upstream: git submodule update --init --recursive");
const revision=execFileSync("git",["-C",vendor,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(revision!==pinned)throw new Error("Unexpected Sandbox Science revision "+revision+"; expected "+pinned);
rmSync(target,{recursive:true,force:true});
cpSync(vendor,target,{recursive:true,filter:p=>!relative(vendor,p).split(/[\\/]/).some(part=>[".git","node_modules",".nuxt",".output"].includes(part))});
function overlay(source,dest){
  for(const ent of readdirSync(source,{withFileTypes:true})) {
    const src=join(source,ent.name),dst=join(dest,ent.name);
    if(ent.isDirectory()){mkdirSync(dst,{recursive:true});overlay(src,dst);}
    else cpSync(src,dst);
  }
}
overlay(overlays,target);
mkdirSync(join(target,"bridge"),{recursive:true});
cpSync(join(root,"bridge","nova-data.mjs"),join(target,"bridge","nova-data.mjs"));
const cfg=join(target,"nuxt.config.ts");
let nuxt=readFileSync(cfg,"utf8");
const siteMarker="        url: appURL,";
const appMarker="    app: {\n        head: {";
if(!nuxt.includes(siteMarker)||!nuxt.includes(appMarker))throw new Error("Upstream Nuxt changed; review pinned revision.");
nuxt=nuxt.replace(siteMarker,"        url: process.env.NUXT_PUBLIC_SITE_URL || appURL,")
         .replace(appMarker,"    app: {\n        baseURL: process.env.NUXT_APP_BASE_URL || '/Nova/',\n        head: {")
         .replace("['/', '/about', '/particle-life', '/game-of-life', '/hash-life', '/sitemap.xml', '/robots.txt']",
                  "['/', '/about', '/particle-life', '/game-of-life', '/nova-data', '/sitemap.xml', '/robots.txt']")
         .replace("enabled: true,\n        debug: true","enabled: false,\n        debug: false")
         .replace("    seo: {", "    robots: { robotsTxt: false },\n    seo: {")
         .replace(", '/robots.txt'", "");

const iconFiles=["favicon.ico","favicon-16x16.png","favicon-32x32.png",
  "apple-touch-icon.png","site.webmanifest","safari-pinned-tab.svg"];
for(const file of iconFiles) {
  const old="href: '/"+file;
  if(!nuxt.includes(old))throw new Error("Expected upstream favicon/manifest not found: "+file);
  nuxt=nuxt.replace(old,"href: '/Nova/"+file);
}
writeFileSync(cfg,nuxt);
const constants=join(target,"constants","index.ts");
let names=readFileSync(constants,"utf8");
names=names.replace("const appURL = 'https://sandbox-science.com'","const appURL = 'https://3scud3r0.github.io'")
           .replace("const appName = 'Sandbox Science'","const appName = 'NOVA Lab'")
           .replace(/const appDescription = '[^\n]+'/, "const appDescription = 'NOVA Lab: Particle Life e Conway no navegador com integração de dados do motor NOVA.'");
writeFileSync(constants,names);
// Conservative first-load budgets avoid overwhelming CPU and integrated GPUs.
// Users can increase particle counts through the original Sandbox Science panels.
for (const [file, original, tuned] of [
  ["particleLifeStore.ts", "ref<number>(6000)", "ref<number>(2000)"],
  ["particleLifeGPUStore.ts", "ref<number>(64000)", "ref<number>(24000)"],
  ["particleLifeGPU3DStore.ts", "ref<number>(128000)", "ref<number>(32000)"],
]) {
  const path=join(target,"stores",file);
  let content=readFileSync(path,"utf8");
  if(!content.includes(original)) throw new Error("Upstream particle budget changed: "+file);
  content=content.replace(original,tuned);
  writeFileSync(path,content);
}

const manifestPath=join(target,"public","site.webmanifest");
const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
manifest.name="NOVA Lab";manifest.short_name="NOVA";
for(const icon of manifest.icons || []) {
  if(icon.src.startsWith("/")) icon.src="/Nova/"+icon.src.slice(1);
}
writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
rmSync(join(target,"pages","hash-life.vue"),{force:true});
console.log(JSON.stringify({upstream:"DicSo92/SandboxScience",revision,output:target,base:process.env.NUXT_APP_BASE_URL||"/Nova/"}));
