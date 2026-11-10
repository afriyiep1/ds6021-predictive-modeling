const menu = document.getElementById('menu');
// Add the explorer consistently to existing course pages, including nested dataset pages.
const courseNav = document.querySelector('nav[aria-label="Course"]');
if (courseNav && !courseNav.querySelector('a[href$="kmeans/"]')) {
  const resourcesHeading = [...courseNav.querySelectorAll('.nav-label')].find(el => el.textContent === 'RESOURCES');
  const heading = document.createElement('div');
  heading.className = 'nav-label';
  heading.textContent = 'EXPLORE';
  const link = document.createElement('a');
  link.className = 'navlink';
  link.href = new URL('kmeans/', document.currentScript.src).href;
  link.textContent = 'KMeans weather lab';
  courseNav.insertBefore(heading, resourcesHeading || null);
  courseNav.insertBefore(link, resourcesHeading || null);
}
menu?.addEventListener('click', () => {const open = document.getElementById('sidebar').classList.toggle('open');menu.setAttribute('aria-expanded',String(open));});
document.addEventListener('keydown', e => {if(e.key==='Escape'){document.getElementById('sidebar').classList.remove('open');menu?.setAttribute('aria-expanded','false');}});
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{const text=document.getElementById(button.dataset.copy).textContent;try{await navigator.clipboard.writeText(text);button.textContent='Copied';}catch{const range=document.createRange();range.selectNodeContents(document.getElementById(button.dataset.copy));const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);button.textContent='Select & copy';}setTimeout(()=>button.textContent='Copy code',2000);}));
