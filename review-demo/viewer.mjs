import { getDocument, GlobalWorkerOptions } from './pdfjs/pdf.mjs';
GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.mjs', import.meta.url).href;
const pages = document.querySelector('#pages');
const status = document.querySelector('#page-status');
const showError = () => { document.querySelector('#error').hidden = false; status.textContent = 'Sample PDF'; };
try {
  const pdf = await getDocument({url:'../uad36-work-sample.pdf',isEvalSupported:false,wasmUrl:'./pdfjs/wasm/',standardFontDataUrl:'./pdfjs/standard_fonts/'}).promise;
  const entries = [];
  let chain = Promise.resolve();
  async function render(entry) {
    if(entry.rendered || !entry.near) return;
    const page = await pdf.getPage(entry.number);
    const base = page.getViewport({scale:1});
    const scale = entry.element.clientWidth / base.width;
    const density = Math.min(devicePixelRatio || 1, 2);
    const viewport = page.getViewport({scale:scale*density});
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    canvas.setAttribute('aria-label', `PDF page ${entry.number} of ${pdf.numPages}`);
    canvas.setAttribute('role','img');
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    entry.element.prepend(canvas);entry.rendered = true;
    entry.element.dataset.rendered = 'true';
    page.cleanup();
  }
  const observer = new IntersectionObserver(changes => {
    for(const change of changes) {
      const entry = entries[Number(change.target.dataset.page)-1];
      entry.near = change.isIntersecting;
      if(entry.near) chain = chain.then(()=>render(entry)).catch(showError);
      else if(entry.rendered){entry.element.querySelector('canvas')?.remove();entry.rendered=false;delete entry.element.dataset.rendered;}
    }
  },{rootMargin:'100% 0px'});
  for(let number=1;number<=pdf.numPages;number++) {
    const page = await pdf.getPage(number), viewport = page.getViewport({scale:1});
    const element = document.createElement('section');element.className='page';element.dataset.page=number;
    element.style.aspectRatio=`${viewport.width} / ${viewport.height}`;
    element.setAttribute('aria-label',`Page ${number} of ${pdf.numPages}`);
    const label=document.createElement('span');label.className='page-label';label.textContent=`${number} / ${pdf.numPages}`;
    element.append(label);pages.append(element);
    entries.push({number,element,near:false,rendered:false});observer.observe(element);
  }
  function updatePage(){let current=entries.find(e=>e.element.getBoundingClientRect().bottom>70)||entries.at(-1);status.textContent=`Page ${current.number} of ${pdf.numPages}`;}
  addEventListener('scroll',updatePage,{passive:true});updatePage();
} catch(error) { showError(); }
