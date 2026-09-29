import * as pdfjsLib from 'pdfjs-dist';
import {createWorker} from 'tesseract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.mjs',import.meta.url).toString();

export type FinanceReceiptField={
 key:'amount'|'receipt_number'|'date'|'description'|'currency';
 value:string;
 confidence:number;
};

const normDigits=(v:string)=>v
 .replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
 .replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

const cleanNumber=(v:string)=>normDigits(v).replace(/[٬,]/g,'').trim();

const firstMatch=(text:string,patterns:RegExp[])=>{
 for(const re of patterns){const m=text.match(re);if(m?.[1])return m[1].trim();}
 return '';
};

const parseText=(text:string):FinanceReceiptField[]=>{
 const out:FinanceReceiptField[]=[];
 const amount=firstMatch(text,[
  /(?:مبلغ|قیمت|جمع\s*کل|مبلغ\s*کل|قابل\s*پرداخت|amount|total|total\s*amount|payable)[^\n\d۰-۹٠-٩]{0,30}([\d۰-۹٠-٩,٬]{3,20}(?:\.\d{1,2})?)/i,
  /(?:ریال|IRR)[^\n\d۰-۹٠-٩]{0,15}([\d۰-۹٠-٩,٬]{3,20})/i
 ]);
 if(amount)out.push({key:'amount',value:cleanNumber(amount),confidence:.88});

 const receipt=firstMatch(text,[
  /(?:رسید|شماره\s*رسید|مرجع|شماره\s*مرجع|reference|ref|receipt)[^\nA-Z0-9۰-۹٠-٩]{0,25}([A-Z0-9۰-۹٠-٩-]{3,30})/i
 ]);
 if(receipt)out.push({key:'receipt_number',value:receipt,confidence:.78});

 const date=firstMatch(text,[/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/]);
 if(date)out.push({key:'date',value:normDigits(date),confidence:.68});

 const currency=firstMatch(text,[
  /\b(IRR|USD|EUR|AED|CNY|RUB|GBP|CHF|TRY)\b/i,
  /(ریال|دلار|یورو|درهم|روبل|یوان|لیر)/
 ]);
 if(currency){
  const map:Record<string,string>={ریال:'IRR',دلار:'USD',یورو:'EUR',درهم:'AED',روبل:'RUB',یوان:'CNY',لیر:'TRY'};
  out.push({key:'currency',value:map[currency]||currency.toUpperCase(),confidence:.8});
 }

 const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
 const desc=lines.find(x=>x.length>5&&x.length<100&&!/^(\d|مبلغ|تاریخ|شماره|جمع|total|amount|date)/i.test(x));
 if(desc)out.push({key:'description',value:desc,confidence:.45});
 return out;
};

export const extractFinanceReceipt=async(file:File,onProgress?:(message:string)=>void)=>{
 let text='';
 if(file.type==='application/pdf'){
  onProgress?.('در حال خواندن متن PDF فیش…');
  const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  const pages:string[]=[];
  for(let n=1;n<=pdf.numPages;n++){
   onProgress?.('خواندن صفحه '+n+' از '+pdf.numPages+'…');
   const page=await pdf.getPage(n);
   const c=await page.getTextContent();
   pages.push(c.items.map((x:any)=>x.str||'').join(' '));
  }
  text=pages.join('\n');
  if(!text.trim()){
   onProgress?.('PDF متن قابل استخراج ندارد؛ OCR صفحات فیش در حال اجراست…');
   const worker=await createWorker('fas+eng');
   try{
    const ocrPages:string[]=[];
    const maxPages=Math.min(pdf.numPages,3);
    for(let n=1;n<=maxPages;n++){
     onProgress?.('OCR صفحه '+n+' از '+maxPages+'…');
     const page=await pdf.getPage(n);
     const viewport=page.getViewport({scale:1.65});
     const canvas=document.createElement('canvas');
     canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     const ctx=canvas.getContext('2d');
     if(!ctx)continue;
     await page.render({canvasContext:ctx,viewport}).promise;
     const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
     if(!blob)continue;
     const r=await worker.recognize(blob);
     ocrPages.push(r.data.text||'');
    }
    text=ocrPages.join('\n');
   }finally{await worker.terminate();}
  }
 }else if(file.type.startsWith('image/')){
  onProgress?.('OCR فارسی/انگلیسی فیش در حال اجراست…');
  const worker=await createWorker('fas+eng');
  try{const r=await worker.recognize(file);text=r.data.text;}finally{await worker.terminate();}
 }else{
  throw new Error('فرمت فیش برای استخراج پشتیبانی نمی‌شود.');
 }
 return {text,fields:parseText(text)};
};
