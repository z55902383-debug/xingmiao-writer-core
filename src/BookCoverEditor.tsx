import { useRef, useState } from 'react';
import { ImageSquare, UploadSimple, ArrowCounterClockwise, Trash } from '@phosphor-icons/react';
import { Button, Modal } from './ui';
import { tr } from './i18n';
import type { BookCover, BookSummary } from './types';

export function CoverImage({ cover, title }: { cover: BookCover; title: string }) {
  return <img className="book-cover-image" src={cover.src} alt={tr('{0} 的封面', { 0: title })}
    style={{ objectPosition: `${cover.x}% ${cover.y}%`, transform: `scale(${cover.zoom})`, transformOrigin: `${cover.x}% ${cover.y}%` }} />;
}

export default function BookCoverEditor({ book, onClose, onSave }: {
  book: BookSummary; onClose: () => void; onSave: (cover: BookCover | null) => Promise<void>;
}) {
  const [cover, setCover] = useState<BookCover | null>(book.cover || null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  async function upload(file?: File) {
    if (!file) return;
    setError(''); setReading(true);
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw Error(tr('请选择 JPG、PNG 或 WebP 图片'));
      if (file.size > 20 * 1024 * 1024) throw Error(tr('图片不能超过 20 MB'));
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(Error(tr('读取图片失败，请重试'))); reader.readAsDataURL(file);
      });
      const img = new Image();
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(Error(tr('图片无法打开，请选择其他图片'))); img.src = data; });
      const ratio = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
      const ctx = canvas.getContext('2d'); if (!ctx) throw Error(tr('无法处理图片，请重试'));
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setCover({ src: canvas.toDataURL('image/jpeg', .88), zoom: 1, x: 50, y: 50 });
    } catch (e) { setError((e as Error).message); }
    finally { setReading(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function save() {
    setBusy(true); setError('');
    try { await onSave(cover); onClose(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <Modal title={tr('作品封面')} onClose={() => { if (!busy && !reading) onClose(); }} className="cover-editor-dialog">
    <div className="modal-body cover-editor-layout">
      <div className="cover-editor-preview" aria-label={tr('3:4 封面预览')}>
        {cover ? <CoverImage cover={cover} title={book.title} /> : <div className="cover-editor-placeholder"><ImageSquare size={40} weight="light" /><span>{tr('上传你的小说封面')}</span><small>3 : 4</small></div>}
      </div>
      <div className="cover-editor-controls">
        <h3>{book.title}</h3>
        <p>{tr('封面固定以 3:4 展示。调整缩放与位置，保留你想展示的画面。')}</p>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" aria-label={tr('选择封面图片')} disabled={busy || reading} onChange={e => void upload(e.target.files?.[0])} />
        <Button onClick={() => fileInput.current?.click()} disabled={busy || reading} busy={reading}><UploadSimple size={17} />{tr(cover ? '更换封面图片' : '上传封面图片')}</Button>
        <small>{tr('JPG / PNG / WebP，最大 20 MB，图片保存在本机并随作品备份。')}</small>
        {cover && <fieldset disabled={busy || reading} className="cover-adjustments">
          {([['zoom', '缩放', 1, 3, .01], ['x', '水平位置', 0, 100, 1], ['y', '垂直位置', 0, 100, 1]] as const).map(([key, label, min, max, step]) => <label key={key}>
            <span>{tr(label)}<output>{key === 'zoom' ? `${Math.round(cover.zoom * 100)}%` : `${cover[key]}%`}</output></span>
            <input type="range" aria-label={tr(label)} min={min} max={max} step={step} value={cover[key]} onChange={e => setCover({ ...cover, [key]: Number(e.target.value) })} />
          </label>)}
          <div className="cover-editor-actions"><Button variant="ghost" onClick={() => setCover({ ...cover, zoom: 1, x: 50, y: 50 })}><ArrowCounterClockwise size={16} />{tr('重置位置')}</Button>
          <Button variant="ghost" onClick={() => setCover(null)}><Trash size={16} />{tr('删除封面')}</Button></div>
        </fieldset>}
        {error && <p className="error-box" role="alert">{error}</p>}
      </div>
    </div>
    <div className="modal-footer"><Button disabled={busy || reading} onClick={onClose}>{tr('取消')}</Button><Button variant="primary" disabled={reading} busy={busy} onClick={() => void save()}>{tr('保存封面')}</Button></div>
  </Modal>;
}
