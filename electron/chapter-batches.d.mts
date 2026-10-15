import type { Book, Chapter } from '../src/types';
export type ChapterBatch = { total:number; start:number; end:number; positions:number[]; complete:boolean; estimated:boolean };
export function chapterSlots(book:Book,volumeId:string):{position:number;chapter:Chapter}[];
export function chapterBatch(book:Book,volumeId:string,kind?:string):ChapterBatch|null;
