const express = require('express');
const fetch = require('node-fetch');
const axios = require('axios');
const Excel = require('exceljs');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({limit: '1mb'})); // Para POST JSON

const API_BASE = 'https://b2b.atosa.es:880/api';
const API_USER = 'amazon@espana.es';      // Pon aquí tu usuario ATOSA
const API_PASS = '0glLD6g7Dg';            // Pon aquí tu contraseña ATOSA

// --- 1. Proxy genérico ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // Para pruebas, puedes poner tu dominio si quieres más seguro
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/proxy/*', async (req, res) => {
  const apiPath = req.params[0];
  const url = `${API_BASE}/${apiPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
  try {
    const apiRes = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${API_USER}:${API_PASS}`).toString('base64')
      }
    });
    const contentType = apiRes.headers.get('content-type');
    res.set('content-type', contentType);
    const data = await apiRes.text();
    res.status(apiRes.status).send(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 2. Generador de Excel con imágenes ---
const GRUPOS_URL = 'https://raw.githubusercontent.com/tuusuario/turepo/main/grupos.xlsx'; // Cambia aquí la URL de grupos.xlsx
const API_FOTO = `${API_BASE}/articulos/foto/`; // Para las imágenes

const IDIOMAS = {
  "Español": {
      "codigo": "Código",
      "descripcion": "Descripción",
      "disponible": "Disponible",
      "ean13": "EAN13",
      "precioVenta": "Precio",
      "umv": "UMV",
      "imagen": "Imagen"
  },
  "Inglés": {
      "codigo": "Code",
      "descripcion": "Description",
      "disponible": "Available",
      "ean13": "EAN13",
      "precioVenta": "Price",
      "umv": "MOQ",
      "imagen": "Image"
  }
};

app.post('/api/genera-excel', async (req, res) => {
  try {
    const { grupo, idioma = "Español" } = req.body || {};
    if (!grupo) return res.status(400).json({ error: "Falta el grupo" });

    // 1. Descargar grupos.xlsx de GitHub
    const xlsxBuffer = (await axios.get(GRUPOS_URL, { responseType: 'arraybuffer' })).data;
    const workbook = XLSX.read(xlsxBuffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const grupos = XLSX.utils.sheet_to_json(sheet);

    // 2. Descargar todos los artículos de la API Atosa
    const apiResponse = await axios.get(`${API_BASE}/articulos/`, {
      auth: { username: API_USER, password: API_PASS },
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
    });
    const articulos = apiResponse.data;

    // 3. Filtrar artículos por grupo seleccionado
    const codigosGrupo = grupos.filter(g => g.grupo === grupo).map(g => String(g.codigo));
    const articulosFiltrados = articulos.filter(a => codigosGrupo.includes(String(a.codigo)));

    if (!articulosFiltrados.length)
      return res.status(404).json({ error: "No hay artículos para ese grupo" });

    // 4. Crear Excel
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet('Listado');
    const campos = [
      { key: "codigo", header: IDIOMAS[idioma]?.codigo || "Código", width: 12 },
      { key: "descripcion", header: IDIOMAS[idioma]?.descripcion || "Descripción", width: 40 },
      { key: "disponible", header: IDIOMAS[idioma]?.disponible || "Disponible", width: 12 },
      { key: "ean13", header: "EAN13", width: 12 },
      { key: "precioVenta", header: IDIOMAS[idioma]?.precioVenta || "Precio", width: 12 },
      { key: "umv", header: IDIOMAS[idioma]?.umv || "UMV", width: 10 },
      { key: "imagen", header: IDIOMAS[idioma]?.imagen || "Imagen", width: 18 }
    ];
    ws.columns = campos;

    // 5. Descargar imágenes y añadir filas
    for (let i = 0; i < articulosFiltrados.length; i++) {
      const a = articulosFiltrados[i];
      const fila = {
        codigo: a.codigo,
        descripcion: a.descripcion,
        disponible: a.disponible,
        ean13: a.ean13,
        precioVenta: a.precioVenta,
        umv: a.umv,
        imagen: "" // La celda donde irá la imagen
      };
      const row = ws.addRow(fila);
      row.height = 90;

      // --- Imágenes: descarga y añade
      try {
        const fotoResp = await axios.get(`${API_FOTO}${a.codigo}`, {
          auth: { username: API_USER, password: API_PASS },
          httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });
        if (fotoResp.data && fotoResp.data.fotos && fotoResp.data.fotos[0]) {
          const imgBuffer = Buffer.from(fotoResp.data.fotos[0], 'base64');
          // Guardar temporalmente la imagen
          const tmpName = path.join(__dirname, `tmp_${a.codigo}.jpg`);
          fs.writeFileSync(tmpName, imgBuffer);

          const imgId = wb.addImage({
            filename: tmpName,
            extension: 'jpeg',
          });
          // Columna imagen = 7 (G), fila = row.number
          ws.addImage(imgId, {
            tl: { col: 6, row: row.number - 1 },
            ext: { width: 110, height: 110 }
          });
          fs.unlinkSync(tmpName); // Borra la imagen temporal
        }
      } catch (err) {
        // Si no hay imagen, no pasa nada
      }
    }

    // 6. Enviar el Excel como descarga
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="listado_${grupo}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando Excel', detail: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Proxy ATOSA escuchando en puerto', PORT));