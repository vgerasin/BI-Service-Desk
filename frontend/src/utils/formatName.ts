// "Груздев Александр Геннадьевич" → "Груздев А.Г."; degrades gracefully for names with
// fewer parts ("Груздев Александр" → "Груздев А.", "Груздев" → "Груздев").
export function shortFullName(fullName?: string | null): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  const [surname, ...rest] = parts;
  const initials = rest.map(p => `${p[0].toUpperCase()}.`).join('');
  return `${surname} ${initials}`;
}

// The "заявитель" (requester) shown across the app is normally whoever filed the request
// (createdBy). "Заявитель другой" (see RequestsPage "Новая заявка") lets staff file it on a
// colleague's behalf instead — in that case the colleague (onBehalfOfName/Email) IS the
// requester everywhere it's displayed, with `via` naming who actually filled the form, so the
// distinction stays visible rather than silently attributing the request to the wrong person.
// Billing-company legal names are long ("ООО «Специализированный застройщик «Ромашка»»") and overflow table cells / detail-card rows. The brand people actually
// recognize is whatever sits in the innermost «...» quotes, so pull that out for display —
// full name still available via title/tooltip.
export function shortCompanyName(name?: string | null): string {
  if (!name) return '';
  const lastOpen = name.lastIndexOf('«');
  const close = name.indexOf('»', lastOpen);
  if (lastOpen === -1 || close === -1) return name;
  return name.slice(lastOpen + 1, close);
}

export function requesterDisplay(req: {
  createdBy?: { fullName?: string; email?: string } | null;
  onBehalfOfName?: string | null;
  onBehalfOfEmail?: string | null;
}): { name: string; email: string; via?: string } {
  if (req.onBehalfOfName) {
    return { name: req.onBehalfOfName, email: req.onBehalfOfEmail || '', via: req.createdBy?.fullName };
  }
  return { name: req.createdBy?.fullName || '', email: req.createdBy?.email || '' };
}
