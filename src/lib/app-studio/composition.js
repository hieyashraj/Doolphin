export function resolveAppCompositionGeometry(composition, width, height) {
  const mode = ["PIP", "SIDE_BY_SIDE", "INSERT", "FULL_SCREEN"].includes(composition) ? composition : "INSERT";
  if (mode === "PIP") {
    const targetWidth = Math.max(2, Math.floor(width * 0.42 / 2) * 2);
    const targetHeight = Math.max(2, Math.floor(height * 0.42 / 2) * 2);
    const margin = Math.max(12, Math.floor(Math.min(width, height) * 0.03));
    return { mode, targetWidth, targetHeight, overlayX: width - targetWidth - margin, overlayY: height - targetHeight - margin };
  }
  if (mode === "SIDE_BY_SIDE") {
    const targetWidth = Math.max(2, Math.floor(width / 2 / 2) * 2);
    return { mode, targetWidth, targetHeight: height, overlayX: width - targetWidth, overlayY: 0 };
  }
  if (mode === "INSERT") {
    const targetWidth = Math.max(2, Math.floor(width * 0.9 / 2) * 2);
    const targetHeight = Math.max(2, Math.floor(height * 0.9 / 2) * 2);
    return { mode, targetWidth, targetHeight, overlayX: Math.floor((width - targetWidth) / 2), overlayY: Math.floor((height - targetHeight) / 2) };
  }
  return { mode, targetWidth: width, targetHeight: height, overlayX: 0, overlayY: 0 };
}
