import { useId, useState, type ReactNode } from 'react';
import { CaretDown, Info } from '@phosphor-icons/react';
import { Button } from './ui';
import { tr } from './i18n';

export default function ReferenceSourceOptions({ description, children }: { description: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="writing-source-options">
    <div className="writing-source-foot"><small>{tr('TXT / Markdown · UTF-8 · 每批最多20篇')}</small>
      <div className="writing-source-tools">{children}<Button variant="quiet" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><Info size={15}/><span>{tr('参考范围与数据说明')}</span><CaretDown size={14}/></Button></div>
    </div>
    {open && <div id={id} className="writing-source-explanation" role="region" aria-label={tr('参考范围与数据说明')}><p>{description}</p></div>}
  </div>;
}
