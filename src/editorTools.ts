export function revealSelection(
  editor: HTMLTextAreaElement,
  start: number,
  end: number,
) {
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(start, end);
  const scroller = editor.closest<HTMLElement>(".editor-scroll");
  if (!scroller) return;
  const mirror = document.createElement("div");
  const style = getComputedStyle(editor);
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    left: "-10000px",
    top: "0",
    width: `${editor.getBoundingClientRect().width}px`,
    boxSizing: style.boxSizing,
    font: style.font,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    padding: style.padding,
    border: style.border,
    whiteSpace: "pre-wrap",
    overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak,
    tabSize: style.tabSize,
  });
  mirror.append(document.createTextNode(editor.value.slice(0, start)));
  const mark = document.createElement("span");
  mark.textContent = editor.value.slice(start, end) || " ";
  mirror.append(mark, document.createTextNode(editor.value.slice(end)));
  document.body.append(mirror);
  const y =
    scroller.scrollTop +
    editor.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    mark.offsetTop;
  mirror.remove();
  scroller.scrollTo({
    top: Math.max(0, y - scroller.clientHeight / 3),
    behavior: "instant",
  });
}
