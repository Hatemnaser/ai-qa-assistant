export const ACCOUNT_DATA_EXPORT_FILENAME = "account-data-export.zip";

export function downloadAccountDataExport(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");

  link.href = url;
  link.download = ACCOUNT_DATA_EXPORT_FILENAME;

  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
