# HTTPS en desarrollo

Los sensores exigen contexto seguro. Desde el móvil llegas por la IP de LAN,
que en `http://` **nunca** es contexto seguro. Así que no hay desarrollo sin TLS.

## Ahora mismo (funciona, con una pega)

`npm run dev` ya levanta HTTPS con `@vitejs/plugin-basic-ssl` y `host: true`.
Entras desde el móvil por `https://<IP-del-Mac>:5173` y aceptas el aviso de
certificado.

**La pega:** el origen es la IP. Si el router cambia la IP del Mac, cambia el
origen, y con el origen pierdes el permiso de sensores concedido y todo el
`localStorage`. Fija la IP en el router o usa el túnel.

Tu IP de LAN:

```bash
ipconfig getifaddr en0 || ipconfig getifaddr en1
```

## Lo que pide el handoff (hostname estable)

Esto **no lo he montado**: necesita una cuenta de Cloudflare y el dominio
`tiraje.es`, que es la pregunta abierta nº2 del handoff (¿lo compra el estudio
o Ambar?). Cuando esté decidido, son cuatro comandos:

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create tiraje-dev
cloudflared tunnel route dns tiraje-dev dev.tiraje.es
```

Y luego, con `npm run dev` corriendo:

```bash
cloudflared tunnel --url https://localhost:5173 --no-tls-verify run tiraje-dev
```

Con eso el origen es siempre `https://dev.tiraje.es`: el permiso de iOS y el
`localStorage` sobreviven a los reinicios, que es el único motivo de montarlo.
