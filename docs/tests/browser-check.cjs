/* Verificación opcional de navegador. Requiere Playwright instalado como herramienta de desarrollo.
   No usa el servidor real: intercepta REST/WSS para probar la interfaz sin mover el vehículo. */
const { createRequire } = require('node:module');
const { join, resolve, extname } = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const requireTool = process.env.PLAYWRIGHT_PATH ? createRequire(join(process.env.PLAYWRIGHT_PATH, 'package.json')) : require;
const { chromium } = process.env.PLAYWRIGHT_PATH ? requireTool('./') : require('playwright');
const root = resolve(__dirname, '..');
const output = join(root, 'test-results');
fs.mkdirSync(output, { recursive:true });
const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.ico':'image/x-icon','.svg':'image/svg+xml'};
const server = http.createServer((req,res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/vehiculo_Iot\//, '');
  const file = resolve(root, path || 'index.html');
  if (!file.startsWith(root + require('node:path').sep)) {res.writeHead(403);res.end();return;}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(err?'No encontrado':data);});
});
const names=['AVANZAR','RETROCEDER','GIRAR_IZQUIERDA','GIRAR_DERECHA','SUBIR_CAJA','BAJAR_CAJA','ALTERNAR_LUCES','ALTERNAR_SONIDO','DETENER'];
const commands=names.map((nombre,i)=>({nombre,id_comando:i+1,codigo:i+1,id_vehiculo:1,activo:1}));
const vehicle={id_vehiculo:1,nombre:'Maquina de carga',modelo:'Control de carga RC',activo:1};
const demos=[{id_demo:1,id_vehiculo:1,nombre:'Recorrido de evaluación',descripcion:'Secuencia del servidor',activo:1}];
let browser;
let activePage;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/vehiculo_Iot/`;
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const calls=[]; const sockets=new Set(); const errors=[]; let apiOnline=true;
  let stamp=Date.now();
  const emit=event=>{stamp=Math.max(Date.now(),stamp+1);const msg=JSON.stringify({id_vehiculo:1,timestamp:new Date(stamp).toISOString(),...event});for(const s of sockets)s.send(msg);};
  await context.routeWebSocket('**/ws/vehiculos/1',ws=>{
    sockets.add(ws);
    ws.onClose(()=>sockets.delete(ws));
    ws.send(JSON.stringify({tipo:'estado_inicial',id_vehiculo:1,timestamp:new Date(++stamp).toISOString(),estado:{comando:'DETENER',codigo:9}}));
  });
  await context.route('https://vehiculo-iot.34-225-114-88.sslip.io/**',async route=>{
    if(!apiOnline){await route.abort('failed');return;}
    const req=route.request();const path=new URL(req.url()).pathname;let body;let status=200;
    const headers={'access-control-allow-origin':new URL(url).origin,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type, X-API-Key'};
    if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    if(req.method()==='GET'){
      if(path==='/health')body={status:'ok',database:'no comprobada'};
      else if(path==='/health/rds')body={status:'ok',database:'RDS'};
      else if(path==='/vehiculos/1')body={vehiculo:vehicle,comandos:commands,demos,estado:null};
      else if(path.endsWith('/demos/1/movimientos'))body=[{orden:1,id_comando:1,duracion_ms:500,pausa_ms:500},{orden:2,id_comando:9,duracion_ms:100,pausa_ms:0}];
      else {status=404;body={detail:'No existe'};}
    } else {
      if(req.headers()['x-api-key']==='clave-incorrecta-prueba'){
        await route.fulfill({status:401,headers,contentType:'application/json',body:JSON.stringify({detail:'Clave API inválida.'})});return;
      }
      assert.equal(req.headers()['x-api-key'],'prueba-sin-valor-real');
      if(path==='/vehiculos/1/movimientos'){
        const commandId=req.postDataJSON().id_comando;
        assert.equal(req.postDataJSON().origen,'API');
        calls.push(commandId);
        body={id_vehiculo:1,id_comando:commandId,estado:{codigo:commandId}};
        emit({tipo:'movimiento_individual',id_comando:commandId,codigo:commandId,comando:names[commandId-1]});
      } else if(path.endsWith('/iniciar')){
        calls.push('demo:start');status=202;body={id_vehiculo:1,id_demo:1,estado:'en_ejecucion'};
        emit({tipo:'demo_inicio',id_demo:1,total_movimientos:2});
      } else if(path.endsWith('/cancelar')){
        calls.push('demo:cancel');body={id_vehiculo:1,id_demo:1,estado:'cancelada'};
        emit({tipo:'demo_cancelada',id_demo:1,comando:'DETENER',codigo:9});
      } else {status=404;body={detail:'No existe'};}
    }
    await route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
  });
  const page=await context.newPage();
  activePage=page;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error')console.log('Navegador:',message.text());});
  await page.goto(url);
  await page.waitForFunction(()=>document.getElementById('vehicle-name').textContent==='Maquina de carga',null,{timeout:10000});
  await page.locator('#session-form').evaluate(el=>el.closest('details')?.setAttribute('open',''));
  await page.locator('#api-key').fill('prueba-sin-valor-real');
  await page.locator('#session-save').click();
  await page.waitForFunction(()=>document.getElementById('joystick').getAttribute('aria-disabled')!=='true');
  assert.equal(await page.locator('#api-key').inputValue(),'');
  assert.match(await page.locator('#session-status').innerText(),/Clave cargada/);
  assert.match(await page.locator('#session-feedback').innerText(),/Clave cargada en esta pestaña/);
  assert.match(await page.locator('#session-feedback').innerText(),/Controles disponibles/);
  await page.locator('#session-form').evaluate(el=>el.closest('details')?.removeAttribute('open'));
  const area=page.locator('#joystick');
  const box=await area.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-70);
  await page.waitForTimeout(160);
  await page.mouse.move(x+1,y-71);await page.mouse.move(x+2,y-72);
  await page.waitForTimeout(160);
  await page.mouse.move(x-70,y);await page.waitForTimeout(160);
  await page.mouse.up();await page.waitForTimeout(160);
  assert.deepEqual(calls,[1,3,9], 'Joystick genera transición, no ráfagas');
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-70);await page.waitForTimeout(160);
  await page.mouse.move(x,y);await page.waitForTimeout(160);
  await page.mouse.move(x,y+70);await page.waitForTimeout(160);
  await page.mouse.up();await page.waitForTimeout(160);
  assert.deepEqual(calls.slice(-4),[1,9,2,9], 'Cruzar la zona neutral no pierde el gesto');
  for(const id of [5,6,7,8]){
    const button=page.locator(`[data-command-id="${id}"]`);
    await button.click();
    await page.waitForFunction(id=>document.querySelector(`[data-command-id="${id}"]`)?.dataset.feedback==='received',id);
    assert.equal(calls.at(-1),id,'Caja, luces y sonido envían el ID real');
    assert.match(await button.innerText(),/Evento recibido/);
  }
  await page.locator('#stop-button').click();await page.waitForTimeout(180);
  await page.selectOption('#demo-select','1');
  await page.waitForFunction(()=>!document.getElementById('demo-start').disabled);
  await page.locator('#demo-start').click();
  await page.waitForFunction(()=>!document.getElementById('demo-cancel').disabled);
  assert.equal(await page.locator('[data-command-id="7"]').isDisabled(),true);
  await page.locator('#demo-cancel').click();await page.waitForTimeout(180);
  assert.deepEqual(calls.slice(-3),['demo:start','demo:cancel',9]);
  const dimensions=[['desktop',1440,1000],['mobile',390,844],['small',320,740],['landscape',844,390],['tablet',768,1024]];
  for(const [name,width,height] of dimensions){
    await page.setViewportSize({width,height});
    await page.locator('footer').scrollIntoViewIfNeeded();
    await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
    await page.waitForTimeout(200);
    await page.screenshot({path:join(output,`${name}.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Sin desbordamiento ${name}`);
    assert.equal(await page.locator('footer').isVisible(),true);
  }
  await page.locator('#joystick').focus();
  await page.keyboard.down('ArrowUp');await page.waitForTimeout(160);await page.keyboard.up('ArrowUp');await page.waitForTimeout(160);
  assert.deepEqual(calls.slice(-2),[1,9]);
  await page.setViewportSize({width:390,height:844});
  await area.scrollIntoViewIfNeeded();
  const touchBox=await area.boundingBox();
  const tx=touchBox.x+touchBox.width/2,ty=touchBox.y+touchBox.height/2;
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx,y:ty-65}]});
  await page.waitForTimeout(160);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(160);
  assert.deepEqual(calls.slice(-2),[1,9],'Gesto táctil envía avance y parada');
  await cdp.detach();
  const favicon=await page.locator('link[rel~="icon"]').getAttribute('href');
  assert.equal((await page.request.get(new URL(favicon,url).href)).status(),200);
  assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  assert.match(await page.locator('#academic-credit').innerText(),/Soluciones IoT · Profesor: Víctor Manuel Pinedo Fernández/);
  await page.locator('#session-form').evaluate(el=>el.closest('details')?.setAttribute('open',''));
  await page.locator('#api-key').fill('clave-incorrecta-prueba');
  await page.locator('#session-save').click();
  await page.locator('#session-form').evaluate(el=>el.closest('details')?.removeAttribute('open'));
  await page.locator('#stop-button').click();
  await page.waitForFunction(()=>document.getElementById('action-message').textContent.includes('HTTP 401'));
  assert.match(await page.locator('#session-status').innerText(),/Clave rechazada · HTTP 401/);
  assert.match(await page.locator('#session-feedback').innerText(),/Local y Pages usan sesiones independientes/);
  assert.equal(await page.locator('#session-panel').evaluate(el=>el.open),true);
  assert.equal(await page.locator('#api-key').isEnabled(),true);
  assert.equal(await page.locator('#stop-button').isEnabled(),true);
  assert.equal(await page.locator('#joystick').getAttribute('aria-disabled'),'true');
  assert.match(await page.locator('#rds-status').innerText(),/Disponible/);
  const acceptedBeforeKeyChange=calls.length;
  await page.locator('#api-key').fill('prueba-sin-valor-real');
  await page.locator('#session-save').click();
  assert.equal(await page.locator('#joystick').getAttribute('aria-disabled'),'true');
  assert.equal(calls.length,acceptedBeforeKeyChange,'Cambiar la clave no envía órdenes');
  await page.locator('#stop-button').click();
  await page.waitForFunction(()=>document.getElementById('action-http').textContent==='DETENER aceptado · HTTP 200');
  await page.waitForFunction(()=>document.getElementById('joystick').getAttribute('aria-disabled')==='false');
  assert.deepEqual(calls.slice(acceptedBeforeKeyChange),[9],'La recuperación solo envía DETENER');
  apiOnline=false;
  for(const s of sockets)s.close({code:1001,reason:'Prueba de desconexión'});
  await page.locator('#refresh-button').click();await page.waitForTimeout(200);
  assert.match(await page.locator('#api-status').innerText(),/No disponible/);
  assert.match(await page.locator('#rds-status').innerText(),/Sin verificar/);
  await page.reload();
  assert.equal(await page.locator('#extra-controls [data-placeholder="true"]').count(),4);
  assert.equal(await page.locator('#extra-controls button:disabled').count(),4);
  await page.locator('#session-form').evaluate(el=>el.closest('details')?.setAttribute('open',''));
  await page.locator('#api-key').fill('prueba-sin-valor-real');
  await page.locator('#session-save').click();
  assert.match(await page.locator('#session-feedback').innerText(),/Clave cargada en esta pestaña/);
  assert.match(await page.locator('#session-feedback').innerText(),/Controles bloqueados: la API/);
  assert.equal(await page.locator('#joystick').getAttribute('aria-disabled'),'true');
  apiOnline=true;
  await page.locator('#refresh-button').click();
  await page.waitForFunction(()=>document.getElementById('api-status').textContent.includes('Disponible'));
  await page.waitForFunction(()=>document.getElementById('ws-status').textContent.includes('En línea'));
  assert.deepEqual(errors,[],'Sin errores JavaScript');
  const report={date:new Date().toISOString(),target:'Frontend local con REST/WSS interceptados. Sin POST reales.',browser:await browser.version(),checks:['Subruta Pages vehiculo_Iot','Joystick transiciones y liberación','Cruce de zona neutral','Gesto táctil emulado','Caja arriba y abajo, luces y sonido con feedback','Controles pendientes visibles sin AWS','Profesor y materia','DEMO iniciar/cancelar/bloqueo','5 resoluciones sin overflow','Teclado','FaviconHTTP200','Sin almacenamiento de clave','API/RDS separados ante fallo','Recuperación API/WSS','Sin erroresJS'],calls,errors};
  console.log(JSON.stringify(report,null,2));
})().catch(async error=>{
  console.error(error);
  if(activePage){
    console.log(await activePage.locator('body').innerText());
    await activePage.screenshot({path:join(output,'failure.png'),fullPage:true});
  }
  process.exitCode=1;
}).finally(async()=>{await browser?.close();server.close();});

