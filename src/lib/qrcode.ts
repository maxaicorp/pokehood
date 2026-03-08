import QRCode from "qrcode";

/**
 * Generate a QR code as a PNG data URL.
 */
export async function generateQRCode(
  url: string,
  size = 400
): Promise<string> {
  return QRCode.toDataURL(url, {
    width: size,
    margin: 2,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
    errorCorrectionLevel: "H",
  });
}

/**
 * Trigger a browser download of a QR code PNG.
 */
export async function downloadQRCode(
  url: string,
  filename = "pokevault-qr.png",
  size = 600
): Promise<void> {
  const dataUrl = await generateQRCode(url, size);
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
