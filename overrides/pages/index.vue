<script setup lang="ts">
useHead({ title: "NOVA — laboratório de mundos" })
</script>
<template>
  <div class="nova-home">
    <div class="eyebrow">NOVA LAB / SIMULAÇÃO INTERATIVA</div>
    <h1>Um laboratório de <em>mundos</em> no navegador.</h1>
    <p class="lead">Explore autômatos de Conway e sistemas de partículas com os motores livres
      do Sandbox Science. Sem instalação, com WebGPU quando disponível e alternativa CPU.</p>
    <div class="nova-cards">
      <NuxtLink to="/particle-life" class="nova-card">
        <span class="orb orb-a" aria-hidden="true"></span>
        <span class="subtitle">01 / PARTÍCULAS</span><h2>Particle Life</h2>
        <p>Espécies, atração e repulsão, presets, física 2D/3D e controles de mundo.</p>
        <span class="go">ABRIR SIMULADOR →</span>
      </NuxtLink>
      <NuxtLink to="/game-of-life" class="nova-card">
        <span class="orb orb-b" aria-hidden="true"></span>
        <span class="subtitle">02 / AUTÔMATOS</span><h2>Conway</h2>
        <p>Regras, padrões, desenho na grade e evolução de células em tempo real.</p>
        <span class="go">ABRIR SIMULADOR →</span>
      </NuxtLink>
      <NuxtLink to="/nova-data" class="nova-card">
        <span class="orb orb-c" aria-hidden="true"></span>
        <span class="subtitle">03 / DADOS NATIVOS</span><h2>Data Bridge</h2>
        <p>Importe padrões RLE, estados NCA e relatórios CSV/JSON do motor NOVA.</p>
        <span class="go">IMPORTAR DADOS →</span>
      </NuxtLink>
    </div>
    <p class="credit">Motores de interface derivados de
      <a href="https://github.com/DicSo92/SandboxScience" target="_blank" rel="noopener noreferrer">Sandbox Science</a>
      por Charly Luzzi (AGPL-3.0-or-later). O motor Rust original do NOVA está preservado em
      <a href="https://github.com/3scud3r0/Nova/tree/main/legacy" target="_blank" rel="noopener noreferrer">legacy/</a>.
    </p>
  </div>
</template>
<style scoped>
.nova-home { width:min(1220px,100%); margin:0 auto; padding:clamp(38px,7vw,100px) 0 24px; text-align:left; color:#f2f5ff; }
.eyebrow,.subtitle {color:#a9f2d5;font-size:12px;letter-spacing:.18em;font-weight:800;}
h1 { font-size:clamp(42px,6vw,82px);font-weight:850;line-height:1.04;letter-spacing:-.045em;max-width:900px;margin:18px 0 22px;}
h1 em {font-style:normal;color:#a9f2d5;}
.lead {font-size:clamp(15px,2vw,20px);line-height:1.65;max-width:730px;color:#b7c4d8;}
.nova-cards {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:56px;}
.nova-card {position:relative;display:flex;flex-direction:column;min-height:335px;padding:30px;border-radius:22px;border:1px solid #354657;background:linear-gradient(160deg,#152532,#0b121b);overflow:hidden;transition:transform .18s,border .18s;color:inherit;text-decoration:none;}
.nova-card:hover,.nova-card:focus-visible{transform:translateY(-5px);border-color:#a9f2d5;outline:none;}
.nova-card h2 {font-size:30px;font-weight:750;letter-spacing:-.035em;margin:22px 0 10px;position:relative;z-index:1;}
.nova-card p {color:#bac5d6;line-height:1.55;position:relative;z-index:1;}
.go {margin-top:auto;padding-top:24px;color:#a9f2d5;font-weight:800;font-size:12px;letter-spacing:.1em;z-index:1;}
.orb {position:absolute;width:200px;height:200px;right:-60px;top:-80px;opacity:.35;filter:blur(8px);border-radius:50%;}
.orb-a {background:radial-gradient(circle,#a1eecf,transparent 65%);}
.orb-b {background:repeating-conic-gradient(#5fc7f5 0 25%,transparent 0 50%) 0 0/42px 42px;}
.orb-c {background:radial-gradient(circle,#e0a1fc,transparent 67%);}
.credit {color:#8da0b4;line-height:1.7;font-size:12px;margin-top:32px;}
.credit a {color:#b0dded;text-decoration:underline;}
@media(max-width:850px){.nova-cards{grid-template-columns:1fr;margin-top:32px}.nova-card{min-height:220px}.nova-home{padding-top:45px;}}
</style>
