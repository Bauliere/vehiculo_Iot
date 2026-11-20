#pragma once
// Estilo local conservado del portal anterior.
const char ESTILO_PORTAL[] = R"HTML(
<meta name="theme-color" content="#102c28">
<style>
:root{color-scheme:dark;--acento:#8abbaa;--borde:rgba(163,213,193,.24)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;padding:24px 14px;color:#e8f4ed;
font-family:system-ui,Arial,sans-serif;background:radial-gradient(ellipse at
15% 0%,#285b4f 0%,transparent 55%),linear-gradient(145deg,#071b18,#153c34)}
.wrap{width:min(100%,480px);max-width:480px;margin:3vh auto;padding:28px;
border:1px solid var(--borde);border-radius:26px;background:rgba(21,53,45,.76);
backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
box-shadow:0 22px 65px rgba(0,0,0,.3);text-align:left}
.wrap:before{content:'EXCAVADORA / CONECTIVIDAD';display:block;
letter-spacing:.13em;font-size:11px;font-weight:700;color:var(--acento);
margin-bottom:22px}
h1{font-size:26px;overflow-wrap:anywhere}h3{font-size:15px;color:#abc9ba}
p,label,div{line-height:1.6}a{color:#b5decb}
input:not([type=checkbox]),select{width:100%;padding:13px;margin:8px 0 18px;
background:rgba(2,19,15,.65);color:#f0fff5;border:1px solid var(--borde);
border-radius:12px;font-size:16px}
input:focus{outline:2px solid var(--acento);outline-offset:2px}
button{width:100%;height:auto;min-height:46px;padding:13px 18px;
border:1px solid #699e88;border-radius:13px;background:#356b58;
color:#f3fff7;font-size:16px;font-weight:650;cursor:pointer}
button:hover{background:#427f68}form{margin:12px 0}hr{border:0;
border-top:1px solid var(--borde)}.msg{border-radius:12px;padding:14px;
background:rgba(7,28,21,.65);color:#d7eddf}.q{filter:brightness(1.5)}
@media(max-width:400px){.wrap{padding:20px}h1{font-size:22px}}
</style>
)HTML";
