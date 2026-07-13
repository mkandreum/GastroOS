export async function sendZplDirectToPrinter(zpl: string, ip: string, port: number): Promise<boolean> {
  try {
    const url = `http://${ip}:${port}/`;
    const resp = await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: zpl
    });
    console.log(`[DirectPrint] Enviado a ${ip}:${port} (no-cors, status: ${resp.type})`);
    return true;
  } catch (err) {
    console.error(`[DirectPrint] Error enviando a ${ip}:${port}:`, err);
    return false;
  }
}

export async function tryDirectPrint(orderId: string): Promise<boolean> {
  try {
    const configRes = await fetch("/api/printer-config");
    if (!configRes.ok) return false;
    const config = await configRes.json();

    if (!config.enabled || config.printMode !== "browser" || !config.ip) {
      console.log("[DirectPrint] Modo servidor o impresora deshabilitada, saltando direct print");
      return false;
    }

    const zplRes = await fetch(`/api/orders/${orderId}/zpl`);
    if (!zplRes.ok) return false;
    const data = await zplRes.json();
    if (!data.zpl) return false;

    return await sendZplDirectToPrinter(data.zpl, config.ip, config.port);
  } catch (err) {
    console.error("[DirectPrint] Error en tryDirectPrint:", err);
    return false;
  }
}
