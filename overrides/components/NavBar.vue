<template>
  <nav class="nova-nav" aria-label="Navegação NOVA">
    <NuxtLink to="/" class="mark"><span class="logo">N</span> NOVA <span class="lab">LAB</span></NuxtLink>
    <div class="links">
      <NuxtLink to="/particle-life">Partículas</NuxtLink>
      <NuxtLink to="/game-of-life">Conway</NuxtLink>
      <NuxtLink to="/nova-data">Dados NOVA</NuxtLink>
      <a href="https://github.com/3scud3r0/Nova" target="_blank" rel="noopener noreferrer">Código ↗</a>
    </div>
  </nav>
</template>
<style scoped>
.nova-nav{position:fixed;z-index:100;top:0;left:0;right:0;height:62px;padding:0 clamp(14px,4vw,60px);display:flex;justify-content:space-between;align-items:center;background:rgba(7,15,22,.94);backdrop-filter:blur(16px);border-bottom:1px solid #263e49;color:#f7fbff;}
.mark{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:900;letter-spacing:.08em;color:inherit;text-decoration:none;}
.logo{display:inline-grid;place-items:center;width:31px;height:31px;border-radius:8px;background:#a9f2d5;color:#092017;font-size:22px;}
.lab{color:#a9f2d5;font-size:10px;padding:3px 5px;border:1px solid #45675c;border-radius:4px;}
.links{display:flex;gap:clamp(8px,2.5vw,29px);align-items:center;}
.links a{font-size:13px;font-weight:650;color:#b9ccd7;text-decoration:none;}
.links a:hover,.links a.router-link-active{color:#a9f2d5;}
@media(max-width:520px){.nova-nav{height:55px}.links{gap:10px}.links a{font-size:11px}.lab{display:none}}
</style>
