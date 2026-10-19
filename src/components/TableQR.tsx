import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function TableQR({ url, label, size = 128 }: { url: string; label: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, {
      width: size * 2,
      margin: 1,
      color: { dark: "#171512", light: "#FFFDF8" },
      errorCorrectionLevel: "M"
    }).then((value) => {
      if (active) setDataUrl(value);
    }).catch(() => {
      if (active) setDataUrl("");
    });
    return () => {
      active = false;
    };
  }, [url, size]);

  if (!dataUrl) {
    return <div className="flex items-center justify-center rounded-lg bg-paper text-[10px] text-ink-muted" style={{ width: size, height: size }}>Generando QR</div>;
  }

  return (
    <a href={dataUrl} download={`qr-${label.replace(/\s+/g, "-").toLowerCase()}.png`} title={`Descargar QR de ${label}`}>
      <img src={dataUrl} alt={`Código QR de ${label}`} width={size} height={size} className="rounded-lg" />
    </a>
  );
}
