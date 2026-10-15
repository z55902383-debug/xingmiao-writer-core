// Findings are suggestions with UTF-16 offsets matching browser text selections.
export function checkProse(text) {
  const findings = [];
  const add = (kind, start, end, message) => findings.push({ id: `${kind}:${start}:${end}`, kind, start, end, excerpt: text.slice(start, end), line: text.slice(0, start).split('\n').length, message });
  const lines = [...text.matchAll(/[^\r\n]+/g)];
  const seen = new Map();
  for (const match of lines) {
    const value = match[0].trim();
    if (value.length >= 24 && !/^[“「『"]/.test(value)) {
      if (seen.has(value)) add('repeat', match.index, match.index + match[0].length, '这段与前文完全重复，请核对是否需要保留。');
      else seen.set(value, match.index);
    }
  }
  for (const match of text.matchAll(/(?:\bTODO\b|\bplaceholder\b|[（(](?:此处|以下|后续)?(?:省略|待补)[^）)\n]{0,30}[）)]|\uFFFD)/gi)) {
    add('placeholder', match.index, match.index + match[0].length, '疑似占位内容或损坏字符，请核对。');
  }
  for (const match of lines) {
    if (/^[“「『"]/.test(match[0].trim())) continue;
    const leak = /^(?:\s*)(?:以下是(?:本章|续写|修改后)?正文[：:]?|作为(?:一个)?AI(?:语言模型|助手)?[，,:：]|(?:目标情绪|章尾钩子|情节点)[：:])/.exec(match[0]);
    if (leak) add('meta', match.index, match.index + leak[0].length, '疑似生成说明混入正文，请核对语境。');
  }
  const tail = text.trimEnd();
  if (tail.length >= 20 && !/[。！？!?…」』”"）)】\]]$/.test(tail)) {
    const start = Math.max(0, tail.length - 40);
    add('ending', start, tail.length, '末尾没有常见结束标点，可能尚未写完；开放式结尾可以忽略。');
  }
  return findings.sort((a, b) => a.start - b.start);
}
