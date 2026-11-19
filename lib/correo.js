import nodemailer from "nodemailer";

// Envío de correos por SMTP con nodemailer (opcional). Si faltan las variables, no envía nada.
//   SMTP_HOST, SMTP_PORT (587 por defecto), SMTP_SECURE (true para el puerto 465),
//   SMTP_USER, SMTP_PASS, CORREO_REMITENTE y, opcional, CORREO_COPIA.
let transporte = null;

function configuracion() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, CORREO_REMITENTE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !CORREO_REMITENTE) return null;
  transporte ??= nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return { transporte, remitente: CORREO_REMITENTE };
}

async function enviar(mensaje) {
  const cfg = configuracion();
  if (!cfg) return { enviado: false, motivo: "sin configuración" };
  try {
    await cfg.transporte.sendMail({ from: cfg.remitente, ...mensaje });
    return { enviado: true };
  } catch (e) {
    console.error("[correo] SMTP falló:", e.message);
    return { enviado: false, motivo: "SMTP" };
  }
}

const plantilla = (cuerpo) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;color:#14203A">
    <div style="background:#14203A;padding:20px 24px;border-radius:12px 12px 0 0">
      <span style="color:#F4C766;font-weight:bold;letter-spacing:.08em">STUDIO-IA</span>
    </div>
    <div style="background:#F6F7FA;padding:24px;border-radius:0 0 12px 12px">${cuerpo}</div>
  </div>`;

const boton = (url, texto) =>
  `<p style="margin:28px 0"><a href="${url}" style="background:#D4961A;color:#14203A;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${texto}</a></p>`;

// Correo al terminar: enlace del informe
export function enviarInforme(opts) {
  const copia = process.env.CORREO_COPIA; // tu correo, para recibir cada diagnóstico
  return enviar({
    to: opts.para,
    bcc: copia || undefined,
    subject: `Tu diagnóstico de automatización${opts.empresa ? ` · ${opts.empresa}` : ""}`,
    html: plantilla(`
      <p>Hola ${escapar(opts.nombre)},</p>
      <p>Tu diagnóstico de procesos automatizables está listo. Incluye tus oportunidades priorizadas, la solución más simple para cada una, el ahorro estimado y una hoja de ruta de 30-60-90 días.</p>
      ${boton(opts.url, "Ver mi diagnóstico")}
      <p style="color:#5B677F;font-size:13px">Puedes guardarlo en PDF desde el botón «Descargar PDF» del informe.</p>`),
  });
}

// Correo al registrarse: enlace personal para retomar la conversación desde cualquier dispositivo.
// Quien tenga el enlace puede ver la conversación, por eso no se envía copia (bcc) a nadie más.
export function enviarEnlaceRetomar(opts) {
  return enviar({
    to: opts.para,
    subject: "Continúa tu diagnóstico de automatización",
    html: plantilla(`
      <p>Hola ${escapar(opts.nombre)},</p>
      <p>Empezaste tu diagnóstico de automatización. Si lo cierras o cambias de dispositivo, puedes continuar justo donde lo dejaste con este enlace:</p>
      ${boton(opts.url, "Continuar mi diagnóstico")}
      <p style="color:#5B677F;font-size:13px">Es un enlace personal: no lo compartas, porque da acceso a tu conversación.</p>`),
  });
}

function escapar(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
