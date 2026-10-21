"""Offline, self-contained metric explorer; no server or external assets."""

from pathlib import Path
import json


def dashboard(metrics_path, output):
    rows = [
        json.loads(line)
        for line in Path(metrics_path).read_text().splitlines()
        if line.strip()
    ]
    payload = json.dumps(rows).replace("<", "\\u003c")
    html = """<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>NOVA — métricas</title>
<style>body{font:16px system-ui;max-width:1000px;margin:3rem auto;background:#101827;color:#e2e8f0;padding:1rem}select{font:inherit;padding:.5rem}canvas{width:100%;background:#172337;margin-top:1rem}table{border-collapse:collapse}td,th{padding:.6rem;border-bottom:1px solid #445}h1{font-size:2rem}</style>
<h1>NOVA — métricas do ciclo</h1><p>Registro experimental. Selecione uma métrica para inspecionar sua evolução.</p>
<label>Métrica <select id="metric"></select></label><canvas id="chart" width="950" height="350"></canvas><table id="summary"></table>
<script>const data=PAYLOAD;const select=document.getElementById('metric');
const keys=data.length?Object.keys(data[0]).filter(k=>typeof data[0][k]==='number'&&k!=='tick'):[];
for(const key of keys){const o=document.createElement('option');o.value=o.textContent=key;select.append(o)}
function draw(){const key=select.value,values=data.map(d=>d[key]),c=document.getElementById('chart'),ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);if(!values.length)return;
const low=Math.min(...values),high=Math.max(...values),span=high-low||1;ctx.strokeStyle='#38bdf8';ctx.lineWidth=2;ctx.beginPath();values.forEach((v,i)=>{const x=40+i*870/Math.max(values.length-1,1),y=310-(v-low)*270/span;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.fillStyle='#e2e8f0';ctx.fillText(high.toPrecision(5),5,25);ctx.fillText(low.toPrecision(5),5,325);ctx.fillText('ticks: '+values.length,400,345);
const table=document.getElementById('summary');table.replaceChildren();for(const [name,value] of Object.entries(data[data.length-1])){const tr=document.createElement('tr');for(const v of [name,value]){const td=document.createElement('td');td.textContent=String(v);tr.append(td)}table.append(tr)}}select.onchange=draw;draw();</script></html>""".replace(
        "PAYLOAD", payload
    )
    Path(output).write_text(html)
