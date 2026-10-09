import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import type { ManuscriptFormat } from "../electron/manuscript-format.mjs";

export type ParagraphEdit = { start: number; end: number; insert: string };

/** Only whitespace at a paragraph boundary is adjusted; body characters stay intact. */
export function nextParagraphEdit(
  text: string,
  start: number,
  end: number,
  format: ManuscriptFormat,
): ParagraphEdit {
  const indent = "\u3000".repeat(format.indent);
  const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const emptyLine = /^[ \t\u3000]*$/.test(text.slice(lineStart, start));
  const rightIndent = text.slice(end).match(/^[ \t\u3000]*/)?.[0].length || 0;
  // A second Enter on an empty paragraph adds one blank line, without leaving
  // invisible indentation on the previous line or multiplying paragraph gaps.
  return {
    start: emptyLine ? lineStart : start,
    end: end + rightIndent,
    insert:
      (emptyLine || format.paragraphSpacing === "compact" ? "\n" : "\n\n") +
      indent,
  };
}

function insertNative(
  element: HTMLTextAreaElement,
  edit: ParagraphEdit,
  onChange: (text: string) => void,
) {
  element.setSelectionRange(edit.start, edit.end);
  // Electron's textarea editing command participates in native undo. Assigning
  // value/setRangeText alone would silently discard that undo transaction.
  const inserted =
    element.ownerDocument.activeElement === element &&
    element.ownerDocument.execCommand("insertText", false, edit.insert);
  if (!inserted) {
    element.setRangeText(edit.insert, edit.start, edit.end, "end");
  }
  onChange(element.value);
}

export function handleManuscriptEnter(
  event: KeyboardEvent<HTMLTextAreaElement>,
  format: ManuscriptFormat,
  onChange: (text: string) => void,
): boolean {
  if (
    event.key !== "Enter" ||
    !format.autoIndent ||
    event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229 ||
    event.currentTarget.readOnly ||
    event.currentTarget.disabled
  )
    return false;
  event.preventDefault();
  const element = event.currentTarget;
  insertNative(
    element,
    nextParagraphEdit(
      element.value,
      element.selectionStart,
      element.selectionEnd,
      format,
    ),
    onChange,
  );
  return true;
}

/** Native beforeinput preserves text input, paste, IME composition and undo semantics. */
export function useManuscriptTyping(
  ref: RefObject<HTMLTextAreaElement | null>,
  format: ManuscriptFormat,
  onChange: (text: string) => void,
  documentKey?: string,
) {
  const latest = useRef({ format, onChange });
  latest.current = { format, onChange };
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let composing = false;
    let indentComposition = false;
    let frame = 0;
    const beforeInput = (event: InputEvent) => {
      const { format, onChange } = latest.current;
      if (
        composing ||
        event.isComposing ||
        !format.autoIndent ||
        !format.indent ||
        element.value !== "" ||
        element.readOnly ||
        element.disabled ||
        event.inputType !== "insertText" ||
        !event.data ||
        Array.from(event.data).length !== 1 ||
        !event.cancelable
      )
        return;
      event.preventDefault();
      insertNative(
        element,
        {
          start: 0,
          end: 0,
          insert: "\u3000".repeat(format.indent) + event.data,
        },
        onChange,
      );
    };
    const compositionStart = () => {
      composing = true;
      indentComposition = element.value === "";
    };
    const compositionEnd = () => {
      composing = false;
      if (!indentComposition) return;
      indentComposition = false;
      // The final input event can follow compositionend. Wait until it has
      // committed before inserting an indent, never alter the composing range.
      frame = requestAnimationFrame(() => {
        const { format, onChange } = latest.current;
        if (
          element.ownerDocument.activeElement !== element ||
          !format.autoIndent ||
          !format.indent ||
          element.readOnly ||
          element.disabled ||
          !element.value.trim() ||
          /^[ \t\u3000]/.test(element.value)
        )
          return;
        const start = element.selectionStart;
        const end = element.selectionEnd;
        insertNative(
          element,
          { start: 0, end: 0, insert: "\u3000".repeat(format.indent) },
          onChange,
        );
        element.setSelectionRange(start + format.indent, end + format.indent);
      });
    };
    element.addEventListener("beforeinput", beforeInput);
    element.addEventListener("compositionstart", compositionStart);
    element.addEventListener("compositionend", compositionEnd);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("beforeinput", beforeInput);
      element.removeEventListener("compositionstart", compositionStart);
      element.removeEventListener("compositionend", compositionEnd);
    };
  }, [ref, documentKey]);
}
