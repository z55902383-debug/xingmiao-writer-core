export type ImportTarget = 'premise'|'outline'|'volume'|'chapters'|'body'|'characters'|'world'|'worldRecords'|'cheat';
export type ImportField = {label:string;required:boolean;max:number};
export const importTools:string[];
export const importTargets:Record<ImportTarget,{label:string;types:string[];fields:Record<string,ImportField>}>;
export const defaultImportTarget:Record<string,ImportTarget>;
export const sharedFields:Record<string,ImportField>;
export function fieldsFor(target:ImportTarget,type:string):Record<string,ImportField>;
export function sourceBlocks(source:string):{id:string;text:string}[];
