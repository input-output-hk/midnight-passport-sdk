// Progressive enhancement: links and the full documentation menu work without JavaScript.
const menu = document.querySelector('.docs-navigation');
const narrow = window.matchMedia('(max-width: 56rem)');
if (menu instanceof HTMLDetailsElement) {
  const arrangeMenu = () => { menu.open = !narrow.matches; };
  arrangeMenu();
  narrow.addEventListener('change', arrangeMenu);
}

const contents = document.querySelector('#page-contents');
const panel = document.querySelector('.page-contents');
if (contents && panel) {
  for (const heading of document.querySelectorAll('.page-content h2[id]')) {
    if (heading.textContent.trim() === 'On this page') continue;
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#${encodeURIComponent(heading.id)}`;
    link.textContent = heading.textContent;
    item.append(link);
    contents.append(item);
  }
  panel.hidden = contents.childElementCount < 2;
  panel.open = !narrow.matches;
}
