// ===== Servidor de Welder BeOn (Cloudflare Worker) =====
// Guarda los datos de la app (planos, parámetros, materiales…) y las fotos, para que el Mac y el móvil vean lo mismo.
// Entrar: usuario + código. Necesita un espacio KV enlazado con el nombre KV. Nada más.
const APP_OK = /^https:\/\/carreterobike\.github\.io$/;
const USER_OK = /^[a-z0-9._-]{3,20}$/;
const CODE_OK = /^.{4,40}$/;
const ID_OK = /^[A-Za-z0-9_-]{1,60}$/;
const ITER = 20000;   // como Ichnos: el plan gratis de Cloudflare da poco tiempo de cálculo
const te = new TextEncoder();

export default {
  async fetch(req, env) {
    const url = new URL(req.url), P = url.pathname, o = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': APP_OK.test(o) ? o : 'https://carreterobike.github.io',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400', 'Vary': 'Origin',
    };
    const J = (x, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      if (!env.KV) return J({ error: 'Falta enlazar el espacio KV con el nombre KV' }, 500);
      const KV = env.KV;
      if (P === '/' || P === '/estado') return J({ ok: true, app: 'welder-beon' });

      // Entrar (la primera vez crea la cuenta con ese usuario y código)
      if (P === '/entrar' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const user = String(b.user || '').trim().toLowerCase(), code = String(b.code || '');
        if (!USER_OK.test(user)) return J({ error: 'El usuario: de 3 a 20 letras o números, sin espacios.' }, 400);
        if (!CODE_OK.test(code)) return J({ error: 'El código: al menos 4 caracteres.' }, 400);
        const fk = 'fallos:' + user, fallos = +(await KV.get(fk) || 0);
        if (fallos >= 10) return J({ error: 'Demasiados intentos. Espera 15 minutos.' }, 429);
        let u = await KV.get('u:' + user, 'json'), nuevo = false;
        if (!u) {
          if (b.crear !== true) return J({ error: 'Ese usuario no existe.', noExiste: true }, 404);
          const salt = rnd(16); u = { salt, h: await hashPw(code, salt), creado: Date.now() };
          await KV.put('u:' + user, JSON.stringify(u)); nuevo = true;
        } else if (await hashPw(code, u.salt) !== u.h) {
          await KV.put(fk, String(fallos + 1), { expirationTtl: 900 });
          return J({ error: 'El código no es correcto.' }, 401);
        }
        const t = rnd(32); await KV.put('s:' + t, user);
        return J({ t, user, nuevo });
      }

      // A partir de aquí hace falta haber entrado
      const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const user = tok && /^[\w-]{20,80}$/.test(tok) ? await KV.get('s:' + tok) : null;
      if (!user) return J({ error: 'Tienes que volver a entrar.' }, 401);

      if (P === '/salir' && req.method === 'POST') { await KV.delete('s:' + tok); return J({ ok: true }); }

      if (P === '/datos') {
        const cur = await KV.get('d:' + user, 'json') || { v: 0, d: null };
        if (req.method === 'GET') return J(cur);
        if (req.method === 'PUT') {
          const b = await req.json().catch(() => null);
          if (!b || typeof b.d !== 'object') return J({ error: 'Datos no válidos' }, 400);
          if ((b.base | 0) !== (cur.v | 0)) return J({ error: 'Han cambiado los datos desde el otro aparato', v: cur.v }, 409);
          const nv = { v: (cur.v | 0) + 1, d: b.d, ts: Date.now() };
          const s = JSON.stringify(nv); if (s.length > 20e6) return J({ error: 'Demasiado grande' }, 413);
          await KV.put('d:' + user, s);
          if (nv.v % 50 === 0) await KV.put('copia:' + user + ':' + new Date().toISOString().slice(0, 10), s, { expirationTtl: 60 * 86400 });
          return J({ v: nv.v });
        }
      }

      const fm = P.match(/^\/foto\/([A-Za-z0-9_-]+)$/);
      if (fm && ID_OK.test(fm[1])) {
        const k = 'f:' + user + ':' + fm[1];
        if (req.method === 'GET') {
          const v = await KV.get(k, 'arrayBuffer');
          if (!v) return new Response('No existe', { status: 404, headers: cors });
          return new Response(v, { headers: { ...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' } });
        }
        if (req.method === 'PUT') {
          const buf = await req.arrayBuffer();
          if (buf.byteLength > 20e6) return J({ error: 'Foto demasiado grande' }, 413);
          await KV.put(k, buf); return J({ ok: true, id: fm[1] });
        }
        if (req.method === 'DELETE') { await KV.delete(k); return J({ ok: true }); }
      }
      return J({ error: 'No existe' }, 404);
    } catch (e) { return J({ error: 'Error del servidor: ' + (e && e.message || e) }, 500); }
  }
};

function rnd(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64u(a); }
function b64u(buf) { const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (const x of a) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(salt), iterations: ITER }, k, 256));
}
