// Ejecutar con playwright-cli run-code --filename=docs/tests/commercial-layout.playwright.js.
// Intercepta únicamente una API de loopback. El sitio normal nunca utiliza estos datos.
async page => {
  const cases = ['demo', 'worst', 'empty', 'one', '1000'];
  const title = 'Centro de Mantenimiento Industrial del Corredor Metropolitano de CDMX';
  const longMail = 'bartholomew.fitzgerald@northwind-industries-operaciones-internacionales-servicio-tecnico.example.com';
  const base = { id_vehiculo: 1, nombre: 'Cargadora centro', identificador_fisico: 'CARGA-C01', nombre_modelo: 'Máquina de carga IoT',
    estado_comercial: 'vendida', propietario: 'Jo', dispositivo: true };
  const difficult = [
    { ...base, nombre: title, identificador_fisico: 'CARGADORA-RC-26-MX-00031-NORTE-SERVICIO-DE-DISTRIBUCION-Y-MANTENIMIENTO',
      nombre_modelo: '車両遠隔測定マシン', propietario: 'Aleksandra Wiśniewska-Kowalczyk' },
    { ...base, id_vehiculo: 2, nombre: 'Ú', identificador_fisico: null, nombre_modelo: null,
      estado_comercial: null, propietario: null, dispositivo: false },
  ];
  const count = values => Number(values.limit ?? 25);
  const ok = (expression, message) => { if (!expression) throw new Error(message); };
  const now = new Date().toISOString();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.route('http://127.0.0.1:8000/**', async route => {
    const req = route.request();
    const target = new URL(req.url());
    const { pathname, searchParams } = target;
    const params = Object.fromEntries(searchParams);
    const scenario = new URL(page.url()).searchParams.get('data') ?? 'demo';
    const fixture = scenario === '1000' ? Array.from({ length: 1000 }, (_, index) => ({ ...base,
      id_vehiculo: index + 1, nombre: `Cargadora ${String(index + 1).padStart(4, '0')}` }))
      : ({ worst: difficult, empty: [], one: [difficult[1]] })[scenario] ?? [base];
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:5500', 'access-control-allow-headers': 'Content-Type, Authorization',
      'access-control-allow-methods': 'GET, POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const values = {
      '/health': { status: 'ok' }, '/health/rds': { status: 'ok', database: 'RDS' }, '/plataforma/config': { activa: true },
      '/plataforma/catalogo': [], '/plataforma/mis-unidades': [],
      '/plataforma/sesion': { token: 'datos-de-prueba-en-memoria', vence: new Date(Date.now() + 120000).toISOString(),
        cuenta: { id_cliente: 1, nombre: 'Operación de flota', rol: 'administrador' } },
      '/plataforma/dashboard': { modelos: scenario === 'worst' ? 2147483647 : 1, unidades: fixture.length,
        asignadas: Math.min(1, fixture.length), reservas: 0, conectadas: Math.min(1, fixture.length) },
      '/plataforma/unidades': fixture.slice(Number(params.offset ?? 0), Number(params.offset ?? 0) + count(params)),
      '/plataforma/clientes': [{ id_cliente: 8, nombre: 'Aleksandra Wiśniewska-Kowalczyk', correo: longMail, activo: true },
        { id_cliente: 9, nombre: 'Jo', correo: 'jo@centro.example.com', activo: false }],
      '/plataforma/auditoria': fixture.length ? [{ id_evento: 1000, fecha: now, actor: null, rol: 'sistema',
        accion: 'credencial_dispositivo', recurso: 'unidad', id_recurso: 2147483647, resultado: 'correcto' }] : [],
    };
    const body = values[pathname];
    const status = body === undefined ? 404 : req.method() === 'POST' ? 201 : 200;
    await route.fulfill({ status, headers, json: body ?? { detail: 'Ruta sin fixture' } });
  });

  const baseUrl = 'http://127.0.0.1:5500/?api=local';
  await page.addInitScript(() => {
    const theme = new URL(location.href).searchParams.get('tema') === 'rosa' ? 'rose' : 'silver';
    localStorage.setItem('control-iot-theme', theme);
  });
  const open = async (scenario, rose = false) => {
    await page.goto(`${baseUrl}&data=${scenario}${rose ? '&tema=rosa' : ''}`);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByLabel('Correo electrónico', { exact: true }).fill('qa@example.com');
    await page.getByLabel('Contraseña', { exact: true }).fill('solo-datos-interceptados');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('navigation', { name: 'Vistas de la aplicación' })
      .getByRole('button', { name: 'Administración', exact: true }).click();
    await page.getByRole('heading', { name: 'Administración', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Unidades', exact: true }).click();
    if (scenario === 'empty') await page.getByText('No hay unidades en esta búsqueda.').waitFor();
    else await page.locator('#commercial-content tbody tr').first().waitFor();
  };

  const dimensions = ([width, height]) => page.setViewportSize({ width, height });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const results = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const size of [[320, 568], [1440, 900], [1920, 1080]]) {
    await dimensions(size);
    for (const scenario of cases) {
      await open(scenario);
      ok(await fits(), `${size[0]}px: desbordamiento en ${scenario}`);
      const rows = page.locator('#commercial-content tbody tr');
      if (scenario === 'one') ok(await rows.count() === 1, 'La tabla de un registro debe tener una fila');
      if (scenario === '1000') {
        ok(await rows.count() === 25, 'El inventario debió paginar 1,000 registros');
        await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
        await page.getByText('Cargadora 0026', { exact: true }).waitFor();
      }
      results.push(`${size[0]}px ${scenario}`);
    }
  }
  await dimensions([320, 720]);
  await open('worst', true);
  ok(await page.locator('html').getAttribute('data-theme') === 'rose', 'Paleta clara activa');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await page.getByText(longMail, { exact: true }).waitFor();
  ok(await fits(), 'El correo no debe desbordar al 200%');
  await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Guardar', exact: true }).scrollIntoViewIfNeeded();
  const save = await page.getByRole('button', { name: 'Guardar', exact: true }).boundingBox();
  ok(save && save.y + save.height <= 721, 'Guardar debe quedar alcanzable con scroll');
  ok(errors.length === 0, errors.join('\n'));
  return { casos: results, zoom: '200%', paletas: ['silver', 'rose'], total: results.length + 1 };
}
