#!/usr/bin/env node
/** Normalize Nuxt SEO URLs for case-sensitive GitHub Pages project paths. */
import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
const output=resolve(process.argv[2] || ".web-build/.output/public");
const routes=["","particle-life","game-of-life","nova-data"];
let patched=0;
function walk(dir){
 for(const item of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,item.name);
  if(item.isDirectory()){walk(path);continue;}
  if(!item.isFile() || !item.name.endsWith(".html"))continue;
  const original=readFileSync(path,"utf8");
  const normalized=original.replaceAll("https://3scud3r0.github.io/nova","https://3scud3r0.github.io/Nova");
  if(normalized!==original){
   writeFileSync(path,normalized);patched++;
   rmSync(path+".gz",{force:true});rmSync(path+".br",{force:true});
  }
 }
}
walk(output);
for(const route of routes){
 const page=join(output,route,"index.html");
 if(!existsSync(page))throw new Error("Missing generated route: "+route);
 const html=readFileSync(page,"utf8");
 if(html.includes("https://3scud3r0.github.io/nova"))throw new Error("Bad canonical capitalization: "+route);
 const expected="https://3scud3r0.github.io/Nova"+(route?"/"+route:"");
 if(!html.includes(expected))throw new Error("Missing canonical/OG URL: "+route);
 for(const filename of ["favicon.ico","favicon-16x16.png","favicon-32x32.png","site.webmanifest"]){
  if(!html.includes("/Nova/"+filename))throw new Error("Project-base asset missing: "+route+" -> "+filename);
  if(html.includes("href=\"/"+filename))throw new Error("Root-relative asset remains: "+route+" -> "+filename);
 }
 for(const destination of ["particle-life","game-of-life","nova-data"]){
  if(!html.includes("/Nova/"+destination) && route==="")
   throw new Error("Home navigation missing: "+destination);
 }
}
const manifest=JSON.parse(readFileSync(join(output,"site.webmanifest"),"utf8"));
if(manifest.name!=="NOVA Lab" || !manifest.icons.every(i=>i.src.startsWith("/Nova/")))
 throw new Error("PWA manifest still points outside /Nova/");
console.log(JSON.stringify({routes:routes.length,canonical_html_files_patched:patched,assets:"ok",manifest:"ok"}));
