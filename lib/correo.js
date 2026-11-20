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

// Estilo igual al de la web: neutros + un acento índigo, tipografía Inter (con respaldo del sistema).
// Todo va "inline" y con tablas, porque los clientes de correo ignoran casi todo el CSS externo.
const FUENTE = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const plantilla = (cuerpo) => `
  <div style="background:#fafafa;padding:24px 12px;font-family:${FUENTE};color:#18181b;line-height:1.6;font-size:16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto">
      <tr><td style="padding:0 4px 14px;font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#18181b">Studio-<span style="color:#4f46e5">IA</span></td></tr>
      <tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;padding:28px">${cuerpo}</td></tr>
      <tr><td style="padding:14px 4px 0;font-size:12px;color:#71717a">Studio-IA · Diagnóstico de procesos automatizables</td></tr>
    </table>
  </div>`;

const boton = (url, texto) =>
  `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">${texto}</a></p>`;

// Correo al terminar: enlace del informe
export function enviarInforme(opts) {
  const copia = process.env.CORREO_COPIA; // tu correo, para recibir cada diagnóstico
  return enviar({
    to: opts.para,
    bcc: copia || undefined,
    subject: `Tu diagnóstico de automatización${opts.empresa ? ` · ${opts.empresa}` : ""}`,
    html: plantilla(`
      <p>Hola ${escapar(opts.nombre)},</p>
      <p>Tu diagnóstico está listo. Te mostramos qué actividades de tu día a día se pueden automatizar con IA, qué herramientas necesitas, cuánto tiempo podrías ahorrar y un plan para los próximos 90 días.</p>
      ${boton(opts.url, "Ver mi diagnóstico")}
      <p style="color:#71717a;font-size:13px;margin:0">Puedes guardarlo en PDF desde el botón «Descargar PDF» del informe.</p>`),
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
      <p style="color:#71717a;font-size:13px;margin:0">Es un enlace personal: no lo compartas, porque da acceso a tu conversación.</p>`),
  });
}

function escapar(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
