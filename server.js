const express = require('express');
const fetch = require('node-fetch');
const app = express();

const API_BASE = 'https://b2b.atosa.es:880/api';
const API_USER = 'amazon@espana.es';      // Pon aquí tu usuario ATOSA
const API_PASS = '0glLD6g7Dg';            // Pon aquí tu contraseña ATOSA

// Permitir CORS desde cualquier origen
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // Para pruebas, puedes poner tu dominio si quieres más seguro
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Proxy de artículos genérico
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Proxy ATOSA escuchando en puerto', PORT));