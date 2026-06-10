import QRCode from 'qrcode';

/**
 * Genera el QR fiscal AFIP según RG 4291/2018.
 * Contenido: URL con JSON en base64 → https://www.afip.gob.ar/fe/qr/?p=BASE64
 */
export async function generateAfipQR(comprobante, empresaCuit, pvNumero) {
  const tipoMap = { A: 1, B: 6, C: 11 };
  const qrData = {
    ver: 1,
    fecha: comprobante.fecha?.slice(0, 10) ?? '',
    cuit: parseInt(empresaCuit?.replace(/-/g, '') ?? '0'),
    ptoVta: pvNumero ?? 1,
    tipoCmp: tipoMap[comprobante.tipo_comprobante_afip] ?? 6,
    nroCmp: parseInt(comprobante.numero_afip?.split('-')[1] ?? '0'),
    importe: Number(comprobante.total),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: 99,
    nroDocRec: 0,
    tipoCodAut: 'E',
    codAut: parseInt(comprobante.cae ?? '0'),
  };

  const base64 = btoa(JSON.stringify(qrData));
  const url = `https://www.afip.gob.ar/fe/qr/?p=${base64}`;

  return QRCode.toDataURL(url, {
    width: 120,
    margin: 1,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}
