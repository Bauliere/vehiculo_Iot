/* QA local. REST y WSS interceptados: nunca se envían órdenes al servidor/carrito.
   Requiere Playwright como herramienta de desarrollo. */
const { createRequire } = require('node:module');
const { join, resolve, extname, sep } = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const requireTool = process.env.PLAYWRIGHT_PATH ? createRequire(join(process.env.PLAYWRIGHT_PATH, 'package.json')) : require;
const { chromium } = process.env.PLAYWRIGHT_PATH ? requireTool('./') : require('playwright');
const root = resolve(__dirname, '..'), output = join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/vehiculo_Iot\//, '');
  const file = resolve(root, path || 'index.html');
  if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    res.writeHead(err ? 404 : 200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(err ? 'No encontrado' : data);
  });
});
const API = 'https://vehiculo-iot.34-225-114-88.sslip.io', KEY = 'prueba-sesion-temporal-sin-valor-real-123456';
const names = ['AVANZAR', 'RETROCEDER', 'GIRAR_IZQUIERDA', 'GIRAR_DERECHA', 'SUBIR_CAJA', 'BAJAR_CAJA', 'ALTERNAR_LUCES', 'ALTERNAR_SONIDO', 'DETENER'];
const commands = names.map((nombre, i) => ({ nombre, id_comando: i + 1, codigo: i + 1, id_vehiculo: 1, activo: 1 }));
const vehicle = { id_vehiculo: 1, nombre: 'Maquina de carga', modelo: 'Control de carga RC', activo: 1 };
const demos = [{ id_demo: 1, id_vehiculo: 1, nombre: 'Recorrido de evaluación', descripcion: 'Secuencia del servidor', activo: 1 }];
const dimensions = [['desktop',1440,1000],['laptop',1366,620],['short-laptop',1024,520],['mobile',390,844],['small',320,568],['compact',360,640],['landscape',844,390],['small-landscape',667,375],['landscape-with-toolbar',810,280],['large-landscape',932,430],['wide-landscape',1024,480],['tablet',768,1024]];
let browser, activePage;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/vehiculo_Iot/`;
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
    ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {})
  });
  const context = await browser.newContext({ viewport: { width:1440, height:1000 } });
  const calls = [], sockets = new Set(), errors = [], reads = { state:0, history:0 };
  let rejectControl = false;
  let delayMovementResponse = 0;
  let apiOnline = true, wsOnline = true, stamp = Date.now(), nextRecord = 13;
  const nextTime = () => (stamp = Math.max(Date.now(), stamp + 1));
  const stateFor = (id, epoch = nextTime()) => ({ id_vehiculo:1, vehiculo:vehicle.nombre, id_comando:id,
    comando:names[id-1], codigo:id, conectado:0, fecha_actualizacion:new Date(epoch).toISOString().replace('Z','') });
  let currentState = stateFor(9);
  const history = Array.from({length:12}, (_, i) => ({ id_historial:i+1, id_vehiculo:1, comando:names[i%9],
    codigo:i%9+1, origen:'API', fecha_hora:new Date(stamp-(12-i)*1000).toISOString().replace('Z','') }));
  const eventFor = (id, type = 'movimiento_individual', extra = {}) => {
    const epoch = nextTime(); currentState = stateFor(id,epoch);
    return { tipo:type, id_vehiculo:1, timestamp:new Date(epoch).toISOString(), id_comando:id,
      codigo:id, comando:names[id-1], estado:{...currentState}, ...extra };
  };
  const broadcast = event => { for (const socket of sockets) socket.send(JSON.stringify(event)); };
  const individual = (id, send = true) => {
    const event = eventFor(id);
    history.push({id_historial:nextRecord++, id_vehiculo:1, comando:names[id-1], codigo:id,
      origen:'API', fecha_hora:currentState.fecha_actualizacion});
    if (send) broadcast(event);
    return event;
  };
  await context.routeWebSocket('**', ws => {
    assert.equal(ws.url(), `${API.replace('https:','wss:')}/ws/vehiculos/1`);
    if (!wsOnline) { ws.close({code:1001,reason:'Desconexión simulada'}); return; }
    sockets.add(ws); ws.onClose(() => sockets.delete(ws));
    ws.send(JSON.stringify({tipo:'estado_inicial',id_vehiculo:1,timestamp:new Date(nextTime()).toISOString(),estado:{...currentState}}));
  });
  await context.route('**/*', async route => {
    const target = new URL(route.request().url());
    if (target.origin === new URL(url).origin) return route.continue();
    if (target.origin !== API) return route.abort('blockedbyclient');
    if (!apiOnline) return route.abort('failed');
    const req = route.request(), path = target.pathname;
    let body, status = 200;
    const headers = {'access-control-allow-origin':new URL(url).origin,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type, X-API-Key'};
    if (req.method() === 'OPTIONS') return route.fulfill({status:204,headers});
    if (req.method() === 'GET') {
      if (path === '/control/sesion') body = {token:KEY,expires_in:900,id_vehiculo:1};
      else if (path === '/health') body = {status:'ok',database:'no comprobada'};
      else if (path === '/health/rds') body = {status:'ok',database:'RDS'};
      else if (path === '/vehiculos/1') body = {vehiculo:vehicle,comandos:commands,demos,estado:currentState};
      else if (path === '/vehiculos/1/estado') { reads.state++; body = {...currentState}; }
      else if (path === '/vehiculos/1/historial') { reads.history++; body = history.map(row=>({...row})); }
      else if (path.endsWith('/demos/1/movimientos')) body = [{orden:1,id_comando:1,duracion_ms:500,pausa_ms:500},{orden:2,id_comando:9,duracion_ms:100,pausa_ms:0}];
      else {status=404;body={detail:'No existe'};}
    } else {
      assert.equal(req.method(),'POST');
      if (rejectControl) return route.fulfill({status:401,headers,contentType:'application/json',body:JSON.stringify({detail:'Clave API inválida.'})});
      assert.equal(req.headers()['x-api-key'],KEY);
      if (path === '/vehiculos/1/movimientos') {
        const id = req.postDataJSON().id_comando;
        assert.equal(req.postDataJSON().origen,'API'); calls.push(id); individual(id);
        body = {id_vehiculo:1,id_comando:id,estado:{...currentState}};
        if (id !== 9 && delayMovementResponse) {
          await new Promise(resolve => setTimeout(resolve, delayMovementResponse));
        }
      } else if (path.endsWith('/iniciar')) {
        calls.push('demo:start'); status=202; body={id_vehiculo:1,id_demo:1,estado:'en_ejecucion'};
        broadcast({tipo:'demo_inicio',id_vehiculo:1,timestamp:new Date(nextTime()).toISOString(),id_demo:1,total_movimientos:2});
      } else if (path.endsWith('/cancelar')) {
        calls.push('demo:cancel'); body={id_vehiculo:1,id_demo:1,estado:'cancelada'};
        broadcast(eventFor(9,'demo_cancelada',{id_demo:1}));
      } else {status=404;body={detail:'No existe'};}
    }
    return route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
  });
  const page = await context.newPage(); activePage=page;
  page.on('pageerror',error=>errors.push(error.message));
  const closeSheet = async () => { if (await page.locator('#control-sheet').evaluate(el=>el.open)) await page.locator('#sheet-close').click(); };
  const openPanel = async name => {
    await closeSheet(); await page.locator(name==='session'?'#access-open':'#demo-open').click();
  };
  const view = async name => { await closeSheet(); await page.locator(`nav [data-view-target="${name}"]`).click(); await page.waitForFunction(name=>document.documentElement.dataset.view===name,name); };
  const settle = () => page.waitForTimeout(200);
  const demoStart = page.locator('#demo-start');
  const holdDemo = async () => {
    await demoStart.hover();
    await page.mouse.down();
    await page.waitForFunction(() => document.getElementById('demo-start').dataset.phase === 'done');
    await page.mouse.up();
  };
  const recordIds = () => page.locator('#monitor-history-body tr[data-record-id]').evaluateAll(rows=>rows.map(row=>Number(row.dataset.recordId)));
  const assertFits = async (name,control=true) => {
    const layout = await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,bodyScrollHeight:document.body.scrollHeight,scrollY}));
    assert.ok(layout.scrollWidth<=layout.width+1,`${name}: sin desbordamiento horizontal ${JSON.stringify(layout)}`);
    {
      assert.ok(layout.scrollHeight<=layout.height+1 && layout.bodyScrollHeight<=layout.height+1,`${name}: documento cabe completo ${JSON.stringify(layout)}`);
      const selectors = control ? ['#joystick','#box-lever','#stop-button','.control-dock','#access-open','#demo-open','[data-command-id="7"]','[data-command-id="8"]'] : ['.latest-panel','.history-table','#history-prev','#history-next'];
      for (const selector of selectors) {
        const element=page.locator(selector), box=await element.boundingBox();
        assert.ok(await element.isVisible(),`${name}: ${selector} visible`);
        assert.ok(box && box.x>=-1 && box.y>=-1 && box.x+box.width<=layout.width+1 && box.y+box.height<=layout.height+1,`${name}: ${selector} completo, no recortado ${JSON.stringify(box)}`);
      }
      const footer = await page.locator('.app-footer').boundingBox();
      const content = await page.locator(control ? '.control-dock' : '.history-panel').boundingBox();
      assert.ok(content.y + content.height <= footer.y + 1, `${name}: el contenido no tapa el pie`);
      if (control && name.includes('landscape')) {
        const joystick = await page.locator('#joystick').boundingBox();
        const lever = await page.locator('#box-lever').boundingBox();
        assert.ok(joystick.width >= layout.height * .5, `${name}: joystick aprovecha la altura disponible`);
        assert.ok(content.x > lever.x + lever.width, `${name}: acciones al costado`);
      }
      await page.mouse.wheel(0,700); await page.waitForTimeout(80);
      assert.equal(await page.evaluate(()=>scrollY),0,`${name}: no desplaza el documento`);
    }
  };
  await page.goto(url);
  await page.waitForFunction(()=>document.getElementById('vehicle-name').textContent==='Maquina de carga',null,{timeout:10000});
  await page.waitForFunction(()=>document.getElementById('joystick').getAttribute('aria-disabled')==='false');
  await page.waitForFunction(() => document.querySelector('#slats-effect canvas') &&
    document.querySelector('#fausto-effect[data-ready]') &&
    document.querySelector('#vehicle-name + .rb-warp[data-ready]'));
  await page.waitForFunction(() => document.querySelectorAll('.target-cursor__corner').length ===
    (matchMedia('(hover: hover) and (pointer: fine)').matches ? 4 : 0));
  assert.equal(await page.locator('.rb-flip-surface .flip-card').count(), 8);
  assert.equal(await page.locator('#api-key').count(),0,'Sin campo de clave');
  assert.equal(await page.locator('#session-status').textContent(),'Disponible');
  assert.equal(await page.locator('#demo-select').inputValue(),'1');
  const area=page.locator('#joystick');
  const box=await area.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-70);await settle();
  await page.mouse.move(x+1,y-71);await page.mouse.move(x+2,y-72);await settle();
  await page.mouse.move(x-70,y);await settle();await page.mouse.up();await settle();
  assert.deepEqual(calls,[1,3,9],'Joystick: una orden por transición');
  assert.equal(await page.locator('#session-status').textContent(),'Disponible');
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-70);await settle();
  await page.mouse.move(x,y);await settle();await page.mouse.move(x,y+70);await settle();await page.mouse.up();await settle();
  assert.deepEqual(calls.slice(-4),[1,9,2,9],'Cruzar neutral conserva el gesto');
  const beforeRelease = calls.length;
  delayMovementResponse = 110;
  await area.focus();
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => document.getElementById('action-http').textContent === 'Enviando…');
  await page.keyboard.up('ArrowUp');
  await page.waitForFunction(() => document.getElementById('action-http').textContent === 'DETENER aceptado · HTTP 200');
  assert.deepEqual(calls.slice(beforeRelease), [1,9], 'Soltar durante un POST confirmado a tiempo registra un solo DETENER');
  delayMovementResponse = 0;
  const lever=page.locator('#box-lever'); let rail=await lever.boundingBox();
  await page.mouse.move(rail.x+rail.width/2,rail.y+rail.height*.12);await page.mouse.down();await settle();
  assert.equal(await lever.getAttribute('aria-valuetext'),'Subir caja');
  await page.mouse.up();await settle();assert.deepEqual(calls.slice(-2),[5,9],'Palanca arriba y parada');
  await lever.focus();await page.keyboard.down('ArrowDown');await settle();await page.keyboard.up('ArrowDown');await settle();
  assert.deepEqual(calls.slice(-2),[6,9],'Palanca con teclado y parada');
  assert.equal(await lever.getAttribute('aria-valuenow'),'0');
  for(const id of [7,8]){
    await page.locator(`[data-command-id="${id}"]`).click();
    await page.waitForFunction(id=>document.querySelector(`[data-command-id="${id}"]`)?.dataset.toggle==='on',id);
    assert.equal(calls.at(-1),id,'Luces y sonido usan catálogo real');
    await page.waitForTimeout(650);
    assert.equal(await page.locator(`[data-command-id="${id}"]`).getAttribute('data-toggle'),'on','No se apaga por temporizador');
    await page.locator(`[data-command-id="${id}"]`).click();
    await page.waitForFunction(id=>document.querySelector(`[data-command-id="${id}"]`)?.dataset.toggle==='off',id);
  }
  await page.locator('#stop-button').click();await settle();await openPanel('demo');
  await page.selectOption('#demo-select','1');await page.waitForFunction(()=>!document.getElementById('demo-start').disabled);
  const beforeDemoPress = calls.length;
  await demoStart.click();
  await settle();
  assert.equal(calls.length, beforeDemoPress, 'Una pulsación corta no inicia la DEMO');
  await holdDemo();
  await page.waitForFunction(()=>!document.getElementById('demo-cancel').disabled);
  assert.deepEqual(calls.slice(beforeDemoPress), ['demo:start']);
  assert.equal(await page.locator('[data-command-id="7"]').isDisabled(),true);
  const demoWrites = calls.length;
  const step = (id, orden) => eventFor(id, 'demo_movimiento', { id_demo:1, orden, duracion_ms:500, pausa_ms:100 });
  broadcast(step(1, 1));
  await page.waitForFunction(()=>document.getElementById('joystick').dataset.demoActive==='true');
  assert.match(await area.evaluate(el=>el.style.getPropertyValue('--demo-y')), /^-/);
  broadcast(step(5, 2));
  await page.waitForFunction(()=>document.getElementById('box-lever').dataset.demoActive==='true');
  broadcast(step(7, 3));
  await page.waitForFunction(()=>document.querySelector('[data-command-id="7"]').dataset.flash==='true');
  await page.waitForFunction(()=>document.querySelector('[data-command-id="7"]').dataset.flash==='false');
  assert.equal(await page.locator('[data-command-id="7"]').getAttribute('data-toggle'),'on');
  assert.equal(calls.length,demoWrites,'Animar DEMO no envía órdenes');
  await page.locator('#demo-cancel').click();await settle();await closeSheet();
  assert.deepEqual(calls.slice(-3),['demo:start','demo:cancel',9]);

  // Monitoreo: REST como persistencia, eventos externos y DEMO aislada del historial.
  await view('monitor');
  await page.waitForFunction(()=>document.getElementById('monitor-history-body').querySelectorAll('tr[data-record-id]').length===10);
  await page.waitForFunction(() => document.querySelector('#monitor-vehicle + .rb-warp[data-ready]') &&
    document.querySelector('#monitor-command + .rb-warp[data-ready]') &&
    document.querySelector('#history-heading + .rb-warp[data-ready]'));
  assert.ok(reads.state>0 && reads.history>0,'Carga inicial REST');
  assert.deepEqual(await recordIds(),history.slice(-10).reverse().map(row=>row.id_historial));
  const writesBeforeMonitor=calls.length, externalEvent=individual(5), newestId=nextRecord-1;
  await page.waitForFunction(id=>document.querySelector('#monitor-history-body tr')?.dataset.recordId===String(id),newestId);
  assert.match(await page.locator('#monitor-command').innerText(),/Subir caja/i);
  assert.notEqual(await page.locator('#monitor-date').textContent(),'Sin fecha');
  assert.notEqual(await page.locator('#monitor-time').textContent(),'Sin hora');
  const historyReads=reads.history;
  broadcast(externalEvent);broadcast({...externalEvent,id_vehiculo:2});broadcast({...externalEvent,timestamp:new Date(stamp-100000).toISOString()});
  await settle();assert.equal(reads.history,historyReads,'Dup/otro vehículo/viejo no consulta historial');
  const beforeDemoIds=await recordIds();
  broadcast(eventFor(6,'demo_movimiento',{id_demo:1,orden:1,duracion_ms:500,pausa_ms:500}));
  await page.waitForFunction(()=>document.getElementById('monitor-command').textContent.toLowerCase().includes('bajar caja'));
  assert.match(await page.locator('#monitor-source').textContent(),/DEMO/);await settle();
  assert.deepEqual(await recordIds(),beforeDemoIds,'DEMO no fabrica registros');
  assert.equal(reads.history,historyReads,'DEMO no consulta historial innecesario');
  broadcast(eventFor(9,'demo_fin',{id_demo:1}));await settle();
  assert.equal(calls.length,writesBeforeMonitor,'Monitoreo no escribe órdenes');
  wsOnline=false;for(const socket of sockets)socket.close({code:1001,reason:'Prueba de recuperación'});
  await page.waitForFunction(()=>!document.getElementById('ws-status').textContent.includes('En línea'));
  individual(4,false);const missedId=nextRecord-1;wsOnline=true;
  await page.waitForFunction(()=>document.getElementById('ws-status').textContent.includes('En línea'),null,{timeout:10000});
  await page.waitForFunction(id=>document.querySelector('#monitor-history-body tr')?.dataset.recordId===String(id),missedId);
  assert.match(await page.locator('#monitor-command').textContent(),/Derecha/i);

  await view('control');
  assert.equal(await page.locator('#theme-button img').evaluate(el=>el.complete&&el.naturalWidth>0),true);
  const beforeThemes=calls.length, accents=[];
  for(const theme of ['forest','violet','eva','rose','red']){
    assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
    accents.push(await page.locator('#api-status .status-dot').evaluate(el=>getComputedStyle(el).backgroundColor));
    for(const [size,width,height]of[['desktop',1440,1000],['mobile',390,844]]){
      await page.setViewportSize({width,height});await settle();await assertFits(`${theme}-${size}`);
      await page.screenshot({path:join(output,`theme-${theme}-${size}.png`),fullPage:true});
    }
    await page.locator('#theme-button').click();
  }
  assert.equal(new Set(accents).size,5,'Indicadores con cinco acentos');
  assert.equal(calls.length,beforeThemes,'Cambiar tema no envía órdenes');
  await page.setViewportSize({width:1024,height:520});
  await openPanel('session');
  assert.equal(await page.locator('#control-sheet').evaluate(el=>el.open),true);
  await closeSheet();
  for(const[name,width,height]of dimensions){
    await page.setViewportSize({width,height});await view('control');await settle();await assertFits(name);
    await page.screenshot({path:join(output,`${name}.png`),fullPage:true});
    await view('monitor');await settle();await assertFits(`${name}-monitor`,false);
    const allIds=[];
    while(!(await page.locator('#history-prev').isDisabled()))await page.locator('#history-prev').click();
    do{allIds.push(...await recordIds());if(await page.locator('#history-next').isDisabled())break;await page.locator('#history-next').click();}while(allIds.length<=10);
    assert.deepEqual(allIds,history.slice(-10).reverse().map(row=>row.id_historial),`${name}: diez registros accesibles sin scroll`);
    await page.screenshot({path:join(output,`${name}-monitor.png`),fullPage:true});
  }
  await view('control');await page.setViewportSize({width:390,height:844});await settle();
  await openPanel('demo');
  assert.equal(await page.locator('#control-sheet').evaluate(el=>el.open),true);
  assert.equal(await page.locator('#demo-select').inputValue(),'1');
  const beforeCancelHold = calls.length;
  await demoStart.focus();
  await page.keyboard.down('Space');
  await page.keyboard.press('Escape');
  await page.keyboard.up('Space');
  await page.waitForTimeout(980);
  assert.equal(calls.length, beforeCancelHold, 'Escape cancela el inicio sostenido');
  await openPanel('demo');
  await demoStart.focus();
  await page.keyboard.down('Space');
  await page.waitForFunction(() => document.getElementById('demo-start').dataset.phase === 'done');
  await page.keyboard.up('Space');
  assert.deepEqual(calls.slice(beforeCancelHold), ['demo:start']);
  assert.equal(await page.locator('#control-sheet').evaluate(el=>el.open),false,'El panel cierra para ver la DEMO');
  await page.waitForFunction(()=>document.getElementById('control-notice').textContent==='DEMO en curso');
  await page.locator('#stop-button').click();
  await page.waitForFunction(()=>document.getElementById('joystick').getAttribute('aria-disabled')==='false');
  await area.focus();await page.keyboard.down('ArrowUp');await settle();await page.keyboard.up('ArrowUp');await settle();
  assert.deepEqual(calls.slice(-2),[1,9],'Joystick por teclado');
  const touchBox=await area.boundingBox(),tx=touchBox.x+touchBox.width/2,ty=touchBox.y+touchBox.height/2;
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await page.waitForFunction(() => !document.querySelector('.target-cursor'));
  await openPanel('demo');
  const beforeTouchHold = calls.length;
  const demoBox = await demoStart.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: demoBox.x + demoBox.width / 2, y: demoBox.y + demoBox.height / 2 }]
  });
  await page.waitForFunction(() => document.getElementById('demo-start').dataset.phase === 'done');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.deepEqual(calls.slice(beforeTouchHold), ['demo:start'], 'Mantener con un dedo confirma una sola DEMO');
  await page.locator('#stop-button').click();
  await page.waitForFunction(() => document.getElementById('joystick').getAttribute('aria-disabled') === 'false');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx,y:ty-touchBox.width*.28}]});await settle();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle();
  assert.deepEqual(calls.slice(-2),[1,9],'Joystick táctil');
  rail=await lever.boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rail.x+rail.width/2,y:rail.y+rail.height*.85}]});await settle();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle();
  assert.deepEqual(calls.slice(-2),[6,9],'Palanca táctil y retorno');await cdp.detach();
  const favicon=await page.locator('link[rel~="icon"]').getAttribute('href');
  assert.equal((await page.request.get(new URL(favicon,url).href)).status(),200);
  assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),['control-iot-theme']);
  assert.equal(await page.evaluate(()=>sessionStorage.length),0);
  assert.match(await page.locator('#academic-credit').textContent(),/Soluciones IoT · Profesor: Víctor Manuel Pinedo Fernández/);
  rejectControl=true;await page.locator('#stop-button').click();
  await page.waitForFunction(()=>document.getElementById('action-message').textContent.includes('HTTP 401'));
  assert.equal(await page.locator('#session-status').textContent(),'Sin permiso');
  assert.equal(await page.locator('#joystick').getAttribute('aria-disabled'),'true');
  rejectControl=false;const acceptedBeforeRenewal=calls.length;
  await openPanel('session');await page.locator('#session-reconnect').click();await settle();await closeSheet();
  assert.equal(await page.locator('#joystick').getAttribute('aria-disabled'),'true');
  assert.equal(calls.length,acceptedBeforeRenewal,'Renovar acceso no envía órdenes');
  await page.locator('#stop-button').click();
  await page.waitForFunction(()=>document.getElementById('joystick').getAttribute('aria-disabled')==='false');
  assert.deepEqual(calls.slice(acceptedBeforeRenewal),[9]);
  await page.locator('#theme-button').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'violet');
  apiOnline=false;wsOnline=false;for(const socket of sockets)socket.close({code:1001,reason:'Prueba desconexión total'});
  await page.locator('#refresh-button').click();await settle();
  assert.match(await page.locator('#api-status').textContent(),/No disponible/);assert.match(await page.locator('#rds-status').textContent(),/Sin verificar/);
  await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'violet','Paleta persistida');
  assert.equal(await page.locator('#extra-controls [data-placeholder="true"]').count(),2);
  assert.equal(await page.locator('#extra-controls button:disabled').count(),2);
  assert.equal(await page.locator('#session-status').textContent(),'Sin conexión');
  assert.equal(await page.locator('#joystick').getAttribute('aria-disabled'),'true');
  apiOnline=true;wsOnline=true;await page.locator('#refresh-button').click();
  await page.waitForFunction(()=>document.getElementById('api-status').textContent.includes('Disponible'));
  await page.waitForFunction(()=>document.getElementById('ws-status').textContent.includes('En línea'),null,{timeout:10000});
  await view('monitor');await page.waitForFunction(()=>document.getElementById('monitor-history-body').querySelectorAll('tr[data-record-id]').length>0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !document.querySelector('#slats-effect canvas, .rb-warp[data-ready], .target-cursor'));
  await assertFits('monitoreo-movimiento-reducido', false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl2' ? null : getContext.call(this, type, ...args);
    };
  });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('demo-start-effect').dataset.enhanced === 'true' &&
    document.getElementById('joystick').getAttribute('aria-disabled') === 'false');
  assert.equal(await page.locator('#slats-effect canvas, .rb-warp[data-ready], #fausto-effect[data-ready]').count(), 0);
  assert.equal(await page.locator('#vehicle-name').evaluate(el => getComputedStyle(el).color === 'rgba(0, 0, 0, 0)'), false);
  await assertFits('control-sin-webgl');

  await context.route('**/iot-effects.js', route => route.abort());
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('demo-start').disabled);
  await openPanel('demo');
  const beforeFallback = calls.length;
  await demoStart.click();
  await settle();
  assert.equal(calls.length, beforeFallback);
  await demoStart.focus();
  await page.keyboard.down('Space');
  await page.waitForFunction(() => document.getElementById('control-notice').textContent === 'DEMO en curso');
  await page.keyboard.up('Space');
  assert.deepEqual(calls.slice(beforeFallback), ['demo:start'], 'Sin React el inicio conserva la pulsación sostenida');
  await page.locator('#stop-button').click();
  await page.waitForFunction(() => document.getElementById('joystick').getAttribute('aria-disabled') === 'false');
  assert.deepEqual(errors,[],'Sin errores JavaScript');
  console.log(JSON.stringify({date:new Date().toISOString(),target:'Frontend local con REST/WSS interceptados. Sin POST reales.',browser:await browser.version(),
    checks:['Subruta Pages','Joystick/palanca ratón teclado toque y parada','Luces y sonido','DEMO y cancelación','REST inicial/eventos externos',
      'Historial máximo10, orden, deduplicación y paginación','DEMO no contamina historial','Reconexión recupera datos perdidos',
      'Doce resoluciones sin scroll','Cinco paletas','React Bits, movimiento reducido y respaldo sin WebGL','Inicio DEMO al mantener pulsado con ratón, teclado y tacto','Parada única con respuesta a tiempo','401 y recuperación STOP','Sin almacenamiento de claves',
      'Indicadores independientes','Favicon y créditos'],reads,calls,errors},null,2));
})().catch(async error=>{
  console.error(error);
  if(activePage){console.log(await activePage.locator('body').innerText());await activePage.screenshot({path:join(output,'failure.png'),fullPage:true});}
  process.exitCode=1;
}).finally(async()=>{await browser?.close();server.close();});
