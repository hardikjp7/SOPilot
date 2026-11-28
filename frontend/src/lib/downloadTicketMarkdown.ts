export function downloadTicketMarkdown(ticketId: string, markdown: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const revoke = URL.revokeObjectURL.bind(URL);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${ticketId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'incident-ticket'}.md`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the browser a task to consume the download before releasing its URL.
    setTimeout(() => revoke(url), 1000);
  }
}
