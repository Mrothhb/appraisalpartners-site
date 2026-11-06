const total = document.querySelector('#total-view');
const pdf = document.querySelector('#pdf-view');
const tabs = [...document.querySelectorAll('.report-switch button')];
tabs.forEach((button, index) => {
  button.addEventListener('click', () => {
    total.hidden = index !== 0;
    pdf.hidden = index === 0;
    tabs.forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
  });
});
