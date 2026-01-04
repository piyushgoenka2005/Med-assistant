export function isAllowedPrescriptionMimeType(mimeType: string) {
  const mt = mimeType.toLowerCase();
  return (
    mt === 'application/pdf' ||
    mt === 'image/png' ||
    mt === 'image/jpeg' ||
    mt === 'image/jpg' ||
    mt === 'text/plain'
  );
}
