export function downloadProjectExport(blob: Blob, projectName: string) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");

  link.href = url;
  link.download = createProjectExportFileName(projectName);

  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export function createProjectExportFileName(projectName: string) {
  const safeName = projectName
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/[. -]+$/g, "")
    .slice(0, 100);

  return `${safeName || "project"}-export.zip`;
}
