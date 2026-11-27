/** Grows a text box with what is typed, up to maxLines, then lets it scroll. */
export function autoGrow(el: HTMLTextAreaElement | null, maxLines = 8): void {
  if (!el) return;
  const cs = getComputedStyle(el);
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + border;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight + border, line * maxLines + pad)}px`;
  el.style.overflowY = "auto";
}
