<script setup lang="ts">
import { ref, shallowRef, watch, nextTick } from "vue"
import { parseNovaFile, extractPoints } from "../bridge/nova-data.mjs"
useHead({ title: "NOVA — Data Bridge" })
const filename = ref("")
const error = ref("")
const busy = ref(false)
const parsed = shallowRef<any>(null)
const board = ref<HTMLCanvasElement | null>(null)

async function receive(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  error.value = ""; parsed.value = null; filename.value = file.name; busy.value = true
  try { parsed.value = await parseNovaFile(file.name, await file.arrayBuffer()) }
  catch (e: any) { error.value = e?.message || String(e) }
  finally { busy.value = false }
}
watch(parsed, async () => { await nextTick(); draw() })
function draw() {
  const c = board.value, doc = parsed.value
  if (!c || !doc || doc.kind === "metadata") return
  const ctx = c.getContext("2d")
  if (!ctx) return
  if (doc.kind === "grid") {
    c.width = doc.width; c.height = doc.height
    const data = ctx.createImageData(c.width,c.height)
    for(let i=0;i<doc.cells.length;i++) {
      const on=doc.cells[i]===1
      data.data[i*4]=on?155:12; data.data[i*4+1]=on?248:24
      data.data[i*4+2]=on?209:36;data.data[i*4+3]=255
    }
    ctx.putImageData(data,0,0); return
  }
  const pts = extractPoints(doc)
  c.width = 1000; c.height=600
  ctx.fillStyle="#0b1724";ctx.fillRect(0,0,c.width,c.height)
  if(!pts.length){ctx.fillStyle="#9ab1c6";ctx.font="18px sans-serif";ctx.fillText("Arquivo tabular sem colunas espaciais x/y",24,34);return}
  const xVals=pts.map(p=>p[0]), yVals=pts.map(p=>p[1])
  const x0=Math.min(...xVals), y0=Math.min(...yVals)
  const x1=Math.max(...xVals), y1=Math.max(...yVals)
  const dx=Math.max(x1-x0,1e-8),dy=Math.max(y1-y0,1e-8)
  ctx.fillStyle="#a9f2d5"
  for(const [x,y] of pts)ctx.fillRect(16+(x-x0)/dx*968,16+(y-y0)/dy*568,2,2)
}
function png() {
  if(!board.value)return
  const link=document.createElement("a")
  link.href=board.value.toDataURL("image/png")
  link.download=(filename.value||"nova")+".png";link.click()
}
const preview = computed(() => {
 const doc=parsed.value
 if(!doc)return ""
 if(doc.kind==="metadata")return JSON.stringify(doc.value,null,2).slice(0,8000)
 if(doc.kind==="rows")return JSON.stringify(doc.rows.slice(0,6),null,2)
 return ""
})
</script>
<template>
  <div class="data-page">
    <div class="intro">
      <div class="flag">NOVA / INTEROPERABILIDADE</div>
      <h1>Data Bridge</h1>
      <p>Abra seus resultados NOVA diretamente no navegador, sem enviar arquivos a servidores.
         Suporte a <strong>Conway .nca/.rle</strong> e metadados e trajetórias <strong>.csv/.json/.jsonl</strong>.</p>
    </div>
    <div class="panel">
      <label class="drop">
        <span class="file-ico">↥</span>
        <span>Escolha um arquivo NOVA</span>
        <small>Máximo de 32 MiB · processamento local</small>
        <input type="file" accept=".nca,.rle,.csv,.json,.jsonl" @change="receive" aria-label="Selecionar arquivo" />
      </label>
      <p v-if="busy" role="status">Lendo arquivo…</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div v-if="parsed" class="result">
        <div class="header">
          <div><h2>{{ filename }}</h2>
            <p>{{ parsed.format }} · {{ parsed.kind==='grid' ? parsed.width+' × '+parsed.height+' · população '+parsed.population : parsed.kind==='rows' ? parsed.total+' registros' : 'metadados JSON' }}</p>
          </div>
          <button v-if="parsed.kind!=='metadata'" @click="png">Salvar imagem PNG</button>
        </div>
        <canvas v-if="parsed.kind!=='metadata'" ref="board" class="canvas" aria-label="Visualização de dados NOVA"></canvas>
        <pre v-if="preview" class="json">{{ preview }}</pre>
      </div>
    </div>
    <p class="footnote">O GitHub Pages é um host estático: este visualizador não executa o backend Rust.
      Arrow, Parquet e Zarr exigem conversão prévia para CSV/JSONL. Código nativo preservado
      <a href="https://github.com/3scud3r0/Nova/tree/main/legacy" target="_blank" rel="noopener noreferrer">no diretório legacy/</a>.
      Nenhum arquivo sai do seu navegador.</p>
  </div>
</template>
<style scoped>
.data-page{text-align:left;color:#f1fbff;max-width:1070px;margin:0 auto;padding:40px 0 30px;}
.flag{font-size:12px;font-weight:850;letter-spacing:.16em;color:#a9f2d5;}
h1{font-size:clamp(42px,6vw,65px);font-weight:800;letter-spacing:-.04em;margin:12px 0;}
.intro p{max-width:730px;line-height:1.75;color:#b7c5d1;}
.panel{margin-top:30px;background:#111f2a;border:1px solid #314756;padding:clamp(16px,4vw,32px);border-radius:24px;}
.drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:42px 15px;border:1px dashed #78988f;border-radius:14px;background:#142b2e;cursor:pointer;text-align:center;position:relative;font-weight:750;}
.drop:hover{border-color:#a9f2d5;background:#1a3538;}
.drop input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;}
.drop small{font-weight:450;color:#b7c5d1;}
.file-ico{font-size:35px;color:#b2ffde;}
.error{color:#ff9c9c;padding:12px;}
.result{margin-top:25px;}
.header{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;}
.header h2{font-size:18px;font-weight:700;overflow-wrap:anywhere;}
.header p{color:#b2c8d6;}
button{padding:10px 15px;border-radius:8px;background:#a9f2d5;color:#092116;font-weight:800;cursor:pointer;}
.canvas{display:block;width:100%;height:auto;max-height:650px;object-fit:contain;background:#0b1724;image-rendering:pixelated;margin-top:20px;border-radius:10px;}
.json{color:#cbd7e6;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:440px;overflow:auto;padding:18px;background:#07121b;margin-top:20px;border-radius:10px;}
.footnote{font-size:13px;line-height:1.7;color:#9fb2c3;margin-top:24px;}
.footnote a{color:#a9f2d5;text-decoration:underline;}
</style>
